/**
 * File Routes
 * Handle file operations for project workspaces
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import Project from '../models/Project.js';
import fileScanner from '../fileScanner.js';

const router = express.Router();

/**
 * GET /api/files/scan/:projectId - Scan project folder
 */
router.get('/scan/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { maxDepth, maxFiles } = req.query;

    const project = Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!project.folderPath) {
      return res.status(400).json({ error: 'Project has no folder path configured' });
    }

    if (!fs.existsSync(project.folderPath)) {
      return res.status(400).json({ error: 'Project folder does not exist' });
    }

    const result = fileScanner.scanDirectory(project.folderPath, {
      maxDepth: maxDepth ? parseInt(maxDepth) : 5,
      maxFiles: maxFiles ? parseInt(maxFiles) : 1000,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to scan folder', message: error.message });
  }
});

/**
 * GET /api/files/tree-text/:projectId - Get text representation of file tree
 */
router.get('/tree-text/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;

    const project = Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!project.folderPath) {
      return res.status(400).json({ error: 'Project has no folder path configured' });
    }

    const { tree } = fileScanner.scanDirectory(project.folderPath);
    const treeText = fileScanner.generateTreeText(tree);

    res.json({ treeText });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate tree', message: error.message });
  }
});

/**
 * GET /api/files/read/:projectId - Read a file within project folder
 */
router.get('/read/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { filePath } = req.query;

    if (!filePath) {
      return res.status(400).json({ error: 'filePath query parameter is required' });
    }

    const project = Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!project.folderPath) {
      return res.status(400).json({ error: 'Project has no folder path configured' });
    }

    // Security: Ensure requested path is within project folder
    const resolvedPath = path.resolve(filePath);
    if (!fileScanner.isPathSafe(resolvedPath, project.folderPath)) {
      return res.status(403).json({ error: 'Access denied: Path is outside project folder' });
    }

    const result = fileScanner.readFileContents(resolvedPath);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read file', message: error.message });
  }
});

/**
 * GET /api/files/key-files/:projectId - Get key project files (README, package.json, etc.)
 */
router.get('/key-files/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;

    const project = Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!project.folderPath) {
      return res.status(400).json({ error: 'Project has no folder path configured' });
    }

    const keyFiles = fileScanner.getKeyProjectFiles(project.folderPath);
    res.json({ files: keyFiles });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get key files', message: error.message });
  }
});

/**
 * GET /api/files/context/:projectId - Generate AI context from project
 */
router.get('/context/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { includeTree = 'true', includeKeyFiles = 'true' } = req.query;

    const project = Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!project.folderPath) {
      return res.status(400).json({ error: 'Project has no folder path configured' });
    }

    let context = `# Project: ${project.name}\n\n`;
    context += `${project.description}\n\n`;

    if (includeTree === 'true') {
      try {
        const { tree } = fileScanner.scanDirectory(project.folderPath, { maxDepth: 4 });
        const treeText = fileScanner.generateTreeText(tree, { maxLines: 200 });
        context += `## Project Structure\n\`\`\`\n${treeText}\n\`\`\`\n\n`;
      } catch (e) {
        context += `## Project Structure\n(Unable to scan: ${e.message})\n\n`;
      }
    }

    if (includeKeyFiles === 'true') {
      const keyFiles = fileScanner.getKeyProjectFiles(project.folderPath);

      for (const file of keyFiles) {
        if (file.content) {
          context += `## ${file.name}\n\`\`\`\n${file.content.slice(0, 5000)}\n\`\`\`\n\n`;
        }
      }
    }

    res.json({ context });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate context', message: error.message });
  }
});

/**
 * POST /api/files/validate-path - Validate a folder path exists
 */
router.post('/validate-path', async (req, res) => {
  try {
    const { folderPath } = req.body;

    if (!folderPath) {
      return res.status(400).json({ error: 'folderPath is required' });
    }

    const resolvedPath = path.resolve(folderPath);
    const exists = fs.existsSync(resolvedPath);
    const isDirectory = exists && fs.statSync(resolvedPath).isDirectory();

    res.json({
      valid: exists && isDirectory,
      resolvedPath,
      exists,
      isDirectory,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to validate path', message: error.message });
  }
});

export default router;
