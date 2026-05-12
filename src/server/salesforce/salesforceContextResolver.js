import path from 'path';
import Project from '../models/Project.js';
import { containerManager } from '../containerManager.js';
import { SalesforceApiError } from './salesforceErrors.js';

export function assertWorkspacePath(inputPath, { allowWorkspaceRoot = true } = {}) {
  if (!inputPath || typeof inputPath !== 'string') {
    if (allowWorkspaceRoot) return '/workspace';
    throw new SalesforceApiError('INVALID_CONTEXT', 'A repoPath or worktreePath is required');
  }

  const normalized = path.posix.normalize(inputPath);
  if (normalized.includes('\0') || (normalized !== '/workspace' && !normalized.startsWith('/workspace/'))) {
    throw new SalesforceApiError('PATH_OUTSIDE_WORKSPACE', 'Path must stay inside /workspace');
  }
  return normalized;
}

export async function resolveSalesforceContext({ projectId, repoPath, worktreePath, branch, requireRepo = false }) {
  const project = Project.findById(projectId);
  if (!project) throw new SalesforceApiError('PROJECT_NOT_FOUND', 'Project not found', 404);
  if (!project.containerName) {
    throw new SalesforceApiError('PROJECT_CONTAINER_REQUIRED', 'Salesforce features require a project container', 400);
  }

  const status = await containerManager.getContainerStatusAsync(project.containerName);
  if (!status) throw new SalesforceApiError('CONTAINER_NOT_FOUND', 'Container not found', 404);
  if (status !== 'running') throw new SalesforceApiError('CONTAINER_NOT_RUNNING', 'Container is not running', 409);

  const resolvedWorktreePath = worktreePath ? assertWorkspacePath(worktreePath, { allowWorkspaceRoot: false }) : null;
  const resolvedRepoPath = repoPath ? assertWorkspacePath(repoPath, { allowWorkspaceRoot: false }) : null;
  if (requireRepo && !resolvedWorktreePath && !resolvedRepoPath) {
    throw new SalesforceApiError('INVALID_CONTEXT', 'Select a repo or worktree before running Salesforce commands');
  }

  return {
    project,
    projectId,
    containerName: project.containerName,
    workspaceRoot: '/workspace',
    repoPath: resolvedRepoPath,
    worktreePath: resolvedWorktreePath,
    cwd: resolvedWorktreePath || resolvedRepoPath || '/workspace',
    branch: branch || null,
  };
}

export function salesforceErrorResponse(res, error) {
  if (error instanceof SalesforceApiError) {
    return res.status(error.status).json({
      ok: false,
      error: { code: error.code, message: error.message, details: error.details },
    });
  }
  return res.status(500).json({
    ok: false,
    error: { code: 'SALESFORCE_INTERNAL_ERROR', message: error.message || 'Salesforce operation failed' },
  });
}
