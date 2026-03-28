/**
 * Orchestrator API Routes
 * Endpoints for starting, controlling, and monitoring autonomous plan execution.
 */

import express from 'express';
import { orchestrator } from '../orchestrator.js';
import { ptyManager } from '../ptyManager.js';
import { activityFeed } from '../activityFeed.js';

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

export default router;
