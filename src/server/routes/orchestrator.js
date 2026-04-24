/**
 * Orchestrator API Routes
 * Endpoints for starting, controlling, and monitoring autonomous plan execution.
 */

import express from 'express';
import { orchestrator } from '../orchestrator.js';
import { ollamaWorkspaceOrchestrator } from '../ollamaWorkspaceOrchestrator.js';
import { ptyManager } from '../ptyManager.js';
import { activityFeed } from '../activityFeed.js';
import { gitManager } from '../gitManager.js';
import Project from '../models/Project.js';

const router = express.Router();

/**
 * POST /api/orchestrator/start - Start autonomous execution of a plan
 */
router.post('/start', (req, res) => {
  try {
    const { sessionId, projectId, projectPath, steps, planTitle, cliTool, config } = req.body;

    if (!sessionId || !projectId || !steps || !Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: 'sessionId, projectId, and a non-empty steps array are required' });
    }

    const writeFn = (data) => ptyManager.write(sessionId, data);

    const executionId = orchestrator.start({
      sessionId,
      projectId,
      projectPath,
      steps,
      planTitle,
      cliTool,
      config,
      writeFn,
    });

    res.json({ executionId, status: 'running' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start orchestrator', message: error.message });
  }
});

/**
 * POST /api/orchestrator/pause/:executionId - Pause execution
 */
