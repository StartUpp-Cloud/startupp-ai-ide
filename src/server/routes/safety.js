/**
 * Safety System API Routes
 * Endpoints for managing safety settings, checking step safety,
 * creating checkpoints, and emergency kill switch.
 */

import express from 'express';
import { safetySystem } from '../safetySystem.js';
import { orchestrator } from '../orchestrator.js';
import { ptyManager } from '../ptyManager.js';

const router = express.Router();

/**
 * GET /api/safety/settings - Get current safety settings
 */
router.get('/settings', (req, res) => {
  try {
    const settings = safetySystem.getSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get safety settings', message: error.message });
  }
});

/**
 * PUT /api/safety/settings - Update safety settings
 */
router.put('/settings', async (req, res) => {
  try {
    const settings = await safetySystem.updateSettings(req.body);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update safety settings', message: error.message });
  }
});

/**
 * POST /api/safety/check - Check if a step prompt is safe to execute
 */
router.post('/check', (req, res) => {
  try {
    const { prompt, projectPath } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    const result = safetySystem.checkStepSafety(prompt, projectPath || '');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to check safety', message: error.message });
  }
});

/**
 * POST /api/safety/checkpoint - Create a safety checkpoint (git tag)
 */
router.post('/checkpoint', async (req, res) => {
  try {
    const { projectPath, label } = req.body;

    if (!projectPath || !label) {
      return res.status(400).json({ error: 'projectPath and label are required' });
    }

    const tag = await safetySystem.createCheckpoint(projectPath, label);

    if (!tag) {
      return res.json({ created: false, message: 'Checkpoint creation skipped (autoCommitBeforeRiskyOps is disabled or git operation failed)' });
    }

    res.json({ created: true, tag });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create checkpoint', message: error.message });
  }
});

/**
 * POST /api/safety/kill/:executionId - Kill switch via REST
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

    res.json({ executionId, status: 'killed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to kill execution', message: error.message });
  }
});

export default router;
