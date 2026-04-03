/**
 * Branch Review API Routes
 * Endpoints for the "Explain Branch" feature — analyzes git changes
 * and uses the LLM to explain each changed file.
 *
 * Supports both local projects (projectPath) and container projects (containerName + workDir).
 */

import express from 'express';
import { execSync } from 'child_process';
import { llmProvider } from '../llmProvider.js';
import { findProjectById } from '../models/Project.js';
import { containerManager } from '../containerManager.js';
import path from 'path';

const router = express.Router();
const MAX_DIFF_LENGTH = 5000;

// ── Git execution helpers ─────────────────────────────────────────────────────

/**
 * Run a git (or any shell) command — locally or inside a Docker container.
 * @param {string} cmd - The shell command to run
 * @param {Object} ctx - Execution context
 * @param {string} [ctx.projectPath] - Local filesystem path (for local projects)
 * @param {string} [ctx.containerName] - Docker container name (for container projects)
 * @param {string} [ctx.workDir] - Working directory inside the container
 * @returns {string} trimmed stdout
 */
function run(cmd, ctx) {
  if (ctx.containerName) {
    const dir = ctx.workDir || '/workspace';
    const escaped = cmd.replace(/"/g, '\\"');
    return execSync(`docker exec -w "${dir}" ${ctx.containerName} bash -c "${escaped}"`, {
      encoding: 'utf-8', stdio: 'pipe', timeout: 30000,
    }).trim();
  }
  return execSync(cmd, { cwd: ctx.projectPath, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

/**
 * Resolve execution context from a projectId.
 * Returns { projectPath, containerName, workDir } or null.
 */
function resolveContext(projectId) {
  if (!projectId) return null;
  const project = findProjectById(projectId);
  if (!project) return null;

  if (project.containerName) {
    // Container project — find the first git repo inside /workspace
    const status = containerManager.getContainerStatus(project.containerName);
    if (!status || status !== 'running') return null;

    let workDir = '/workspace';
    try {
      // Find git repos inside /workspace
      const dirs = containerManager.execInContainer(project.containerName, 'ls -d /workspace/*/ 2>/dev/null');
      if (dirs) {
        const dirList = dirs.split('\n').filter(Boolean).map(d => d.replace(/\/$/, ''));
        // Pick the first one that's a git repo
        for (const dir of dirList) {
          const isGit = containerManager.execInContainer(project.containerName, `test -d ${dir}/.git && echo yes`);
          if (isGit === 'yes') { workDir = dir; break; }
        }
      }
    } catch { /* use /workspace */ }

    return { containerName: project.containerName, workDir, projectPath: null };
  }

  if (project.folderPath) {
    return { projectPath: project.folderPath, containerName: null, workDir: null };
  }

  return null;
}

function mapGitStatus(letter) {
  switch (letter) {
    case 'A': return 'added';
    case 'M': return 'modified';
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    default: return 'modified';
  }
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

/**
 * GET /api/branch-review/commits
 * Returns recent commits for the user to select which ones to review.
 * Query: projectId, count (default 20)
 */
router.get('/commits', (req, res) => {
  try {
    const { projectId, count = 20 } = req.query;
    const ctx = resolveContext(projectId);
    if (!ctx) return res.status(400).json({ error: 'Could not resolve project. Is the container running?' });

    const n = Math.max(1, Math.min(parseInt(count, 10) || 20, 100));

    let branch = 'unknown';
    try { branch = run('git branch --show-current', ctx); } catch {}

    let logOutput = '';
    try {
      logOutput = run(`git log --oneline --format="%H||%h||%s||%an||%ar" -${n}`, ctx);
    } catch {}

    const commits = logOutput ? logOutput.split('\n').map(line => {
      const [hash, shortHash, message, author, timeAgo] = line.split('||');
      return { hash, shortHash, message, author, timeAgo };
    }) : [];

    res.json({ branch, commits });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get commits', message: error.message });
  }
});

/**
 * GET /api/branch-review/changes
 * Returns changed files with diffs.
 * Query: projectId, fromCommit, toCommit, mode (commits|working)
 */
router.get('/changes', (req, res) => {
  try {
    const { projectId, fromCommit, toCommit, mode = 'commits' } = req.query;
    const ctx = resolveContext(projectId);
    if (!ctx) return res.status(400).json({ error: 'Could not resolve project. Is the container running?' });

    let currentBranch = 'unknown';
    try { currentBranch = run('git branch --show-current', ctx); } catch {}

    let diffRange;
    if (mode === 'working') {
      diffRange = 'HEAD';
    } else {
      if (!fromCommit) return res.status(400).json({ error: 'fromCommit is required for commits mode' });
      diffRange = toCommit ? `${fromCommit}..${toCommit}` : `${fromCommit}..HEAD`;
    }

    // Get changed files
    let nameStatusOutput = '';
    try {
      if (mode === 'working') {
        const staged = run('git diff --cached --name-status', ctx);
        const unstaged = run('git diff --name-status', ctx);
        let untracked = '';
        try { untracked = run('git ls-files --others --exclude-standard', ctx); } catch {}

        const parts = [];
        if (staged) parts.push(staged);
        if (unstaged) parts.push(unstaged);
        if (untracked) {
          parts.push(untracked.split('\n').filter(Boolean).map(f => `A\t${f}`).join('\n'));
        }
        nameStatusOutput = parts.join('\n');

        // Deduplicate
        const seen = new Set();
        nameStatusOutput = nameStatusOutput.split('\n').filter(line => {
          if (!line.trim()) return false;
          const filePath = line.split('\t').slice(-1)[0];
          if (seen.has(filePath)) return false;
          seen.add(filePath);
          return true;
        }).join('\n');
      } else {
        nameStatusOutput = run(`git diff --name-status ${diffRange}`, ctx);
      }
    } catch (error) {
      return res.status(400).json({ error: 'Failed to get git diff', message: error.message });
    }

    if (!nameStatusOutput) {
      return res.json({
        branch: currentBranch, mode, files: [],
        summary: { added: 0, modified: 0, deleted: 0, renamed: 0, total: 0 },
      });
    }

    const lines = nameStatusOutput.split('\n').filter(Boolean);
    const summary = { added: 0, modified: 0, deleted: 0, renamed: 0, total: 0 };

    const files = lines.map(line => {
      const parts = line.split('\t');
      const statusLetter = parts[0].charAt(0);
      const filePath = statusLetter === 'R' ? parts[2] : parts[1];
      const status = mapGitStatus(statusLetter);
      if (summary[status] !== undefined) summary[status]++;
      summary.total++;

      let diff = '';
      try {
        if (mode === 'working') {
          diff = run(`git diff --cached -- "${filePath}"`, ctx);
          if (!diff) diff = run(`git diff -- "${filePath}"`, ctx);
          if (!diff && status === 'added') {
            try { diff = `(new file)\n${run(`head -100 "${filePath}"`, ctx)}`; }
            catch { diff = '(new untracked file)'; }
          }
        } else {
          diff = run(`git diff ${diffRange} -- "${filePath}"`, ctx);
        }
        if (diff.length > MAX_DIFF_LENGTH) diff = diff.slice(0, MAX_DIFF_LENGTH) + '\n... [truncated]';
      } catch { diff = '(unable to retrieve diff)'; }

      return { path: filePath, status, diff, directory: path.dirname(filePath), extension: path.extname(filePath) };
    });

    res.json({
      branch: currentBranch, mode,
      fromCommit: mode === 'commits' ? fromCommit : null,
      toCommit: mode === 'commits' ? (toCommit || 'HEAD') : null,
      files, summary,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get changes', message: error.message });
  }
});

/**
 * POST /api/branch-review/explain-file
 * Uses the LLM to explain a file change.
 * Body: { filePath, diff, status }
 */
router.post('/explain-file', async (req, res) => {
  try {
    const { filePath, diff, status } = req.body;
    if (!filePath || !diff) return res.status(400).json({ error: 'filePath and diff are required' });
    if (!llmProvider.getSettings().enabled) return res.status(400).json({ error: 'LLM is not enabled' });

    const systemPrompt = `You analyze git diffs for a development team. Given a file diff, explain what changed and why.

Return ONLY valid JSON:
{
  "explanation": "2-3 sentence explanation of what this change accomplishes",
  "impact": "high|medium|low|cosmetic",
  "category": "feature|bugfix|refactor|config|test|docs|style",
  "keyChanges": ["list", "of", "key", "changes", "max 5 items"]
}

Impact: high=new feature/breaking/security, medium=improvement/bugfix, low=minor fix, cosmetic=formatting.
Category: feature/bugfix/refactor/config/test/docs/style.`;

    const result = await llmProvider.generateResponse(
      `File: ${filePath}\nStatus: ${status || 'modified'}\n\nDiff:\n${diff}`,
      { systemPrompt, maxTokens: 1024, temperature: 0.3 },
    );

    const cleaned = result.response.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    let explanation;
    try {
      const match = cleaned.match(/\{[\s\S]*\}/);
      explanation = JSON.parse(match ? match[0] : cleaned);
    } catch {
      return res.status(500).json({ error: 'Failed to parse LLM response', raw: cleaned.slice(0, 500) });
    }

    const validImpacts = ['high', 'medium', 'low', 'cosmetic'];
    const validCategories = ['feature', 'bugfix', 'refactor', 'config', 'test', 'docs', 'style'];
    res.json({
      explanation: (typeof explanation.explanation === 'string' ? explanation.explanation : 'No explanation.').slice(0, 1000),
      impact: validImpacts.includes(explanation.impact) ? explanation.impact : 'medium',
      category: validCategories.includes(explanation.category) ? explanation.category : 'feature',
      keyChanges: Array.isArray(explanation.keyChanges) ? explanation.keyChanges.filter(c => typeof c === 'string').slice(0, 5) : [],
    });
  } catch (error) {
    res.status(500).json({ error: 'File explanation failed', message: error.message });
  }
});

/**
 * POST /api/branch-review/summarize
 * Generate overall summary from file explanations.
 * Body: { fileExplanations: [{ path, status, explanation, impact, category }] }
 */
router.post('/summarize', async (req, res) => {
  try {
    const { fileExplanations } = req.body;
    if (!fileExplanations?.length) return res.status(400).json({ error: 'fileExplanations required' });
    if (!llmProvider.getSettings().enabled) return res.status(400).json({ error: 'LLM is not enabled' });

    const stats = { added: 0, modified: 0, deleted: 0, renamed: 0 };
    for (const f of fileExplanations) { if (stats[f.status] !== undefined) stats[f.status]++; }

    const systemPrompt = `You analyze collections of file changes. Produce an overall summary.

Return ONLY valid JSON:
{
  "title": "Short title (max 80 chars)",
  "summary": "2-4 sentence summary",
  "highlights": ["key accomplishment 1", "max 5"],
  "risks": ["potential concern 1", "max 3, or empty"]
}`;

    const filesSummary = fileExplanations.map(f =>
      `- ${f.path} (${f.status}, ${f.impact}, ${f.category}): ${f.explanation}`
    ).join('\n');

    const result = await llmProvider.generateResponse(
      `Changes (${fileExplanations.length} files):\n\n${filesSummary}`,
      { systemPrompt, maxTokens: 1024, temperature: 0.3 },
    );

    const cleaned = result.response.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    let summary;
    try {
      const match = cleaned.match(/\{[\s\S]*\}/);
      summary = JSON.parse(match ? match[0] : cleaned);
    } catch {
      return res.status(500).json({ error: 'Failed to parse summary', raw: cleaned.slice(0, 500) });
    }

    res.json({
      title: (typeof summary.title === 'string' ? summary.title : 'Branch Changes').slice(0, 120),
      summary: (typeof summary.summary === 'string' ? summary.summary : 'No summary.').slice(0, 2000),
      highlights: Array.isArray(summary.highlights) ? summary.highlights.filter(h => typeof h === 'string').slice(0, 5) : [],
      risks: Array.isArray(summary.risks) ? summary.risks.filter(r => typeof r === 'string').slice(0, 3) : [],
      stats,
    });
  } catch (error) {
    res.status(500).json({ error: 'Summarization failed', message: error.message });
  }
});

export default router;
