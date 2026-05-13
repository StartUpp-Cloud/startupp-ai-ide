// src/server/chatStore.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createMessage } from './models/ChatMessage.js';
import { resolveSessionAssistantSettings } from './sessionSettings.js';
import { sqliteStore } from './sqliteStore.js';
import {
  STREAM_AUTO_RETRY_MAX_AGE_MS,
  STREAM_RECOVERY_STALE_MS,
  buildStreamingRecoveryContent,
  shouldRecoverStreamingMessage,
} from './sessionRecovery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_DIR = path.join(__dirname, '../../data/jobs');

const SECRET_PATTERNS = [
  /(?:sk-|pk-|api[_-]?key|token|secret|password|bearer)\s*[:=]\s*['"]?([A-Za-z0-9_\-/.]{20,})['"]?/gi,
  /ghp_[A-Za-z0-9]{36,}/g,
  /sk-[A-Za-z0-9]{32,}/g,
  /xox[bpsar]-[A-Za-z0-9\-]{10,}/g,
  /AIza[A-Za-z0-9_\-]{35}/g,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
];

function redactSecrets(text) {
  if (!text || typeof text !== 'string') return text;
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, (match) => {
      if (match.length > 10) return match.slice(0, 6) + '[REDACTED]';
      return '[REDACTED]';
    });
  }
  return redacted;
}

function safeJson(value) {
  if (value == null) return null;
  return JSON.parse(redactSecrets(JSON.stringify(value)));
}

function snippetAround(text, query, maxLength = 180) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  const idx = value.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return value.slice(0, maxLength);
  const start = Math.max(0, idx - 60);
  const end = Math.min(value.length, idx + query.length + 120);
  return `${start > 0 ? '...' : ''}${value.slice(start, end)}${end < value.length ? '...' : ''}`;
}

class ChatStore {
  _db() {
    return sqliteStore.db;
  }

  _getSessionRow(projectId, sessionId) {
    return this._db().prepare('SELECT * FROM chat_sessions WHERE project_id = ? AND id = ?').get(projectId, sessionId);
  }

  _ensureSession(projectId, sessionId = null) {
    if (sessionId && this._getSessionRow(projectId, sessionId)) return this.getSession(projectId, sessionId);
    if (sessionId) return sqliteStore.saveChatSession({ id: sessionId, name: `Chat ${new Date().toLocaleDateString()}` }, projectId);
    return this.getActiveSession(projectId);
  }

