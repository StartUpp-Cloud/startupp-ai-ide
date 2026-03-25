/**
 * Big Project Planner API Routes
 * Manages large projects broken into iterations with automated workflows
 */

import express from 'express';
import { bigProjectPlanner, WORKFLOW_STATES, WORKFLOW_STEPS } from '../bigProjectPlanner.js';

const router = express.Router();

/**
 * GET /api/big-projects
 * Get all big projects, optionally filtered by linked project ID
 */
router.get('/', async (req, res) => {
  try {
    const { projectId } = req.query;
    const projects = await bigProjectPlanner.getProjects(projectId);
    res.json(projects);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch big projects',
      message: error.message
    });
  }
});

/**
 * GET /api/big-projects/workflow-info
 * Get workflow states and steps info
 */
router.get('/workflow-info', (req, res) => {
  res.json({
    states: WORKFLOW_STATES,
    steps: WORKFLOW_STEPS,
  });
});

/**
 * GET /api/big-projects/:id
 * Get a specific big project
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const project = await bigProjectPlanner.getProject(id);

    if (!project) {
      return res.status(404).json({ error: 'Big project not found' });
    }

    // Include progress summary
    const progress = bigProjectPlanner.getProgressSummary(project);

    res.json({ ...project, progress });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch big project',
      message: error.message
    });
  }
});

/**
 * POST /api/big-projects
 * Create a new big project from description
 */
router.post('/', async (req, res) => {
  try {
    const { description, projectId, projectPath, cliTool, additionalContext } = req.body;

    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Project description is required' });
    }

    const project = await bigProjectPlanner.createProject(description, {
      projectId,
      projectPath,
      cliTool: cliTool || 'claude',
      additionalContext,
    });

    res.status(201).json(project);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to create big project',
      message: error.message
    });
  }
});

/**
 * POST /api/big-projects/preview
 * Preview breakdown without creating project
 */
router.post('/preview', async (req, res) => {
  try {
    const { description, projectPath, additionalContext } = req.body;

    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Project description is required' });
    }

    const breakdown = await bigProjectPlanner.breakdownProject(description, {
      projectPath,
      additionalContext,
    });

    res.json(breakdown);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to preview breakdown',
      message: error.message
    });
  }
});

/**
 * POST /api/big-projects/:id/start
 * Start or resume a project
 */
router.post('/:id/start', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await bigProjectPlanner.startProject(id);
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: 'Failed to start project',
      message: error.message
    });
  }
});

/**
 * POST /api/big-projects/:id/pause
 * Pause a running project
 */
router.post('/:id/pause', async (req, res) => {
  try {
    const { id } = req.params;
    const project = await bigProjectPlanner.pauseProject(id);
    res.json(project);
  } catch (error) {
    res.status(400).json({
      error: 'Failed to pause project',
      message: error.message
    });
  }
});

/**
 * POST /api/big-projects/:id/iterations/:iterationId/start
 * Start a specific iteration
 */
router.post('/:id/iterations/:iterationId/start', async (req, res) => {
  try {
    const { id, iterationId } = req.params;
    const result = await bigProjectPlanner.startIteration(id, iterationId);
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: 'Failed to start iteration',
      message: error.message
    });
  }
});

/**
 * POST /api/big-projects/:id/iterations/:iterationId/advance
 * Advance to the next workflow step
 */
router.post('/:id/iterations/:iterationId/advance', async (req, res) => {
  try {
    const { id, iterationId } = req.params;
    const { notes } = req.body;
    const result = await bigProjectPlanner.advanceWorkflow(id, iterationId, notes || '');
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: 'Failed to advance workflow',
      message: error.message
    });
  }
});

/**
 * POST /api/big-projects/:id/iterations/:iterationId/complete
 * Mark an iteration as complete
 */
router.post('/:id/iterations/:iterationId/complete', async (req, res) => {
  try {
    const { id, iterationId } = req.params;
    const { notes } = req.body;
    const result = await bigProjectPlanner.completeIteration(id, iterationId, notes || '');
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: 'Failed to complete iteration',
      message: error.message
    });
  }
});

/**
 * POST /api/big-projects/:id/iterations/:iterationId/fail
 * Mark an iteration as failed
 */
router.post('/:id/iterations/:iterationId/fail', async (req, res) => {
  try {
    const { id, iterationId } = req.params;
    const { error: errorMsg } = req.body;
    const result = await bigProjectPlanner.failIteration(id, iterationId, errorMsg || 'Unknown error');
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: 'Failed to mark iteration as failed',
      message: error.message
    });
  }
});

/**
 * POST /api/big-projects/:id/iterations/:iterationId/retry
 * Retry a failed iteration
 */
router.post('/:id/iterations/:iterationId/retry', async (req, res) => {
  try {
    const { id, iterationId } = req.params;
    const result = await bigProjectPlanner.retryIteration(id, iterationId);
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: 'Failed to retry iteration',
      message: error.message
    });
  }
});

/**
 * PUT /api/big-projects/:id/notes
 * Update project technical notes
 */
router.put('/:id/notes', async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const project = await bigProjectPlanner.updateProjectNotes(id, notes || '');
    res.json(project);
  } catch (error) {
    res.status(400).json({
      error: 'Failed to update notes',
      message: error.message
    });
  }
});

/**
 * DELETE /api/big-projects/:id
 * Delete a big project
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await bigProjectPlanner.deleteProject(id);
    res.json({ message: 'Big project deleted successfully' });
  } catch (error) {
    res.status(400).json({
      error: 'Failed to delete project',
      message: error.message
    });
  }
});

export default router;
