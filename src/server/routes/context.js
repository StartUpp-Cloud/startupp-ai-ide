/**
 * Context Builder API Routes
 * Endpoints for building and retrieving full project context for the LLM.
 */

import express from 'express';
import { contextBuilder } from '../contextBuilder.js';
import { findProjectById } from '../models/Project.js';

const router = express.Router();

/**
 * GET /api/context/:projectId - Build and return full project context
 */
router.get('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = findProjectById(projectId);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!project.folderPath) {
      return res.status(400).json({ error: 'Project does not have a folder path configured' });
    }

    const context = await contextBuilder.buildFullContext(projectId, project.folderPath, project);
    res.json(context);
  } catch (error) {
    res.status(500).json({ error: 'Failed to build project context', message: error.message });
  }
});

export default router;
