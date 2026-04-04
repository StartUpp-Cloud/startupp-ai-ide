// src/server/chatStore.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { createMessage, serialize, deserialize } from './models/ChatMessage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHAT_DIR = path.join(__dirname, '../../data/chat');

if (!fs.existsSync(CHAT_DIR)) {
  fs.mkdirSync(CHAT_DIR, { recursive: true, mode: 0o700 });
} else {
  try { fs.chmodSync(CHAT_DIR, 0o700); } catch {}
}

// Patterns that look like secrets — redacted before writing to disk
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

/**
 * Session index file: data/chat/{projectId}/_sessions.json
 * Contains: [{ id, name, createdAt, messageCount }]
 *
 * Messages file: data/chat/{projectId}/{sessionId}.jsonl
 */
class ChatStore {
  _projectDir(projectId) {
    return path.join(CHAT_DIR, projectId);
  }

  _sessionFile(projectId, sessionId) {
    return path.join(this._projectDir(projectId), `${sessionId}.jsonl`);
  }

  _indexFile(projectId) {
    return path.join(this._projectDir(projectId), '_sessions.json');
  }

  _ensureProjectDir(projectId) {
    const dir = this._projectDir(projectId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  _readIndex(projectId) {
    const indexPath = this._indexFile(projectId);
    if (!fs.existsSync(indexPath)) return [];
    try {
      return JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    } catch {
      return [];
    }
  }

  _writeIndex(projectId, sessions) {
    this._ensureProjectDir(projectId);
    fs.writeFileSync(this._indexFile(projectId), JSON.stringify(sessions, null, 2), 'utf-8');
  }

  // ── Session management ──

  /**
   * Create a new chat session for a project.
   * Returns the new session object.
   */
  createSession(projectId, name = null) {
    const session = {
      id: uuidv4(),
      name: name || `Chat ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      createdAt: new Date().toISOString(),
      messageCount: 0,
    };
    const sessions = this._readIndex(projectId);
    sessions.push(session);
    this._writeIndex(projectId, sessions);
    return session;
  }

  /**
   * List all sessions for a project (newest first).
   */
  getSessions(projectId) {
    return this._readIndex(projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Rename a session.
   */
  renameSession(projectId, sessionId, name) {
    const sessions = this._readIndex(projectId);
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      session.name = name;
      this._writeIndex(projectId, sessions);
    }
  }

  /**
   * Delete a session and its messages.
   */
  deleteSession(projectId, sessionId) {
    const sessions = this._readIndex(projectId);
    const filtered = sessions.filter(s => s.id !== sessionId);
    this._writeIndex(projectId, filtered);
    const msgFile = this._sessionFile(projectId, sessionId);
    if (fs.existsSync(msgFile)) fs.unlinkSync(msgFile);
  }

  /**
   * Get or create the active session for a project.
   * If no sessions exist, creates one automatically.
   * Returns the most recent session.
   */
  getActiveSession(projectId) {
    const sessions = this.getSessions(projectId);
    if (sessions.length > 0) return sessions[0];
    return this.createSession(projectId);
  }

  // ── Message operations (now session-scoped) ──

  /**
   * Add a message to a specific session.
   * If sessionId is null, uses the most recent session (or creates one).
   */
  addMessage({ projectId, sessionId = null, role, content, metadata }) {
    if (!sessionId) {
      sessionId = this.getActiveSession(projectId).id;
    }
    this._ensureProjectDir(projectId);

    const msg = createMessage({
      projectId,
      role,
      content: redactSecrets(content),
      metadata: metadata ? JSON.parse(redactSecrets(JSON.stringify(metadata))) : null,
    });
    msg.sessionId = sessionId;

    const line = serialize(msg) + '\n';
    fs.appendFileSync(this._sessionFile(projectId, sessionId), line, 'utf-8');

    // Update message count in index
    const sessions = this._readIndex(projectId);
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      session.messageCount = (session.messageCount || 0) + 1;
      this._writeIndex(projectId, sessions);
    }

    return msg;
  }

  getMessages(projectId, { sessionId = null, limit = 50, before = null } = {}) {
    if (!sessionId) {
      const active = this.getSessions(projectId)[0];
      if (!active) return [];
      sessionId = active.id;
    }
    const filePath = this._sessionFile(projectId, sessionId);
    if (!fs.existsSync(filePath)) return [];

    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    const messages = [];
    for (const line of lines) {
      const msg = deserialize(line);
      if (msg) messages.push(msg);
    }

    if (before) {
      const idx = messages.findIndex(m => m.id === before);
      if (idx > 0) return messages.slice(Math.max(0, idx - limit), idx).reverse();
      return [];
    }

    return messages.slice(-limit).reverse();
  }

  search(projectId, query, { sessionId = null, limit = 20 } = {}) {
    if (!query) return [];

    // Search across all sessions if no sessionId specified
    const sessions = sessionId ? [{ id: sessionId }] : this.getSessions(projectId);
    const results = [];

    for (const s of sessions) {
      const filePath = this._sessionFile(projectId, s.id);
      if (!fs.existsSync(filePath)) continue;

      const lowerQuery = query.toLowerCase();
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
      for (const line of lines) {
        const msg = deserialize(line);
        if (msg && msg.content.toLowerCase().includes(lowerQuery)) {
          results.push(msg);
          if (results.length >= limit) return results;
        }
      }
    }

    return results;
  }

  getCount(projectId, sessionId = null) {
    if (!sessionId) {
      const active = this.getSessions(projectId)[0];
      if (!active) return 0;
      sessionId = active.id;
    }
    const filePath = this._sessionFile(projectId, sessionId);
    if (!fs.existsSync(filePath)) return 0;
    return fs.readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim()).length;
  }

  /**
   * Delete all chat data for a project.
   */
  deleteProject(projectId) {
    const dir = this._projectDir(projectId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // ── Migration: move old single-file chats to session format ──

  migrateIfNeeded(projectId) {
    const oldFile = path.join(CHAT_DIR, `${projectId}.jsonl`);
    if (!fs.existsSync(oldFile)) return;

    // Old format exists — migrate to session format
    const session = this.createSession(projectId, 'Migrated Chat');
    const content = fs.readFileSync(oldFile, 'utf-8');
    this._ensureProjectDir(projectId);
    fs.writeFileSync(this._sessionFile(projectId, session.id), content, 'utf-8');

    // Count messages
    const count = content.split('\n').filter(l => l.trim()).length;
    const sessions = this._readIndex(projectId);
    const s = sessions.find(x => x.id === session.id);
    if (s) { s.messageCount = count; this._writeIndex(projectId, sessions); }

    // Remove old file
    fs.unlinkSync(oldFile);
  }
}

export const chatStore = new ChatStore();
export default chatStore;
