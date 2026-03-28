/**
 * Activity Feed API Routes
 * Endpoints for querying activity logs for observability.
 */

import express from 'express';
import { activityFeed } from '../activityFeed.js';

const router = express.Router();

/**
 * GET /api/activity - Get activities with optional filters
 * Query params: projectId, planId, limit, offset, types (comma-separated)
 */
router.get('/', (req, res) => {
  try {
    const { projectId, planId, limit, offset, types } = req.query;

    if (planId) {
      const activities = activityFeed.getByPlan(planId, {
        limit: limit ? parseInt(limit, 10) : 100,
      });
      return res.json(activities);
    }

    if (!projectId) {
      return res.status(400).json({ error: 'projectId or planId query parameter is required' });
    }

    const parsedTypes = types ? types.split(',').map((t) => t.trim()).filter(Boolean) : null;

    const activities = activityFeed.getByProject(projectId, {
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
      types: parsedTypes,
    });

    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch activities', message: error.message });
  }
});

/**
 * GET /api/activity/plan/:planId - Get activities for a specific plan
 */
router.get('/plan/:planId', (req, res) => {
  try {
    const { planId } = req.params;
    const { limit } = req.query;

    const activities = activityFeed.getByPlan(planId, {
      limit: limit ? parseInt(limit, 10) : 100,
    });

    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch plan activities', message: error.message });
  }
});

/**
 * GET /api/activity/recent - Get recent activities across all projects
 */
router.get('/recent', (req, res) => {
  try {
    const { limit } = req.query;

    const activities = activityFeed.getRecent(
      limit ? parseInt(limit, 10) : 50,
    );

    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch recent activities', message: error.message });
  }
});

export default router;
