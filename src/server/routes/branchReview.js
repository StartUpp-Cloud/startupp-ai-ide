/**
 * Branch Review API Routes
 * Endpoints for the "Explain Branch" feature — analyzes git changes
 * (branch diff or recent commits) and uses the LLM to explain each changed file.
 */

import express from 'express';
import { execSync } from 'child_process';
import { llmProvider } from '../llmProvider.js';
import path from 'path';

const router = express.Router();

const MAX_DIFF_LENGTH = 5000;

const GIT_EXEC_OPTIONS = (projectPath) => ({
  cwd: projectPath,
  encoding: 'utf-8',
  stdio: 'pipe',
});

/**
 * Map git status letter to human-readable status
 */
function mapGitStatus(letter) {
  switch (letter) {
    case 'A': return 'added';
    case 'M': return 'modified';
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    default: return 'modified';
  }
}

/**
 * GET /api/branch-review/changes
 * Returns the list of changed files with their status and diff.
 *
 * Query params:
 *   projectPath - path to the git repository
 *   mode        - 'branch' | 'recent' (default: 'branch')
 *   baseBranch  - base branch to compare against (default: 'main')
 *   commitCount - number of recent commits for 'recent' mode (default: 5)
 */
router.get('/changes', (req, res) => {
  try {
    const { projectPath, mode = 'branch', baseBranch = 'main', commitCount = 5 } = req.query;

    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    const opts = GIT_EXEC_OPTIONS(projectPath);
    const count = Math.max(1, Math.min(parseInt(commitCount, 10) || 5, 50));

    // Get current branch name
    let currentBranch;
    try {
      currentBranch = execSync('git branch --show-current', opts).trim();
    } catch {
      currentBranch = 'unknown';
    }

    // Build the diff range based on mode
    const diffRange = mode === 'recent'
      ? `HEAD~${count}..HEAD`
      : `${baseBranch}...HEAD`;

    // Get list of changed files with status
    let nameStatusOutput;
    try {
      nameStatusOutput = execSync(`git diff --name-status ${diffRange}`, opts).trim();
    } catch (error) {
      return res.status(400).json({
        error: 'Failed to get git diff',
        message: error.message,
      });
    }

    if (!nameStatusOutput) {
      return res.json({
        branch: currentBranch,
        baseBranch: mode === 'branch' ? baseBranch : null,
        mode,
        files: [],
        summary: { added: 0, modified: 0, deleted: 0, renamed: 0, total: 0 },
      });
    }

    const lines = nameStatusOutput.split('\n').filter(Boolean);
    const summary = { added: 0, modified: 0, deleted: 0, renamed: 0, total: 0 };

    const files = lines.map((line) => {
      // Format: "M\tsrc/file.ts" or "R100\told.ts\tnew.ts"
      const parts = line.split('\t');
      const statusLetter = parts[0].charAt(0);
      const filePath = statusLetter === 'R' ? parts[2] : parts[1];
      const status = mapGitStatus(statusLetter);

      // Count by status
      if (summary[status] !== undefined) {
        summary[status]++;
      }
      summary.total++;

      // Get the diff for this file
      let diff = '';
      try {
        diff = execSync(`git diff ${diffRange} -- "${filePath}"`, opts).trim();
        if (diff.length > MAX_DIFF_LENGTH) {
          diff = diff.slice(0, MAX_DIFF_LENGTH) + '\n... [truncated]';
        }
      } catch {
        diff = '(unable to retrieve diff)';
      }

      return {
        path: filePath,
        status,
        diff,
        directory: path.dirname(filePath),
        extension: path.extname(filePath),
      };
    });

    res.json({
      branch: currentBranch,
      baseBranch: mode === 'branch' ? baseBranch : null,
      mode,
      files,
      summary,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get changes', message: error.message });
  }
});

/**
 * POST /api/branch-review/explain-file
 * Uses the LLM to explain what a specific file change accomplishes.
 *
 * Body: { projectPath, filePath, diff, status, projectId }
 */
router.post('/explain-file', async (req, res) => {
  try {
    const { projectPath, filePath, diff, status, projectId } = req.body;

    if (!filePath || !diff) {
      return res.status(400).json({ error: 'filePath and diff are required' });
    }

    if (!llmProvider.getSettings().enabled) {
      return res.status(400).json({ error: 'LLM is not enabled. Enable it in LLM Settings.' });
    }

    const systemPrompt = `You analyze git diffs for a development team. Given a file diff, explain what changed and why.

Return ONLY valid JSON:
{
  "explanation": "2-3 sentence explanation of what this change accomplishes",
  "impact": "high|medium|low|cosmetic",
  "category": "feature|bugfix|refactor|config|test|docs|style",
  "keyChanges": ["list", "of", "key", "changes", "max 5 items"]
}

Impact levels:
- high: new feature, breaking change, security fix, architecture change
- medium: significant improvement, non-trivial bugfix, new test coverage
- low: minor fix, small improvement, dependency update
- cosmetic: formatting, comments, rename, whitespace

Categories:
- feature: new functionality
- bugfix: fixing broken behavior
- refactor: restructuring without behavior change
- config: configuration, build, CI/CD changes
- test: test additions or modifications
- docs: documentation changes
- style: formatting, linting, cosmetic changes`;

    const userPrompt = `File: ${filePath}\nStatus: ${status || 'modified'}\n\nDiff:\n${diff}`;

    const result = await llmProvider.generateResponse(userPrompt, {
      systemPrompt,
      maxTokens: 1024,
      temperature: 0.3,
    });

    // Strip <think>...</think> blocks from reasoning models
    const cleanedResponse = result.response.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    // Parse JSON from the response
    let explanation;
    try {
      let jsonStr = cleanedResponse;
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];
      explanation = JSON.parse(jsonStr);
    } catch {
      return res.status(500).json({
        error: 'Failed to parse explanation from LLM response',
        raw: cleanedResponse.slice(0, 500),
      });
    }

    // Validate and sanitize the structure
    const validImpacts = ['high', 'medium', 'low', 'cosmetic'];
    const validCategories = ['feature', 'bugfix', 'refactor', 'config', 'test', 'docs', 'style'];

    const sanitized = {
      explanation: typeof explanation.explanation === 'string'
        ? explanation.explanation.slice(0, 1000)
        : 'No explanation provided.',
      impact: validImpacts.includes(explanation.impact) ? explanation.impact : 'medium',
      category: validCategories.includes(explanation.category) ? explanation.category : 'feature',
      keyChanges: Array.isArray(explanation.keyChanges)
        ? explanation.keyChanges.filter((c) => typeof c === 'string').slice(0, 5)
        : [],
    };

    res.json(sanitized);
  } catch (error) {
    res.status(500).json({ error: 'File explanation failed', message: error.message });
  }
});

/**
 * POST /api/branch-review/summarize
 * Takes all individual file explanations and generates an overall branch summary.
 *
 * Body: { projectPath, mode, baseBranch, commitCount, projectId, fileExplanations }
 *   fileExplanations is an array of { path, status, explanation, impact, category, keyChanges }
 */
router.post('/summarize', async (req, res) => {
  try {
    const { projectPath, mode, baseBranch, commitCount, projectId, fileExplanations } = req.body;

    if (!fileExplanations || !Array.isArray(fileExplanations) || fileExplanations.length === 0) {
      return res.status(400).json({ error: 'fileExplanations array is required and must not be empty' });
    }

    if (!llmProvider.getSettings().enabled) {
      return res.status(400).json({ error: 'LLM is not enabled. Enable it in LLM Settings.' });
    }

    // Build stats from the file explanations
    const stats = { added: 0, modified: 0, deleted: 0, renamed: 0 };
    for (const file of fileExplanations) {
      if (stats[file.status] !== undefined) {
        stats[file.status]++;
      }
    }

    const systemPrompt = `You analyze collections of file changes for a development branch. Given individual file explanations, produce an overall branch summary.

Return ONLY valid JSON:
{
  "title": "Short descriptive title for what this branch/set of changes accomplishes (max 80 chars)",
  "summary": "2-4 sentence summary of the overall purpose and scope of changes",
  "highlights": ["key accomplishment 1", "key accomplishment 2", "max 5 items"],
  "risks": ["potential risk or concern 1", "max 3 items, or empty array if none"]
}`;

    const filesSummary = fileExplanations.map((f) =>
      `- ${f.path} (${f.status}, ${f.impact} impact, ${f.category}): ${f.explanation}`
    ).join('\n');

    const userPrompt = `Branch changes (${fileExplanations.length} files):\n\n${filesSummary}`;

    const result = await llmProvider.generateResponse(userPrompt, {
      systemPrompt,
      maxTokens: 1024,
      temperature: 0.3,
    });

    // Strip <think>...</think> blocks
    const cleanedResponse = result.response.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    // Parse JSON from the response
    let summary;
    try {
      let jsonStr = cleanedResponse;
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];
      summary = JSON.parse(jsonStr);
    } catch {
      return res.status(500).json({
        error: 'Failed to parse summary from LLM response',
        raw: cleanedResponse.slice(0, 500),
      });
    }

    // Validate and sanitize the structure
    const sanitized = {
      title: typeof summary.title === 'string'
        ? summary.title.slice(0, 120)
        : 'Branch Changes',
      summary: typeof summary.summary === 'string'
        ? summary.summary.slice(0, 2000)
        : 'No summary available.',
      highlights: Array.isArray(summary.highlights)
        ? summary.highlights.filter((h) => typeof h === 'string').slice(0, 5)
        : [],
      risks: Array.isArray(summary.risks)
        ? summary.risks.filter((r) => typeof r === 'string').slice(0, 3)
        : [],
      stats,
    };

    res.json(sanitized);
  } catch (error) {
    res.status(500).json({ error: 'Branch summarization failed', message: error.message });
  }
});

export default router;
