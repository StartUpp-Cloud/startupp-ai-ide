/**
 * Slack Integration API Routes
 */

import express from 'express';
import { slackService } from '../slackService.js';
import Project from '../models/Project.js';

const router = express.Router();

/**
 * GET /api/slack/settings — get current config (tokens masked)
 */
router.get('/settings', (req, res) => {
  try {
    res.json(slackService.getSettings());
  } catch (error) {
    res.status(500).json({ error: 'Failed to get Slack settings', message: error.message });
  }
});

/**
 * PUT /api/slack/settings — update tokens and/or channel map
 */
router.put('/settings', async (req, res) => {
  try {
    const result = await slackService.updateSettings(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update Slack settings', message: error.message });
  }
});

/**
 * POST /api/slack/connect — start the Slack bot
 */
router.post('/connect', async (req, res) => {
  try {
    await slackService.connect();
    res.json({ connected: true, status: slackService.getStatus() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to connect to Slack', message: error.message });
  }
});

/**
 * POST /api/slack/disconnect — stop the Slack bot
 */
router.post('/disconnect', async (req, res) => {
  try {
    await slackService.disconnect();
    res.json({ connected: false });
  } catch (error) {
    res.status(500).json({ error: 'Failed to disconnect from Slack', message: error.message });
  }
});

/**
 * GET /api/slack/status — connection status + mapping info
 */
router.get('/status', (req, res) => {
  res.json(slackService.getStatus());
});

/**
 * POST /api/slack/map-channel — link a project to a Slack channel
 * Body: { projectId, channelId }
 */
router.post('/map-channel', async (req, res) => {
  try {
    const { projectId, channelId } = req.body;
    if (!projectId || !channelId) {
      return res.status(400).json({ error: 'projectId and channelId are required' });
    }

    const project = Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    await slackService.mapChannel(projectId, channelId);
    res.json({ mapped: true, projectId, channelId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to map channel', message: error.message });
  }
});

/**
 * DELETE /api/slack/map-channel/:projectId — unmap a project's channel
 */
router.delete('/map-channel/:projectId', async (req, res) => {
  try {
    await slackService.unmapChannel(req.params.projectId);
    res.json({ unmapped: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to unmap channel', message: error.message });
  }
});

/**
 * POST /api/slack/test — send a test message to a project's channel
 * Body: { projectId }
 */
router.post('/test', async (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    const project = Project.findById(projectId);
    const name = project?.name || projectId;

    const ts = await slackService.startThread(
      projectId,
      `test-${Date.now()}`,
      `Test from StartUpp IDE — project "${name}" is connected.`,
    );

    if (ts) {
      res.json({ success: true, threadTs: ts });
    } else {
      res.status(400).json({ error: 'Could not send test message. Check channel mapping and bot permissions.' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Test message failed', message: error.message });
  }
});

export default router;
