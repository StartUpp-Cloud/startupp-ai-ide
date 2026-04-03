/**
 * Session History API Routes
 * Endpoints for browsing and managing past terminal sessions.
 */

import express from 'express';
import { sessionHistory } from '../sessionHistory.js';

const router = express.Router();

/**
 * GET / - List history entries
 * Query params: projectId (optional), limit (optional, default 50)
 */
router.get('/', (req, res) => {
  try {
    const { projectId, limit } = req.query;
    const entries = sessionHistory.getHistory(
      projectId || null,
      limit ? parseInt(limit, 10) : 50
    );
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch session history', message: error.message });
  }
});

/**
 * GET /:id - Get a single entry with scrollback content
 */
router.get('/:id', (req, res) => {
  try {
    const entry = sessionHistory.getScrollback(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'Session history entry not found' });
    }
    res.json(entry);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch session history entry', message: error.message });
  }
});

/**
 * DELETE /:id - Delete a history entry and its scrollback file
 */
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await sessionHistory.deleteEntry(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Session history entry not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete session history entry', message: error.message });
  }
});

export default router;
