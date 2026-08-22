/**
 * Background project-container setup so create-project never blocks the API.
 */

import Project from './models/Project.js';
import { containerManager } from './containerManager.js';

const jobs = new Map();

function snapshot(job) {
  if (!job) return null;
  return {
    projectId: job.projectId,
    status: job.status,
    step: job.step,
    error: job.error,
    containerName: job.containerName,
  };
}

export function getProvisionJob(projectId) {
  return snapshot(jobs.get(projectId));
}

export function listProvisionJobs() {
  return [...jobs.values()].map(snapshot);
}

export function startProvision(projectId) {
  const existing = jobs.get(projectId);
  if (existing && ['queued', 'building', 'creating'].includes(existing.status)) {
    return snapshot(existing);
  }

  const job = {
    projectId,
    status: 'queued',
    step: 'Queued…',
    error: null,
    containerName: null,
  };
  jobs.set(projectId, job);
  runProvision(job).catch((err) => {
    job.status = 'error';
    job.error = err.message || String(err);
    job.step = job.error;
  });
  return snapshot(job);
}

async function runProvision(job) {
  const project = Project.findById(job.projectId);
  if (!project) throw new Error('Project not found');
  if (project.runtime === 'host') {
    job.status = 'skipped';
    job.step = 'Host project — no container';
    return;
  }

  if (project.containerName) {
    const status = containerManager.getContainerStatus(project.containerName);
    if (status) {
      job.status = 'ready';
      job.containerName = project.containerName;
      job.step = `Container ${status}`;
      return;
    }
  }

  if (!containerManager.isDockerAvailable()) {
    throw new Error('Docker engine is not reachable. Start Docker on the host, then retry.');
  }

  job.status = 'building';
  job.step = 'Preparing project image…';
  await containerManager.buildImage();

  job.status = 'creating';
  job.step = 'Creating project container…';
  const result = await containerManager.createContainer({
    projectId: project.id,
    name: project.name,
    gitUrl: project.gitUrl || null,
    repos: project.repos || [],
    ports: project.containerPorts || [],
  });

  await Project.update(project.id, {
    containerName: result.containerName,
    containerStatus: result.status || 'running',
  });

  job.containerName = result.containerName;
  job.status = 'ready';
  job.step = result.alreadyExists ? 'Container ready' : 'Container created';
}

export function withProvision(project) {
  if (!project) return project;
  return { ...project, provision: getProvisionJob(project.id) };
}

/**
 * Start provision if needed and wait until the project has a running container.
 */
export async function waitForProvision(projectId, { timeoutMs = 300000, onProgress } = {}) {
  let job = getProvisionJob(projectId);
  if (!job || ['error', 'skipped'].includes(job.status)) {
    job = startProvision(projectId);
  }

  const deadline = Date.now() + timeoutMs;
  let lastStep = '';
  while (Date.now() < deadline) {
    job = getProvisionJob(projectId);
    if (job?.step && job.step !== lastStep) {
      lastStep = job.step;
      onProgress?.(job);
    }
    if (job?.status === 'ready' && job.containerName) return job;
    if (job?.status === 'error' || job?.status === 'skipped') {
      throw new Error(job.error || job.step || 'Container setup failed');
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Timed out waiting for the project container. Check Docker Desktop and try New session.');
}
