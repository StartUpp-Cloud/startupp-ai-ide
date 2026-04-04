import express from 'express';
import { chatStore } from '../chatStore.js';

const router = express.Router();

// GET /api/projects/:projectId/chat — Get messages (paginated)
router.get('/:projectId/chat', (req, res) => {
  try {
    const { projectId } = req.params;
    const { limit = 50, before } = req.query;
    const messages = chatStore.getMessages(projectId, {
      limit: parseInt(limit, 10),
      before: before || null,
    });
    res.json({ messages, total: chatStore.getCount(projectId) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/projects/:projectId/chat/search — Search messages
router.get('/:projectId/chat/search', (req, res) => {
  try {
    const { projectId } = req.params;
    const { q, limit = 20 } = req.query;
    if (!q) return res.json({ messages: [] });
    const messages = chatStore.search(projectId, q, { limit: parseInt(limit, 10) });
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/projects/:projectId/chat — Add a user message
router.post('/:projectId/chat', (req, res) => {
  try {
    const { projectId } = req.params;
    const { content, metadata } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'content is required' });
    const msg = chatStore.addMessage({
      projectId,
      role: 'user',
      content: content.trim(),
      metadata,
    });
    res.status(201).json(msg);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
