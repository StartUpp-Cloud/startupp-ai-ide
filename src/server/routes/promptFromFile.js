/**
 * Prompt from File Routes
 * Handle file uploads, local file reads, text input, git diffs, and terminal output
 * to generate AI-actionable prompts via the LLM.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { llmProvider } from '../llmProvider.js';
import Project from '../models/Project.js';

const router = express.Router();

// Allowed file extensions for upload
const ALLOWED_EXTENSIONS = new Set([
  '.txt', '.md', '.pdf', '.js', '.ts', '.jsx', '.tsx',
  '.py', '.go', '.rs', '.java', '.rb', '.json', '.yaml',
  '.yml', '.toml', '.html', '.css', '.sql', '.sh', '.csv',
  '.env.example',
]);

// 10MB max decoded size
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// System prompt shared across all endpoints
const PROMPT_ENGINEER_SYSTEM = `You are an expert prompt engineer. You've been given a file that the developer wants to act on.
Your job is to:
1. Read and understand the file content
2. Create a clear, actionable prompt that an AI coding assistant can execute

The prompt should reference the file content as context and include specific, actionable instructions.
If the file is a spec/design doc: create implementation instructions.
If the file is code: create a review/improvement prompt.
If the file is a bug report: create a fix prompt.
If the file has a user instruction, follow that instruction.

Output ONLY the prompt text, no explanations.`;

/**
 * Build project context string if a projectId is provided.
 */