router.post('/pause/:executionId', (req, res) => {
  try {
    const { executionId } = req.params;
    const paused = orchestrator.pause(executionId);

    if (!paused) {
      return res.status(404).json({ error: 'Execution not found or cannot be paused' });
    }

    res.json({ executionId, status: 'paused' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to pause execution', message: error.message });
  }
});

/**
 * POST /api/orchestrator/resume/:executionId - Resume execution
 */
router.post('/resume/:executionId', (req, res) => {
  try {
    const { executionId } = req.params;
    const resumed = orchestrator.resume(executionId);

    if (!resumed) {
      return res.status(404).json({ error: 'Execution not found or cannot be resumed' });
    }

    res.json({ executionId, status: 'running' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to resume execution', message: error.message });
  }
});

/**
 * POST /api/orchestrator/stop/:executionId - Stop execution
 */
router.post('/stop/:executionId', (req, res) => {
  try {
    const { executionId } = req.params;
    const stopped = orchestrator.stop(executionId);

    if (!stopped) {
      return res.status(404).json({ error: 'Execution not found or cannot be stopped' });
    }

    res.json({ executionId, status: 'stopped' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop execution', message: error.message });
  }
});

/**
 * POST /api/orchestrator/approve/:executionId - Approve a step waiting for approval
 */
router.post('/approve/:executionId', (req, res) => {
  try {
    const { executionId } = req.params;
    const approved = orchestrator.approveStep(executionId);

    if (!approved) {
      return res.status(404).json({ error: 'Execution not found or not waiting for approval' });
    }

    res.json({ executionId, status: 'running' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to approve step', message: error.message });
  }
});

/**
 * POST /api/orchestrator/skip/:executionId - Skip the current step
 */
router.post('/skip/:executionId', (req, res) => {
  try {
    const { executionId } = req.params;
    const skipped = orchestrator.skipStep(executionId);

    if (!skipped) {
      return res.status(404).json({ error: 'Execution not found or cannot skip step' });
    }

    res.json({ executionId, status: 'skipped' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to skip step', message: error.message });
  }
});

/**
 * GET /api/orchestrator/status/:executionId - Get execution status
 */
router.get('/status/:executionId', (req, res) => {
  try {
    const { executionId } = req.params;
    const status = orchestrator.getStatus(executionId);

    if (!status) {
      return res.status(404).json({ error: 'Execution not found' });
    }

    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get execution status', message: error.message });
  }
});

/**
 * GET /api/orchestrator/status - List all active executions
 */
router.get('/status', (req, res) => {
  try {
    const executions = orchestrator.getActiveExecutions();
    res.json(executions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get active executions', message: error.message });
  }
});

/**
 * POST /api/orchestrator/kill/:executionId - Kill switch: stop execution and kill terminal
 */
router.post('/kill/:executionId', (req, res) => {
  try {
    const { executionId } = req.params;
    const status = orchestrator.getStatus(executionId);

    if (!status) {
      return res.status(404).json({ error: 'Execution not found' });
    }

    // Stop the orchestrator execution
    orchestrator.stop(executionId);

    // Kill the associated terminal session
    ptyManager.killSession(status.sessionId);

    activityFeed.log({
      projectId: status.projectId,
      executionId,
      sessionId: status.sessionId,
      type: 'user-intervention',
      title: `Kill switch activated for execution: ${executionId}`,
    });

    res.json({ executionId, status: 'killed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to kill execution', message: error.message });
  }
});

/**
 * GET /api/orchestrator/git-info - Get current git state for a project
 * Used by frontend to show branch choice before starting execution
 */
router.get('/git-info', (req, res) => {
  try {
    const { projectPath } = req.query;
    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath query param required' });
    }

    const isRepo = gitManager.isGitRepo(projectPath);
    if (!isRepo) {
      return res.json({ isGitRepo: false });
    }

    const branch = gitManager.getCurrentBranch(projectPath);
    const status = gitManager.getStatus(projectPath);
    const isMainBranch = ['main', 'master', 'develop', 'dev'].includes(branch);

    res.json({
      isGitRepo: true,
      branch,
      isMainBranch,
      hasChanges: status ? (status.modified.length + status.added.length + status.deleted.length + status.untracked.length) > 0 : false,
      status,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/orchestrator/ollama/:projectId/status - Get Ollama workspace index status
 */
router.get('/ollama/:projectId/status', (req, res) => {
  try {
    const { projectId } = req.params;
    res.json(ollamaWorkspaceOrchestrator.getStatus(projectId));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/orchestrator/ollama/:projectId/scan - Build or refresh Ollama-only workspace index
 */
router.post('/ollama/:projectId/scan', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = Project.findById(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const index = await ollamaWorkspaceOrchestrator.getOrBuildIndex(project, {
      forceRefresh: req.body?.forceRefresh !== false,
    });

    res.json({
      indexed: true,
      scannedAt: index.scannedAt,
      stats: index.stats,
      stack: index.stack,
      source: index.source,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to scan workspace for Ollama orchestrator', message: error.message });
  }
});

/**
 * GET /api/orchestrator/ollama/:projectId/search?q=... - Search the Ollama workspace index
 */
router.get('/ollama/:projectId/search', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { q = '', limit = 20 } = req.query;
    const project = Project.findById(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const index = await ollamaWorkspaceOrchestrator.getOrBuildIndex(project);
    const files = ollamaWorkspaceOrchestrator.searchIndex(index, q, {
      limit: Math.min(parseInt(limit, 10) || 20, 50),
    }).map((file) => ({
      path: file.path,
      purpose: file.purpose,
      riskTags: file.riskTags,
      score: file.score,
      size: file.size,
      language: file.language,
    }));

    res.json({ files, scannedAt: index.scannedAt, stats: index.stats });
  } catch (error) {
    res.status(500).json({ error: 'Failed to search Ollama workspace index', message: error.message });
  }
});

/**
 * GET /api/orchestrator/ollama/:projectId/jobs - List Ollama orchestration jobs
 */
router.get('/ollama/:projectId/jobs', (req, res) => {
  try {
    const { projectId } = req.params;
    const { sessionId = null, limit = 20 } = req.query;
    const jobs = ollamaWorkspaceOrchestrator.listJobs(projectId, sessionId || null, Math.min(parseInt(limit, 10) || 20, 100));
    res.json({ jobs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list Ollama orchestration jobs', message: error.message });
  }
});

/**
 * GET /api/orchestrator/ollama/jobs/:jobId - Get Ollama orchestration job details
 */
router.get('/ollama/jobs/:jobId', (req, res) => {
  try {
    const job = ollamaWorkspaceOrchestrator.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get Ollama orchestration job', message: error.message });
  }
});

/**
 * GET /api/orchestrator/ollama/jobs/:jobId/artifacts/:name - Get job artifact
 */
router.get('/ollama/jobs/:jobId/artifacts/:name', (req, res) => {
  try {
    const artifact = ollamaWorkspaceOrchestrator.getJobArtifact(req.params.jobId, req.params.name);
    if (!artifact) return res.status(404).json({ error: 'Artifact not found' });
    res.json(artifact);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get Ollama orchestration artifact', message: error.message });
  }
});

export default router;
