import express from 'express';
import { spawn } from 'child_process';
import os from 'os';
import { CLI_TOOLS, buildCommand, getShellConfig, sanitizeInput } from '../cliTools.js';

const router = express.Router();

/**
 * GET /api/cli/tools - List available CLI tools
 */
router.get('/tools', (req, res) => {
  const tools = Object.values(CLI_TOOLS).map(tool => ({
    id: tool.id,
    name: tool.name,
    description: tool.description,
  }));
  res.json(tools);
});

/**
 * POST /api/cli/check - Check if a CLI tool is installed
 */
router.post('/check', async (req, res) => {
  const { toolId } = req.body;

  const tool = CLI_TOOLS[toolId];
  if (!tool) {
    return res.status(400).json({ error: 'Unknown tool' });
  }

  if (!tool.installCheck) {
    return res.json({ installed: true, message: 'Custom command - cannot verify' });
  }

  const { shell, shellArgs } = getShellConfig();

  try {
    const proc = spawn(shell, [...shellArgs, tool.installCheck], {
      timeout: 5000,
    });

    let output = '';
    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.stderr.on('data', (data) => { output += data.toString(); });

    proc.on('close', (code) => {
      res.json({
        installed: code === 0,
        version: output.trim().split('\n')[0] || null,
      });
    });

    proc.on('error', () => {
      res.json({ installed: false, error: 'Command not found' });
    });
  } catch (error) {
    res.json({ installed: false, error: error.message });
  }
});

/**
 * POST /api/cli/execute - Execute a CLI command (non-streaming)
 */
router.post('/execute', async (req, res) => {
  const { toolId, prompt, customCommand, timeout = 60000 } = req.body;

  if (!toolId) {
    return res.status(400).json({ error: 'toolId is required' });
  }

  if (toolId !== 'custom' && !prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  try {
    const sanitizedPrompt = sanitizeInput(prompt);
    const { command, args } = buildCommand(toolId, sanitizedPrompt, customCommand);
    const { shell, shellArgs } = getShellConfig();

    // Build full command string for shell execution
    const fullCommand = command
      ? `${command} ${args.map(a => `"${a}"`).join(' ')}`
      : customCommand;

    const proc = spawn(shell, [...shellArgs, fullCommand], {
      timeout: Math.min(timeout, 300000), // max 5 minutes
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      res.json({
        success: code === 0,
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        tool: toolId,
      });
    });

    proc.on('error', (error) => {
      res.status(500).json({
        success: false,
        error: error.message,
        tool: toolId,
      });
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/cli/stream - Execute CLI with Server-Sent Events streaming
 * Query params: toolId, prompt, customCommand
 */
router.get('/stream', (req, res) => {
  const { toolId, prompt, customCommand } = req.query;

  if (!toolId) {
    return res.status(400).json({ error: 'toolId is required' });
  }

  if (toolId !== 'custom' && !prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Helper to send SSE events
  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const sanitizedPrompt = sanitizeInput(prompt);
    const { command, args } = buildCommand(toolId, sanitizedPrompt, customCommand);
    const { shell, shellArgs } = getShellConfig();

    const fullCommand = command
      ? `${command} ${args.map(a => `"${a}"`).join(' ')}`
      : customCommand;

    sendEvent('start', { tool: toolId, command: fullCommand, timestamp: Date.now() });

    const proc = spawn(shell, [...shellArgs, fullCommand], {
      env: { ...process.env },
    });

    proc.stdout.on('data', (data) => {
      sendEvent('stdout', { text: data.toString() });
    });

    proc.stderr.on('data', (data) => {
      sendEvent('stderr', { text: data.toString() });
    });

    proc.on('close', (code) => {
      sendEvent('end', { exitCode: code, success: code === 0 });
      res.end();
    });

    proc.on('error', (error) => {
      sendEvent('error', { message: error.message });
      res.end();
    });

    // Handle client disconnect
    req.on('close', () => {
      proc.kill('SIGTERM');
    });

  } catch (error) {
    sendEvent('error', { message: error.message });
    res.end();
  }
});

/**
 * GET /api/cli/system-info - Get system information
 */
router.get('/system-info', (req, res) => {
  res.json({
    platform: os.platform(),
    arch: os.arch(),
    shell: process.env.SHELL || (os.platform() === 'win32' ? 'powershell' : '/bin/sh'),
    homeDir: os.homedir(),
    nodeVersion: process.version,
  });
});

export default router;