function buildProjectContext(projectId) {
  if (!projectId) return '';

  const project = Project.findById(projectId);
  if (!project) return '';

  let ctx = `\nProject: ${project.name}\nDescription: ${project.description}`;
  if (project.rules?.length > 0) {
    ctx += `\nProject Rules:\n${project.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
  }
  if (project.folderPath) {
    ctx += `\nWorkspace: ${project.folderPath}`;
  }
  return ctx;
}

/**
 * Send content to the LLM and return a generated prompt.
 */
async function generatePromptFromContent({ label, content, instruction, projectId }) {
  if (!llmProvider.getSettings().enabled) {
    throw Object.assign(new Error('LLM is not enabled. Enable it in LLM Settings.'), { statusCode: 400 });
  }

  const projectContext = buildProjectContext(projectId);
  const systemPrompt = PROMPT_ENGINEER_SYSTEM + projectContext;

  const userInstruction = instruction?.trim() || 'Analyze this file and create an appropriate prompt.';
  const userPrompt = `File: ${label}\nUser instruction: ${userInstruction}\n\nFile content:\n${content}`;

  const result = await llmProvider.generateResponse(userPrompt, {
    systemPrompt,
    maxTokens: 8192,
    temperature: 0.4,
  });

  // Strip any <think>...</think> blocks from models that use internal reasoning
  const cleanedPrompt = result.response.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  return {
    prompt: cleanedPrompt,
    provider: result.provider,
    model: result.model,
  };
}

/**
 * Check whether a buffer looks like readable text (not binary garbage).
 */
function isReadableText(buffer) {
  // Sample the first 8KB
  const sample = buffer.subarray(0, 8192);
  let nonPrintable = 0;

  for (const byte of sample) {
    // Allow tab, newline, carriage return, and printable ASCII + extended UTF-8
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20 && byte !== 0x1b)) {
      nonPrintable++;
    }
  }

  // If more than 10% is non-printable, treat as binary
  return nonPrintable / sample.length < 0.1;
}

// ---------------------------------------------------------------------------
// POST /api/prompt-from-file/upload
// Accept a base64-encoded file via JSON body (no multer dependency needed).
// Body: { fileName, fileContent (base64), projectId?, instruction? }
// ---------------------------------------------------------------------------
router.post('/upload', async (req, res) => {
  try {
    const { fileName, fileContent, projectId, instruction } = req.body;

    if (!fileName || !fileContent) {
      return res.status(400).json({ error: 'fileName and fileContent (base64) are required' });
    }

    // Validate extension
    const ext = path.extname(fileName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext) && ext !== '') {
      return res.status(400).json({
        error: `File type "${ext}" is not supported. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`,
      });
    }

    // Decode base64
    const buffer = Buffer.from(fileContent, 'base64');

    if (buffer.length > MAX_FILE_SIZE) {
      return res.status(400).json({ error: `File exceeds maximum size of ${MAX_FILE_SIZE / (1024 * 1024)}MB` });
    }

    // Check if the content is readable text
    if (!isReadableText(buffer)) {
      return res.status(400).json({
        error: 'File appears to be binary and cannot be processed as text. For PDF files, please convert to text first or paste the content directly.',
      });
    }

    const content = buffer.toString('utf-8');

    if (!content.trim()) {
      return res.status(400).json({ error: 'File is empty' });
    }

    const result = await generatePromptFromContent({
      label: fileName,
      content,
      instruction,
      projectId,
    });

    res.json({
      ...result,
      fileName,
      fileType: ext || 'text',
      fileSize: buffer.length,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: 'Failed to generate prompt from uploaded file', message: error.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/prompt-from-file/read-local
// Read a file from the server filesystem (for files already in the project).
// Body: { filePath, projectId?, instruction? }
// ---------------------------------------------------------------------------
router.post('/read-local', async (req, res) => {
  try {
    const { filePath, projectId, instruction } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'filePath is required' });
    }

    const resolvedPath = path.resolve(filePath);

    // If a projectId is given, verify the file is within the project folder
    if (projectId) {
      const project = Project.findById(projectId);
      if (project?.folderPath) {
        const projectFolder = path.resolve(project.folderPath);
        if (!resolvedPath.startsWith(projectFolder + path.sep) && resolvedPath !== projectFolder) {
          return res.status(403).json({ error: 'Access denied: file path is outside the project folder' });
        }
      }
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'File not found', filePath: resolvedPath });
    }

    const stat = fs.statSync(resolvedPath);

    if (stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is a directory, not a file' });
    }

    if (stat.size > MAX_FILE_SIZE) {
      return res.status(400).json({ error: `File exceeds maximum size of ${MAX_FILE_SIZE / (1024 * 1024)}MB` });
    }

    const buffer = fs.readFileSync(resolvedPath);

    if (!isReadableText(buffer)) {
      return res.status(400).json({
        error: 'File appears to be binary and cannot be processed as text.',
      });
    }

    const content = buffer.toString('utf-8');

    if (!content.trim()) {
      return res.status(400).json({ error: 'File is empty' });
    }

    const fileName = path.basename(resolvedPath);
    const ext = path.extname(fileName).toLowerCase();

    const result = await generatePromptFromContent({
      label: fileName,
      content,
      instruction,
      projectId,
    });

    res.json({
      ...result,
      fileName,
      fileType: ext || 'text',
      fileSize: stat.size,
      filePath: resolvedPath,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: 'Failed to generate prompt from local file', message: error.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/prompt-from-file/from-text
// Generate a prompt from pasted text content.
// Body: { content, projectId?, instruction?, label? }
// ---------------------------------------------------------------------------
router.post('/from-text', async (req, res) => {
  try {
    const { content, projectId, instruction, label } = req.body;

    if (!content?.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    const result = await generatePromptFromContent({
      label: label || 'pasted-text',
      content,
      instruction,
      projectId,
    });

    res.json({
      ...result,
      label: label || 'pasted-text',
      contentLength: content.length,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: 'Failed to generate prompt from text', message: error.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/prompt-from-file/from-git-diff
// Generate a prompt from the current git diff in the project.
// Body: { projectPath, projectId?, instruction? }
// ---------------------------------------------------------------------------
router.post('/from-git-diff', async (req, res) => {
  try {
    const { projectPath, projectId, instruction } = req.body;

    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    const resolvedPath = path.resolve(projectPath);

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'Project path does not exist' });
    }

    // Verify it's a git repository
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: resolvedPath,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch {
      return res.status(400).json({ error: 'Directory is not a git repository' });
    }

    // Get the diff (staged + unstaged)
    let diff;
    try {
      // Include both staged and unstaged changes
      const stagedDiff = execSync('git diff --cached', {
        cwd: resolvedPath,
        encoding: 'utf-8',
        stdio: 'pipe',
        maxBuffer: MAX_FILE_SIZE,
      });
      const unstagedDiff = execSync('git diff', {
        cwd: resolvedPath,
        encoding: 'utf-8',
        stdio: 'pipe',
        maxBuffer: MAX_FILE_SIZE,
      });

      diff = '';
      if (stagedDiff.trim()) {
        diff += `=== Staged Changes ===\n${stagedDiff}\n`;
      }
      if (unstagedDiff.trim()) {
        diff += `=== Unstaged Changes ===\n${unstagedDiff}\n`;
      }
    } catch (err) {
      return res.status(500).json({ error: 'Failed to run git diff', message: err.message });
    }

    if (!diff.trim()) {
      return res.status(400).json({ error: 'No changes detected in the git repository (working tree is clean)' });
    }

    const result = await generatePromptFromContent({
      label: `git-diff (${path.basename(resolvedPath)})`,
      content: diff,
      instruction: instruction || 'Review this git diff and create an appropriate prompt.',
      projectId,
    });

    res.json({
      ...result,
      projectPath: resolvedPath,
      diffLength: diff.length,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: 'Failed to generate prompt from git diff', message: error.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/prompt-from-file/from-terminal-output
// Generate a prompt from captured terminal output.
// Body: { output, projectId?, instruction? }
// ---------------------------------------------------------------------------
router.post('/from-terminal-output', async (req, res) => {
  try {
    const { output, projectId, instruction } = req.body;

    if (!output?.trim()) {
      return res.status(400).json({ error: 'output is required' });
    }

    const result = await generatePromptFromContent({
      label: 'terminal-output',
      content: output,
      instruction: instruction || 'Analyze this terminal output and create a prompt to fix any errors or continue from here.',
      projectId,
    });

    res.json({
      ...result,
      outputLength: output.length,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: 'Failed to generate prompt from terminal output', message: error.message });
  }
});

export default router;
