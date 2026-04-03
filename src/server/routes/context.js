/**
 * Context Builder API Routes
 * Endpoints for building and retrieving full project context for the LLM.
 */

import express from 'express';
import { execSync } from 'child_process';
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

    if (!project.folderPath && !project.containerName) {
      return res.status(400).json({ error: 'Project has no folder path or container configured' });
    }

    // For container projects without a local folderPath, return basic info
    if (!project.folderPath) {
      return res.json({ summary: `Container project: ${project.name}`, fullContext: '' });
    }

    const context = await contextBuilder.buildFullContext(projectId, project.folderPath, project);
    res.json(context);
  } catch (error) {
    res.status(500).json({ error: 'Failed to build project context', message: error.message });
  }
});

/**
 * GET /api/context/:projectId/scripts - Lightweight endpoint for detected scripts
 * Returns package manager, framework, and scripts from package.json
 */
router.get('/:projectId/scripts', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = findProjectById(projectId);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Container-based project: read package.json from inside the container
    if (project.containerName && !project.folderPath) {
      try {
        const pkgJson = execSync(
          `docker exec ${project.containerName} bash -c "cat /workspace/*/package.json 2>/dev/null || cat /workspace/package.json 2>/dev/null || echo '{}'"`,
          { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 },
        ).trim();

        const pkg = JSON.parse(pkgJson);
        const scripts = pkg.scripts || {};

        // Detect package manager from lock files
        let packageManager = 'npm';
        try {
          const lockCheck = execSync(
            `docker exec ${project.containerName} bash -c "ls /workspace/*/pnpm-lock.yaml /workspace/pnpm-lock.yaml 2>/dev/null && echo pnpm || ls /workspace/*/yarn.lock /workspace/yarn.lock 2>/dev/null && echo yarn || echo npm"`,
            { encoding: 'utf-8', stdio: 'pipe', timeout: 3000 },
          ).trim().split('\n').pop();
          if (lockCheck === 'pnpm' || lockCheck === 'yarn') packageManager = lockCheck;
        } catch { /* default npm */ }

        return res.json({
          packageManager,
          framework: null,
          language: null,
          testRunner: null,
          scripts,
        });
      } catch {
        // Container might not be running or no package.json
        return res.json({ packageManager: 'npm', scripts: {} });
      }
    }

    if (!project.folderPath) {
      return res.json({ packageManager: 'npm', scripts: {} });
    }

    const buildSystem = contextBuilder.detectBuildSystem(project.folderPath);

    res.json({
      packageManager: buildSystem.packageManager || 'npm',
      framework: buildSystem.framework || null,
      language: buildSystem.language || null,
      testRunner: buildSystem.testRunner || null,
      scripts: buildSystem.scripts || {},
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to detect project scripts',
      message: error.message,
    });
  }
});

export default router;
