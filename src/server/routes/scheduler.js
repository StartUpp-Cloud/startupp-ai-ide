/**
 * Scheduler API Routes
 * Endpoints for managing scheduled tasks (CRUD, toggle, manual trigger).
 */

import express from 'express';
import { scheduler } from '../scheduler.js';

const router = express.Router();

/** Valid schedule types for request validation */
const VALID_TYPES = new Set(['command', 'test', 'plan']);

/** Minimum interval in milliseconds (1 minute) */
const MIN_INTERVAL_MS = 60_000;

/**
 * GET /api/schedules
 * List all schedules, optionally filtered by projectId.
 *
 * Query params:
 *   - projectId (optional): filter schedules to a specific project
 */
router.get('/', (req, res) => {
  try {
    const { projectId } = req.query;
    const schedules = scheduler.getAll(projectId || null);
    res.json(schedules);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch schedules', message: error.message });
  }
});

/**
 * GET /api/schedules/:id
 * Get a single schedule by ID.
 */
router.get('/:id', (req, res) => {
  try {
    const schedule = scheduler.get(req.params.id);

    if (!schedule) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    res.json(schedule);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch schedule', message: error.message });
  }
});

/**
 * POST /api/schedules
 * Create a new scheduled task.
 *
 * Body:
 *   - projectId (string, required)
 *   - name (string, required)
 *   - type ('command' | 'test' | 'plan', required)
 *   - command (string, required for type='command')
 *   - testCommand (string, optional for type='test')
 *   - planSteps (Array, optional for type='plan')
 *   - projectPath (string, optional)
 *   - intervalMs (number, required, >= 60000)
 *   - enabled (boolean, optional, default true)
 *   - notifyOnFailure (boolean, optional, default true)
 *   - notifyOnSuccess (boolean, optional, default false)
 */
router.post('/', async (req, res) => {
  try {
    const {
      projectId,
      name,
      type,
      command,
      testCommand,
      planSteps,
      projectPath,
      intervalMs,
      enabled,
      notifyOnFailure,
      notifyOnSuccess,
    } = req.body;

    // Validate required fields
    const errors = [];

    if (!projectId) {
      errors.push('projectId is required');
    }
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      errors.push('name is required and must be a non-empty string');
    }
    if (!type || !VALID_TYPES.has(type)) {
      errors.push(`type is required and must be one of: ${[...VALID_TYPES].join(', ')}`);
    }
    if (type === 'command' && (!command || typeof command !== 'string')) {
      errors.push('command is required for type="command"');
    }
    if (intervalMs === undefined || intervalMs === null) {
      errors.push('intervalMs is required');
    } else if (typeof intervalMs !== 'number' || intervalMs < MIN_INTERVAL_MS) {
      errors.push(`intervalMs must be a number >= ${MIN_INTERVAL_MS}`);
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    const schedule = await scheduler.create({
      projectId,
      name,
      type,
      command,
      testCommand,
      planSteps,
      projectPath,
      intervalMs,
      enabled,
      notifyOnFailure,
      notifyOnSuccess,
    });

    res.status(201).json(schedule);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create schedule', message: error.message });
  }
});

/**
 * PUT /api/schedules/:id
 * Update an existing schedule.
 *
 * Body: Any subset of the schedule fields (except id, createdAt).
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Validate fields if provided
    const errors = [];

    if (updates.name !== undefined) {
      if (typeof updates.name !== 'string' || updates.name.trim().length === 0) {
        errors.push('name must be a non-empty string');
      }
    }
    if (updates.type !== undefined && !VALID_TYPES.has(updates.type)) {
      errors.push(`type must be one of: ${[...VALID_TYPES].join(', ')}`);
    }
    if (updates.intervalMs !== undefined) {
      if (typeof updates.intervalMs !== 'number' || updates.intervalMs < MIN_INTERVAL_MS) {
        errors.push(`intervalMs must be a number >= ${MIN_INTERVAL_MS}`);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    const schedule = await scheduler.update(id, updates);
    res.json(schedule);
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    res.status(500).json({ error: 'Failed to update schedule', message: error.message });
  }
});

/**
 * DELETE /api/schedules/:id
 * Delete a schedule and stop its timer.
 */
router.delete('/:id', async (req, res) => {
  try {
    await scheduler.remove(req.params.id);
    res.json({ message: 'Schedule deleted successfully' });
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    res.status(500).json({ error: 'Failed to delete schedule', message: error.message });
  }
});

/**
 * POST /api/schedules/:id/toggle
 * Enable or disable a schedule.
 *
 * Body:
 *   - enabled (boolean, required)
 */
router.post('/:id/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) is required in the request body' });
    }

    const schedule = await scheduler.toggle(req.params.id, enabled);
    res.json(schedule);
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    res.status(500).json({ error: 'Failed to toggle schedule', message: error.message });
  }
});

/**
 * POST /api/schedules/:id/trigger
 * Manually trigger a schedule to run immediately.
 */
router.post('/:id/trigger', async (req, res) => {
  try {
    const result = await scheduler.triggerNow(req.params.id);
    res.json(result);
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    res.status(500).json({ error: 'Failed to trigger schedule', message: error.message });
  }
});

export default router;
