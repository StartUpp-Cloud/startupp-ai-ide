import express from 'express';
import { chatStore } from '../chatStore.js';

const router = express.Router();

// GET /api/projects/:projectId/chat/sessions — List all sessions
router.get('/:projectId/chat/sessions', (req, res) => {
  try {
    const { projectId } = req.params;
    chatStore.migrateIfNeeded(projectId);
    const sessions = chatStore.getSessions(projectId);
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/projects/:projectId/chat/sessions — Create a new session
router.post('/:projectId/chat/sessions', (req, res) => {
  try {
    const { projectId } = req.params;
    const { name } = req.body;
    const session = chatStore.createSession(projectId, name || null);
    res.status(201).json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/projects/:projectId/chat/sessions/:sessionId — Delete a session
router.delete('/:projectId/chat/sessions/:sessionId', (req, res) => {
  try {
    const { projectId, sessionId } = req.params;
    chatStore.deleteSession(projectId, sessionId);
    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/projects/:projectId/chat/sessions/:sessionId — Rename a session
router.patch('/:projectId/chat/sessions/:sessionId', (req, res) => {
  try {
    const { projectId, sessionId } = req.params;
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    chatStore.renameSession(projectId, sessionId, name.trim(), { manual: true });
    res.json({ renamed: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/projects/:projectId/chat/sessions/:sessionId/pin — Toggle pin status
router.post('/:projectId/chat/sessions/:sessionId/pin', (req, res) => {
  try {
    const { projectId, sessionId } = req.params;
    const { pinned } = req.body;
    chatStore.updateSessionMeta(projectId, sessionId, { pinned: !!pinned });
    res.json({ pinned: !!pinned });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/projects/:projectId/chat — Get messages (paginated, session-scoped)
router.get('/:projectId/chat', (req, res) => {
  try {
    const { projectId } = req.params;
    const { limit = 50, before, sessionId } = req.query;
    chatStore.migrateIfNeeded(projectId);
    const messages = chatStore.getMessages(projectId, {
      sessionId: sessionId || null,
      limit: parseInt(limit, 10),
      before: before || null,
    });
    res.json({ messages, total: chatStore.getCount(projectId, sessionId || null) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/projects/:projectId/chat/search — Search messages
router.get('/:projectId/chat/search', (req, res) => {
  try {
    const { projectId } = req.params;
    const { q, limit = 20, sessionId } = req.query;
    if (!q) return res.json({ messages: [] });
    const messages = chatStore.search(projectId, q, { sessionId: sessionId || null, limit: parseInt(limit, 10) });
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/projects/:projectId/chat — Add a user message
router.post('/:projectId/chat', (req, res) => {
  try {
    const { projectId } = req.params;
    const { content, metadata, sessionId } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'content is required' });
    const msg = chatStore.addMessage({
      projectId,
      sessionId: sessionId || null,
      role: 'user',
      content: content.trim(),
      metadata,
    });
    res.status(201).json(msg);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/projects/:projectId/chat/sessions/:sessionId/read — Mark session as read
router.post('/:projectId/chat/sessions/:sessionId/read', (req, res) => {
  try {
    const { projectId, sessionId } = req.params;
    const changed = chatStore.markSessionRead(projectId, sessionId);
    res.json({ marked: changed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Note: Global unread endpoint is at /api/unread-counts (see index.js)

export default router;
