/**
 * Auto-Responder API Routes
 */

import express from 'express';
import { autoResponder, DEFAULT_PATTERNS, ACTIONS, CATEGORIES } from '../autoResponder.js';

const router = express.Router();

/**
 * GET /api/auto-responder/settings - Get global settings
 */
router.get('/settings', (req, res) => {
  try {
    const settings = autoResponder.getSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get settings', message: error.message });
  }
});

/**
 * PUT /api/auto-responder/settings - Update global settings
 */
router.put('/settings', async (req, res) => {
  try {
    const settings = await autoResponder.updateSettings(req.body);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings', message: error.message });
  }
});

/**
 * GET /api/auto-responder/patterns - Get all patterns
 */
router.get('/patterns', (req, res) => {
  try {
    const patterns = autoResponder.getPatterns();
    res.json(patterns);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get patterns', message: error.message });
  }
});

/**
 * POST /api/auto-responder/patterns - Add a new pattern
 */
router.post('/patterns', async (req, res) => {
  try {
    const { name, pattern, cli, category, action, responses, defaultResponse, description } = req.body;

    if (!name || !pattern) {
      return res.status(400).json({ error: 'name and pattern are required' });
    }

    // Validate the regex pattern
    try {
      new RegExp(pattern, 'im');
    } catch (e) {
      return res.status(400).json({ error: 'Invalid regex pattern', message: e.message });
    }

    const newPattern = await autoResponder.addPattern({
      name,
      pattern,
      cli: cli || 'generic',
      category: category || 'custom',
      action: action || 'suggest',
      responses: responses || ['y', 'n'],
      defaultResponse: defaultResponse ?? 'y',
      description: description || '',
    });

    res.status(201).json(newPattern);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add pattern', message: error.message });
  }
});

/**
 * PUT /api/auto-responder/patterns/:id - Update a pattern
 */
router.put('/patterns/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Validate regex if pattern is being updated
    if (updates.pattern) {
      try {
        new RegExp(updates.pattern, 'im');
      } catch (e) {
        return res.status(400).json({ error: 'Invalid regex pattern', message: e.message });
      }
    }

    const pattern = await autoResponder.updatePattern(id, updates);

    if (!pattern) {
      return res.status(404).json({ error: 'Pattern not found' });
    }

    res.json(pattern);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update pattern', message: error.message });
  }
});

/**
 * DELETE /api/auto-responder/patterns/:id - Delete a pattern
 */
router.delete('/patterns/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await autoResponder.deletePattern(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Pattern not found' });
    }

    res.json({ message: 'Pattern deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete pattern', message: error.message });
  }
});

/**
 * POST /api/auto-responder/test - Test a pattern against text
 */
router.post('/test', (req, res) => {
  try {
    const { text, pattern, cliTool } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    // If pattern provided, test just that pattern
    if (pattern) {
      try {
        const regex = new RegExp(pattern, 'im');
        const match = text.match(regex);
        res.json({
          matched: !!match,
          matchedText: match ? match[0] : null,
        });
      } catch (e) {
        return res.status(400).json({ error: 'Invalid regex pattern', message: e.message });
      }
    } else {
      // Otherwise, check all patterns
      const result = autoResponder.checkForPrompt(text, 'test-session', cliTool || 'generic');
      res.json({
        matched: !!result,
        result,
      });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to test pattern', message: error.message });
  }
});

/**
 * POST /api/auto-responder/reset - Reset to default patterns
 */
router.post('/reset', async (req, res) => {
  try {
    const config = await autoResponder.resetToDefaults();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset patterns', message: error.message });
  }
});

/**
 * GET /api/auto-responder/defaults - Get default patterns (for reference)
 */
router.get('/defaults', (req, res) => {
  res.json({
    patterns: DEFAULT_PATTERNS,
    actions: ACTIONS,
    categories: CATEGORIES,
  });
});

export default router;
