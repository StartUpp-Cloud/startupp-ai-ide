/**
 * File Routes
 * Handle file operations for project workspaces
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import Project from '../models/Project.js';
import fileScanner from '../fileScanner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ──────────────────────────────────────────────────────────────────────────────
// FILE UPLOADS FOR CHAT ATTACHMENTS
// ──────────────────────────────────────────────────────────────────────────────

const UPLOAD_DIR = path.join(__dirname, '../../data/uploads');
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

// Supported file types for AI assistants
const ALLOWED_TYPES = {
  // Images
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  // Documents
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  // Code
  'application/json': 'json',
  'application/javascript': 'js',
  'text/javascript': 'js',
  'text/typescript': 'ts',
  'text/html': 'html',
  'text/css': 'css',
  'text/xml': 'xml',
  // Office (limited support - content extraction needed)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
};

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const projectId = req.params.projectId || 'general';
    const projectDir = path.join(UPLOAD_DIR, projectId);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    cb(null, projectDir);
  },
  filename: (req, file, cb) => {
    const ext = ALLOWED_TYPES[file.mimetype] || path.extname(file.originalname).slice(1);
    const uniqueName = `${uuidv4()}.${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    // Check if file type is allowed
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    const isAllowedMime = ALLOWED_TYPES[file.mimetype];
    const isAllowedExt = Object.values(ALLOWED_TYPES).includes(ext);

    if (isAllowedMime || isAllowedExt) {
      cb(null, true);
    } else {
      cb(new Error(`File type not supported: ${file.mimetype}`));
    }
  },
});

/**
 * POST /api/files/upload/:projectId - Upload files for chat attachments
 */
router.post('/upload/:projectId', upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const attachments = req.files.map(file => ({
      id: path.basename(file.filename, path.extname(file.filename)),
      name: file.originalname,
      type: file.mimetype,
      size: file.size,
      path: file.path,
      url: `/api/files/download/${req.params.projectId}/${file.filename}`,
    }));

    res.json({ attachments });
  } catch (error) {
    res.status(500).json({ error: 'Upload failed', message: error.message });
  }
});

/**
 * GET /api/files/download/:projectId/:filename - Download/serve an uploaded file
 */
router.get('/download/:projectId/:filename', (req, res) => {
  try {
    const { projectId, filename } = req.params;
    const filePath = path.join(UPLOAD_DIR, projectId, filename);

    // Security: prevent directory traversal
    if (!filePath.startsWith(UPLOAD_DIR)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({ error: 'Download failed', message: error.message });
  }
});

/**
 * DELETE /api/files/upload/:projectId/:fileId - Delete an uploaded file
 */
router.delete('/upload/:projectId/:fileId', (req, res) => {
  try {
    const { projectId, fileId } = req.params;
    const projectDir = path.join(UPLOAD_DIR, projectId);

    // Find the file with this ID (any extension)
    if (!fs.existsSync(projectDir)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const files = fs.readdirSync(projectDir);
    const targetFile = files.find(f => f.startsWith(fileId));

    if (!targetFile) {
      return res.status(404).json({ error: 'File not found' });
    }

    fs.unlinkSync(path.join(projectDir, targetFile));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Delete failed', message: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// EXISTING FILE ROUTES
// ──────────────────────────────────────────────────────────────────────────────

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
