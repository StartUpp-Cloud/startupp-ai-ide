import express from 'express';
import { chatStore } from '../chatStore.js';
import { agentGateway } from '../agentGateway.js';
import { mergeSessionAssistantSettings, resolveSessionAssistantSettings } from '../sessionSettings.js';

const router = express.Router();

const ROLE_PROMPT_IDS = new Set([
  'principal-engineer',
  'design-director',
  'security-architect',
  'operator-ceo',
  'venture-capitalist',
]);

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function normalizeRolePromptIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(id => typeof id === 'string' && ROLE_PROMPT_IDS.has(id)))];
}

// GET /api/projects/:projectId/chat/sessions — List sessions
// Query: ?includeArchived=true to include old sessions
router.get('/:projectId/chat/sessions', (req, res) => {
  try {
    const { projectId } = req.params;
    const includeArchived = req.query.includeArchived === 'true';
    chatStore.migrateIfNeeded(projectId);
    const sessions = chatStore.getSessions(projectId, { includeArchived });
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/projects/:projectId/chat/sessions/search — Search session history
// Ranks session name/subject matches before message content matches.
router.get('/:projectId/chat/sessions/search', (req, res) => {
  try {
    const { projectId } = req.params;
    const { q, limit = 30 } = req.query;
    if (!q?.trim()) return res.json({ sessions: [] });
    const sessions = chatStore.searchSessions(projectId, q, {
      includeArchived: true,
      limit: parseInt(limit, 10),
    });
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
    const assistantSettings = resolveSessionAssistantSettings(req.body, {
      tool: 'claude',
    });
    if (req.body.mode) assistantSettings.mode = String(req.body.mode);
    const session = chatStore.createSession(projectId, name || null, assistantSettings);
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

// PATCH /api/projects/:projectId/chat/sessions/:sessionId — Update session metadata
router.patch('/:projectId/chat/sessions/:sessionId', (req, res) => {
  try {
    const { projectId, sessionId } = req.params;
    const session = chatStore.getSession(projectId, sessionId);
    if (!session) return res.status(404).json({ error: 'session not found' });

    const updates = {};
    const wantsName = hasOwn(req.body, 'name');
    const wantsBranch = hasOwn(req.body, 'branch');
    const wantsRepoPath = hasOwn(req.body, 'repoPath');
    const wantsAssistantSettings = ['tool', 'model', 'effort'].some((field) => hasOwn(req.body, field));
    const wantsRolePrompts = hasOwn(req.body, 'activeRolePromptIds');
    const wantsStatus = hasOwn(req.body, 'status');
    const wantsMode = hasOwn(req.body, 'mode');

    if (!wantsName && !wantsAssistantSettings && !wantsBranch && !wantsRepoPath && !wantsRolePrompts && !wantsStatus && !wantsMode) {
      return res.status(400).json({ error: 'No supported session fields were provided' });
    }

    if (wantsName) {
      if (!req.body.name?.trim()) return res.status(400).json({ error: 'name is required' });
      updates.name = req.body.name.trim();
      updates.manualName = true;
    }

    if (wantsBranch) {
      const newBranch = req.body.branch?.trim() || null;
      const previousBranch = session.branch || null;
      updates.branch = newBranch;
      // Reset CLI session when branch changes so the AI starts fresh in the new worktree
      if (newBranch !== previousBranch && session.cliSessionId) {
        updates.cliSessionId = null;
        updates.cliSessionTool = null;
        updates.toolSessions = {};
        agentGateway.resetSession(sessionId);
      }
    }

    if (wantsRepoPath) {
      const newRepoPath = req.body.repoPath?.trim() || null;
      const previousRepoPath = session.repoPath || null;
      updates.repoPath = newRepoPath;
      if (newRepoPath !== previousRepoPath && session.cliSessionId) {
        updates.cliSessionId = null;
        updates.cliSessionTool = null;
        updates.toolSessions = {};
        agentGateway.resetSession(sessionId);
      }
    }

    if (wantsAssistantSettings) {
      const nextAssistantSettings = mergeSessionAssistantSettings(session, req.body, {
        tool: session.tool || 'claude',
      });
      Object.assign(updates, nextAssistantSettings);
    }

    if (wantsRolePrompts) {
      updates.activeRolePromptIds = normalizeRolePromptIds(req.body.activeRolePromptIds);
    }

    if (wantsStatus) {
      const valid = ['open', 'closed'];
      const status = String(req.body.status).toLowerCase();
      if (valid.includes(status)) updates.status = status;
    }

    if (wantsMode) {
      const nextMode = String(req.body.mode).toLowerCase();
      if (['plan', 'agent', 'autonomous'].includes(nextMode)) updates.mode = nextMode;
    }

    chatStore.updateSessionMeta(projectId, sessionId, updates);
    res.json({ session: chatStore.getSession(projectId, sessionId) });
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
    const { limit = 50, before, sessionId, since } = req.query;
    const requestedLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 499));
    chatStore.migrateIfNeeded(projectId);
    const fetched = chatStore.getMessages(projectId, {
      sessionId: sessionId || null,
      limit: requestedLimit + 1,
      before: before || null,
      since: since || null,
    });
    const hasMore = fetched.length > requestedLimit;
    const messages = hasMore ? fetched.slice(0, requestedLimit) : fetched;
    res.json({
      messages,
      total: chatStore.getCount(projectId, sessionId || null),
      hasMore,
      nextBefore: messages[messages.length - 1]?.id || null,
    });
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

// POST /api/projects/:projectId/chat/read-all — Mark all sessions as read
router.post('/:projectId/chat/read-all', (req, res) => {
  try {
    const { projectId } = req.params;
    const sessions = chatStore.getSessions(projectId);
    let marked = 0;
    for (const session of sessions) {
      if (chatStore.markSessionRead(projectId, session.id)) marked++;
    }
    res.json({ marked });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Note: Global unread endpoint is at /api/unread-counts (see index.js)

export default router;
