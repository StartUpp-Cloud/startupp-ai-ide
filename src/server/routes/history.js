import express from 'express';
import History from '../models/History.js';

const router = express.Router();

/**
 * GET /api/history - Get all histories
 */
router.get('/', (req, res) => {
  try {
    const histories = History.getAllHistories();
    res.json(histories.map(h => History.getHistorySummary(h.sessionId)));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch histories', message: error.message });
  }
});

/**
 * GET /api/history/project/:projectId - Get histories for a project
 */
router.get('/project/:projectId', (req, res) => {
  try {
    const { projectId } = req.params;
    const histories = History.getHistoriesByProject(projectId);
    res.json(histories.map(h => History.getHistorySummary(h.sessionId)));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch project histories', message: error.message });
  }
});

/**
 * GET /api/history/session/:sessionId - Get full history for a session
 */
router.get('/session/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const history = History.getHistoryBySession(sessionId);

    if (!history) {
      return res.status(404).json({ error: 'History not found' });
    }

    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch history', message: error.message });
  }
});

/**
 * POST /api/history/session/:sessionId/entry - Add entry to history
 */
router.post('/session/:sessionId/entry', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { role, content, metadata } = req.body;

    if (!role || !content) {
      return res.status(400).json({ error: 'role and content are required' });
    }

    const entry = await History.addHistoryEntry(sessionId, {
      role,
      content,
      metadata,
    });

    res.status(201).json(entry);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add history entry', message: error.message });
  }
});

/**
 * POST /api/history - Create new history for session
 */
router.post('/', async (req, res) => {
  try {
    const { sessionId, projectId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const history = await History.createHistory(sessionId, projectId);
    res.status(201).json(history);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create history', message: error.message });
  }
});

/**
 * GET /api/history/search - Search history entries
 */
router.get('/search', (req, res) => {
  try {
    const { q, projectId } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Search query (q) is required' });
    }

    const results = History.searchHistory(q, projectId);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to search history', message: error.message });
  }
});

/**
 * PATCH /api/history/session/:sessionId/metadata - Update history metadata
 */
router.patch('/session/:sessionId/metadata', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const metadata = req.body;

    const history = await History.updateHistoryMetadata(sessionId, metadata);

    if (!history) {
      return res.status(404).json({ error: 'History not found' });
    }

    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update history', message: error.message });
  }
});

/**
 * DELETE /api/history/session/:sessionId - Delete history
 */
router.delete('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const deleted = await History.deleteHistory(sessionId);

    if (!deleted) {
      return res.status(404).json({ error: 'History not found' });
    }

    res.json({ message: 'History deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete history', message: error.message });
  }
});

export default router;