  createSession(projectId, name = null, assistantSettings = {}) {
    const resolvedAssistant = resolveSessionAssistantSettings(assistantSettings, { tool: 'claude' });
    return sqliteStore.saveChatSession({
      name: name || `Chat ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      manualName: false,
      status: 'open',
      ...resolvedAssistant,
    }, projectId);
  }

  getSessions(projectId, { includeArchived = false } = {}) {
    const rows = includeArchived
      ? this._db().prepare('SELECT * FROM chat_sessions WHERE project_id = ? ORDER BY created_at DESC').all(projectId)
      : this._db().prepare('SELECT * FROM chat_sessions WHERE project_id = ? AND archived = 0 ORDER BY created_at DESC').all(projectId);
    return rows.map(sqliteStore.rowToSession);
  }

  updateSessionMeta(projectId, sessionId, meta) {
    const session = this.getSession(projectId, sessionId);
    if (!session) return;
    sqliteStore.saveChatSession({ ...session, ...meta, updatedAt: new Date().toISOString() }, projectId, { archived: session.archived });
  }

  getSessionMeta(projectId, sessionId) {
    return this.getSession(projectId, sessionId);
  }

  markSessionUnread(projectId, sessionId) {
    const session = this.getSession(projectId, sessionId);
    if (session && !session.hasUnread) {
      this.updateSessionMeta(projectId, sessionId, { hasUnread: true, unreadSince: new Date().toISOString() });
      return true;
    }
    return false;
  }

  markSessionRead(projectId, sessionId) {
    const session = this.getSession(projectId, sessionId);
    if (session && session.hasUnread) {
      const updated = { ...session, hasUnread: false };
      delete updated.unreadSince;
      sqliteStore.saveChatSession(updated, projectId, { archived: session.archived });
      return true;
    }
    return false;
  }

  getUnreadSessions(projectId) {
    return this._db().prepare('SELECT * FROM chat_sessions WHERE project_id = ? AND has_unread = 1 ORDER BY unread_since DESC')
      .all(projectId)
      .map(sqliteStore.rowToSession);
  }

  getAllUnreadCounts() {
    const rows = this._db().prepare('SELECT project_id, COUNT(*) AS count FROM chat_sessions WHERE has_unread = 1 GROUP BY project_id').all();
    return Object.fromEntries(rows.filter(r => r.count > 0).map(r => [r.project_id, r.count]));
  }

  getAllUnreadSessionIds() {
    const rows = this._db().prepare('SELECT project_id, id FROM chat_sessions WHERE has_unread = 1 ORDER BY unread_since DESC').all();
    const unread = {};
    for (const row of rows) {
      if (!unread[row.project_id]) unread[row.project_id] = [];
      unread[row.project_id].push(row.id);
    }
    return unread;
  }

  getSession(projectId, sessionId) {
    const row = this._getSessionRow(projectId, sessionId);
    if (!row) return null;
    return sqliteStore.rowToSession(row);
  }

  renameSession(projectId, sessionId, name, opts = {}) {
    const meta = { name };
    if (opts.manual === true) meta.manualName = true;
    this.updateSessionMeta(projectId, sessionId, meta);
  }

  deleteSession(projectId, sessionId) {
    this._db().prepare('DELETE FROM chat_chunks WHERE project_id = ? AND message_id IN (SELECT id FROM chat_messages WHERE project_id = ? AND session_id = ?)')
      .run(projectId, projectId, sessionId);
    this._db().prepare('DELETE FROM chat_messages_fts WHERE message_id IN (SELECT id FROM chat_messages WHERE project_id = ? AND session_id = ?)')
      .run(projectId, sessionId);
    this._db().prepare('DELETE FROM chat_messages WHERE project_id = ? AND session_id = ?').run(projectId, sessionId);
    this._db().prepare('DELETE FROM chat_sessions WHERE project_id = ? AND id = ?').run(projectId, sessionId);
  }

  getActiveSession(projectId) {
    const sessions = this.getSessions(projectId);
    if (sessions.length > 0) return sessions[0];
    return this.createSession(projectId);
  }

  createStreamingMessage({ projectId, sessionId, role, initialContent = '', metadata = {} }) {
    const session = this._ensureSession(projectId, sessionId);
    const msg = createMessage({
      projectId,
      role,
      content: initialContent,
      metadata: {
        ...metadata,
        streaming: true,
        streamStartedAt: new Date().toISOString(),
        chunks: [],
      },
    });
    msg.sessionId = session.id;
    sqliteStore.saveChatMessage(msg);
    this._incrementMessageCount(projectId, session.id, 1);
    return msg;
  }

  appendStreamChunk({ projectId, messageId, chunk, chunkIndex }) {
    this._db().prepare(`INSERT OR REPLACE INTO chat_chunks (message_id, project_id, chunk_index, content, created_at)
      VALUES (?, ?, ?, ?, ?)`).run(messageId, projectId, chunkIndex, redactSecrets(chunk), new Date().toISOString());
  }

  finalizeStreamingMessage({ projectId, sessionId, messageId, finalContent, metadata = {} }) {
    const msg = this._getMessage(projectId, sessionId, messageId);
    if (!msg) return null;
    msg.content = redactSecrets(finalContent);
    msg.metadata = {
      ...(msg.metadata || {}),
      ...safeJson(metadata),
      streaming: false,
      streamCompletedAt: new Date().toISOString(),
    };
    delete msg.metadata.chunks;
    sqliteStore.saveChatMessage(msg);
    this._db().prepare('DELETE FROM chat_chunks WHERE project_id = ? AND message_id = ?').run(projectId, messageId);
    return msg;
  }

  getStreamChunks({ projectId, messageId }) {
    return this._db().prepare('SELECT chunk_index AS "index", content, created_at AS timestamp FROM chat_chunks WHERE project_id = ? AND message_id = ? ORDER BY chunk_index ASC')
      .all(projectId, messageId);
  }

  getLastChunkTimestamp({ projectId, messageId }) {
    const row = this._db().prepare('SELECT created_at FROM chat_chunks WHERE project_id = ? AND message_id = ? ORDER BY chunk_index DESC LIMIT 1')
      .get(projectId, messageId);
    return row?.created_at ? new Date(row.created_at).getTime() : null;
  }

  recoverStreamingMessage({ projectId, sessionId, messageId }) {
    const chunks = this.getStreamChunks({ projectId, messageId });
    let rawContent = chunks.map(c => c.content).join('');
    const originalMsg = this._getMessage(projectId, sessionId, messageId);

    try {
      const msg = originalMsg;
      if (msg?.metadata?.jobId) {
        const jobOutputPath = path.join(JOBS_DIR, `${msg.metadata.jobId}.output`);
        if (fs.existsSync(jobOutputPath)) {
          const jobOutput = fs.readFileSync(jobOutputPath, 'utf-8');
          if (jobOutput.length > rawContent.length) rawContent = jobOutput;
        }
      }
    } catch {}

    if (!rawContent || rawContent.length < 50) {
      return this.finalizeStreamingMessage({
        projectId,
        sessionId,
        messageId,
        finalContent: buildStreamingRecoveryContent({ tool: originalMsg?.metadata?.tool, retrying: true }),
        metadata: {
          recovered: true,
          recoveryPending: true,
          staleNoOutput: true,
          chunkCount: chunks.length,
          jobId: originalMsg?.metadata?.jobId || null,
        },
      });
    }

    const { content: cleanedContent, cliSessionId } = this._parseRawChunksWithSessionId(rawContent);
    if (cliSessionId) {
      const session = this.getSession(projectId, sessionId);
      this.updateSessionMeta(projectId, sessionId, {
        cliSessionId,
        cliSessionTool: 'claude',
        toolSessions: {
          ...(session?.toolSessions || {}),
          claude: { cliSessionId, updatedAt: new Date().toISOString() },
        },
      });
    }

    if (!cleanedContent || cleanedContent.length < 10) {
      return this.finalizeStreamingMessage({
        projectId,
        sessionId,
        messageId,
        finalContent: 'Continuing progress automatically...',
        metadata: { recovered: true, recoveryPending: true, chunkCount: chunks.length, cliSessionId: cliSessionId || null },
      });
    }

    return this.finalizeStreamingMessage({
      projectId,
      sessionId,
      messageId,
      finalContent: cleanedContent,
      metadata: { recovered: true, chunkCount: chunks.length, cliSessionId: cliSessionId || null },
    });
  }

  _getMessage(projectId, sessionId, messageId) {
    const row = this._db().prepare('SELECT * FROM chat_messages WHERE project_id = ? AND session_id = ? AND id = ?')
      .get(projectId, sessionId, messageId);
    return sqliteStore.rowToMessage(row);
  }

  _parseRawChunksWithSessionId(rawContent) {
    const clean = rawContent
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b[()][A-Z0-9]/g, '')
      .replace(/\r/g, '');

    let resultText = '';
    let cliSessionId = null;
    const partialTextBlocks = [];

    for (const line of clean.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        const json = JSON.parse(trimmed);
        if (json.session_id) cliSessionId = json.session_id;
        if (json.type === 'result' && json.result) resultText = json.result;
        if (json.type === 'content_block_delta' && json.delta?.text) partialTextBlocks.push(json.delta.text);
        if (json.type === 'content' && json.text) partialTextBlocks.push(json.text);
        if (json.type === 'assistant' && Array.isArray(json.message?.content)) {
          for (const block of json.message.content) {
            if (block.type === 'text' && block.text) partialTextBlocks.push(block.text);
          }
        }
      } catch {}
    }

    if (resultText) {
      return {
        content: resultText.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim(),
        cliSessionId,
      };
    }

    if (partialTextBlocks.length > 0) {
      const partialContent = partialTextBlocks.join('').trim();
      if (partialContent.length > 20) {
        return { content: `${partialContent}\n\n---\n🔄 *Recovered partial response. The system will continue automatically.*`, cliSessionId };
      }
    }

    return { content: this._filterMeaningfulLines(clean), cliSessionId };
  }

  _parseRawChunksToContent(rawContent) {
    return this._parseRawChunksWithSessionId(rawContent).content;
  }

  _filterMeaningfulLines(clean) {
    const lines = clean.split('\n');
    const firstJsonIdx = lines.findIndex(l => {
      const t = l.trim();
      return t.startsWith('{') && (t.includes('"type"') || t.includes('"session_id"'));
    });
    const outputLines = firstJsonIdx > 0 ? lines.slice(firstJsonIdx) : lines;
    return outputLines.filter(line => {
      const t = line.trim();
      if (!t) return false;
      if (t.startsWith('{') && (t.includes('"type"') || t.includes('"session_id"'))) return false;
      if (t.startsWith('claude -p')) return false;
      if (t.startsWith('copilot -p')) return false;
      if (t.startsWith('aider ')) return false;
      if (/^[>#$]\s*$/.test(t)) return false;
      if (/^\w+@[\w.-]+:.*[$#]\s*$/.test(t)) return false;
      if (t.startsWith('> ')) return false;
      if (t.includes('--output-format')) return false;
      if (t.includes('--dangerously-skip-permissions')) return false;
      if (t.includes('--yolo')) return false;
      if (t.includes('--verbose')) return false;
      if (t.includes("--resume '")) return false;
      return true;
    }).join('\n').trim();
  }

  getIncompleteStreamingMessages(projectId, sessionId) {
    const rows = this._db().prepare(`SELECT * FROM chat_messages
      WHERE project_id = ? AND session_id = ? AND metadata LIKE '%"streaming":true%' ORDER BY created_at ASC`).all(projectId, sessionId);
    return rows.map(row => {
      const message = sqliteStore.rowToMessage(row);
      const chunks = this.getStreamChunks({ projectId, messageId: message.id });
      const lastChunkAt = chunks.length > 0 ? chunks[chunks.length - 1].timestamp : null;
      const streamStartedAt = message.metadata?.streamStartedAt || message.createdAt;
      return {
        message,
        chunks,
        partialContent: chunks.map(c => c.content).join(''),
        streamStartedAt,
        lastChunkAt,
        stale: shouldRecoverStreamingMessage({ streamStartedAt, lastChunkAt, staleMs: STREAM_RECOVERY_STALE_MS }),
      };
    });
  }

  getStaleStreamingMessages({ staleMs = STREAM_RECOVERY_STALE_MS, maxAgeMs = STREAM_AUTO_RETRY_MAX_AGE_MS, limit = 50 } = {}) {
    const rows = this._db().prepare(`SELECT * FROM chat_messages
      WHERE metadata LIKE '%"streaming":true%' ORDER BY created_at DESC LIMIT ?`).all(Math.max(1, Math.min(parseInt(limit, 10) || 50, 200)));
    const now = Date.now();
    const stale = [];
    for (const row of rows) {
      const message = sqliteStore.rowToMessage(row);
      if (!message) continue;
      const streamStartedAt = message.metadata?.streamStartedAt || message.createdAt;
      const streamStartMs = new Date(streamStartedAt).getTime();
      if (maxAgeMs && Number.isFinite(streamStartMs) && now - streamStartMs > maxAgeMs) continue;
      const chunks = this.getStreamChunks({ projectId: message.projectId, messageId: message.id });
      const lastChunkAt = chunks.length > 0 ? chunks[chunks.length - 1].timestamp : null;
      if (!shouldRecoverStreamingMessage({ now, streamStartedAt, lastChunkAt, staleMs })) continue;
      stale.push({
        message,
        chunks,
        partialContent: chunks.map(c => c.content).join(''),
        streamStartedAt,
        lastChunkAt,
        stale: true,
      });
    }
    return stale;
  }

  addMessage({ projectId, sessionId = null, role, content, metadata }) {
    const session = this._ensureSession(projectId, sessionId);
    const msg = createMessage({
      projectId,
      role,
      content: redactSecrets(content),
      metadata: metadata ? safeJson(metadata) : null,
    });
    msg.sessionId = session.id;
    sqliteStore.saveChatMessage(msg);
    this._incrementMessageCount(projectId, session.id, 1);
    return msg;
  }

  getMessages(projectId, { sessionId = null, limit = 50, before = null, since = null } = {}) {
    if (!sessionId) {
      const active = this.getSessions(projectId)[0];
      if (!active) return [];
      sessionId = active.id;
    }
    const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 500));
    const sinceTime = since ? new Date(since).getTime() : NaN;
    const sinceIso = Number.isFinite(sinceTime) ? new Date(sinceTime).toISOString() : null;
    const where = ['project_id = ?', 'session_id = ?'];
    const params = [projectId, sessionId];
    let rows;
    if (before) {
      const beforeRow = this._db().prepare('SELECT created_at FROM chat_messages WHERE project_id = ? AND session_id = ? AND id = ?')
        .get(projectId, sessionId, before);
      if (!beforeRow) return [];
      where.push('created_at < ?');
      params.push(beforeRow.created_at);
    }
    if (sinceIso) {
      where.push('created_at >= ?');
      params.push(sinceIso);
    }
    rows = this._db().prepare(`SELECT * FROM chat_messages WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC LIMIT ?`).all(...params, safeLimit * 3);

    const now = Date.now();
    const messages = [];
    for (const msg of rows.map(sqliteStore.rowToMessage).reverse()) {
      if (msg.metadata?.streaming === true) {
        const lastChunkTime = this.getLastChunkTimestamp({ projectId, messageId: msg.id });
        const streamStarted = msg.metadata?.streamStartedAt
          ? new Date(msg.metadata.streamStartedAt).getTime()
          : new Date(msg.createdAt).getTime();
        const silenceMs = now - (lastChunkTime || streamStarted);
        if (silenceMs > STREAM_RECOVERY_STALE_MS) {
          const jobId = msg.metadata?.jobId || null;
          const job = jobId ? this._db().prepare('SELECT status FROM jobs WHERE id = ?').get(jobId) : null;
          if (job?.status === 'running' || job?.status === 'pending') continue;
          const recovered = this.recoverStreamingMessage({ projectId, sessionId, messageId: msg.id });
          if (recovered) messages.push(recovered);
        }
        continue;
      }
      messages.push(msg);
    }

    const cleanedMessages = this._cleanProgressMessages(messages);
    return cleanedMessages.slice(-safeLimit).reverse();
  }

  _cleanProgressMessages(messages) {
    let cleaned = messages;
    while (cleaned.length > 0 && cleaned[cleaned.length - 1].role === 'progress' && cleaned[cleaned.length - 1].metadata?.transient === true) {
      cleaned = cleaned.slice(0, -1);
    }
    const lastUserIdx = cleaned.findLastIndex(m => m.role === 'user');
    if (lastUserIdx >= 0) {
      const hasResponseAfterUser = cleaned.slice(lastUserIdx + 1).some(m => m.role === 'agent' || m.role === 'error');
      if (!hasResponseAfterUser) {
        cleaned = [
          ...cleaned.slice(0, lastUserIdx + 1),
          ...cleaned.slice(lastUserIdx + 1).filter(m => m.role !== 'progress' || m.metadata?.transient !== true),
        ];
      }
    }
    return cleaned;
  }

  searchSessions(projectId, query, { includeArchived = true, limit = 30 } = {}) {
    const q = String(query || '').trim();
    if (!q) return [];
    const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 30, 100));
    const like = `%${q}%`;
    const archiveSql = includeArchived ? '' : 'AND archived = 0';
    const bySubject = this._db().prepare(`SELECT * FROM chat_sessions WHERE project_id = ? ${archiveSql} AND name LIKE ? ORDER BY created_at DESC LIMIT ?`)
      .all(projectId, like, safeLimit)
      .map(row => ({ ...sqliteStore.rowToSession(row), matchType: 'subject', matchSnippet: row.name }));
    if (bySubject.length >= safeLimit) return bySubject;

    const ftsQuery = sqliteStore.ftsQueryFromText(q);
    if (!ftsQuery) return bySubject;
    const subjectIds = new Set(bySubject.map(s => s.id));
    const rows = this._db().prepare(`
      SELECT s.*, m.content AS match_content, m.role AS match_role
      FROM chat_messages_fts f
      JOIN chat_messages m ON m.id = f.message_id
      JOIN chat_sessions s ON s.id = m.session_id
      WHERE chat_messages_fts MATCH ? AND m.project_id = ? ${includeArchived ? '' : 'AND s.archived = 0'}
      GROUP BY s.id
      ORDER BY MAX(m.created_at) DESC
      LIMIT ?
    `).all(ftsQuery, projectId, safeLimit * 2);
    const byContent = [];
    for (const row of rows) {
      if (subjectIds.has(row.id)) continue;
      byContent.push({
        ...sqliteStore.rowToSession(row),
        matchType: 'content',
        matchSnippet: snippetAround(row.match_content, q),
        matchRole: row.match_role,
      });
      if (bySubject.length + byContent.length >= safeLimit) break;
    }
    return [...bySubject, ...byContent].slice(0, safeLimit);
  }

  search(projectId, query, { sessionId = null, limit = 20 } = {}) {
    const q = String(query || '').trim();
    if (!q) return [];
    const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
    const ftsQuery = sqliteStore.ftsQueryFromText(q);
    if (ftsQuery) {
      const rows = sessionId
        ? this._db().prepare(`SELECT m.* FROM chat_messages_fts f JOIN chat_messages m ON m.id = f.message_id
          WHERE chat_messages_fts MATCH ? AND m.project_id = ? AND m.session_id = ? ORDER BY m.created_at DESC LIMIT ?`)
          .all(ftsQuery, projectId, sessionId, safeLimit)
        : this._db().prepare(`SELECT m.* FROM chat_messages_fts f JOIN chat_messages m ON m.id = f.message_id
          WHERE chat_messages_fts MATCH ? AND m.project_id = ? ORDER BY m.created_at DESC LIMIT ?`)
          .all(ftsQuery, projectId, safeLimit);
      return rows.map(sqliteStore.rowToMessage);
    }
    const like = `%${q}%`;
    const rows = sessionId
      ? this._db().prepare('SELECT * FROM chat_messages WHERE project_id = ? AND session_id = ? AND content LIKE ? ORDER BY created_at DESC LIMIT ?')
        .all(projectId, sessionId, like, safeLimit)
      : this._db().prepare('SELECT * FROM chat_messages WHERE project_id = ? AND content LIKE ? ORDER BY created_at DESC LIMIT ?')
        .all(projectId, like, safeLimit);
    return rows.map(sqliteStore.rowToMessage);
  }

  getCount(projectId, sessionId = null) {
    if (!sessionId) {
      const active = this.getSessions(projectId)[0];
      if (!active) return 0;
      sessionId = active.id;
    }
    const row = this._db().prepare('SELECT message_count FROM chat_sessions WHERE project_id = ? AND id = ?').get(projectId, sessionId);
    if (Number.isFinite(row?.message_count)) return row.message_count;
    return this._db().prepare('SELECT COUNT(*) AS count FROM chat_messages WHERE project_id = ? AND session_id = ?').get(projectId, sessionId)?.count || 0;
  }

  deleteProject(projectId) {
    this._db().prepare('DELETE FROM chat_chunks WHERE project_id = ?').run(projectId);
    this._db().prepare('DELETE FROM chat_messages_fts WHERE project_id = ?').run(projectId);
    this._db().prepare('DELETE FROM chat_messages WHERE project_id = ?').run(projectId);
    this._db().prepare('DELETE FROM chat_sessions WHERE project_id = ?').run(projectId);
  }

  migrateIfNeeded() {
    // Legacy JSONL migration now runs once during SQLite initialization.
  }

  _incrementMessageCount(projectId, sessionId, by) {
    this._db().prepare('UPDATE chat_sessions SET message_count = message_count + ?, updated_at = ? WHERE project_id = ? AND id = ?')
      .run(by, new Date().toISOString(), projectId, sessionId);
  }
}

export const chatStore = new ChatStore();
export default chatStore;
