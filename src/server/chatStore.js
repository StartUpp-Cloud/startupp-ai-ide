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
   * Update arbitrary metadata on a session (e.g., cliSessionId for --resume).
   */
  updateSessionMeta(projectId, sessionId, meta) {
    const sessions = this._readIndex(projectId);
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      Object.assign(session, meta);
      this._writeIndex(projectId, sessions);
    }
  }

  /**
   * Get session metadata (including cliSessionId for --resume).
   */
  getSessionMeta(projectId, sessionId) {
    const sessions = this._readIndex(projectId);
    return sessions.find(s => s.id === sessionId) || null;
  }

  /**
   * Mark a session as having unread messages.
   * Called when an agent response is received.
   */
  markSessionUnread(projectId, sessionId) {
    const sessions = this._readIndex(projectId);
    const session = sessions.find(s => s.id === sessionId);
    if (session && !session.hasUnread) {
      session.hasUnread = true;
      session.unreadSince = new Date().toISOString();
      this._writeIndex(projectId, sessions);
      return true; // State changed
    }
    return false; // Already unread or not found
  }

  /**
   * Mark a session as read.
   * Called when user views the session.
   */
  markSessionRead(projectId, sessionId) {
    const sessions = this._readIndex(projectId);
    const session = sessions.find(s => s.id === sessionId);
    if (session && session.hasUnread) {
      session.hasUnread = false;
      delete session.unreadSince;
      this._writeIndex(projectId, sessions);
      return true; // State changed
    }
    return false; // Already read or not found
  }

  /**
   * Get all unread sessions for a project.
   */
  getUnreadSessions(projectId) {
    const sessions = this._readIndex(projectId);
    return sessions.filter(s => s.hasUnread === true);
  }

  /**
   * Get unread counts for all projects.
   * Returns { projectId: unreadCount, ... }
   */
  getAllUnreadCounts() {
    const counts = {};
    const projectDirs = fs.readdirSync(CHAT_DIR).filter(f => {
      const stat = fs.statSync(path.join(CHAT_DIR, f));
      return stat.isDirectory();
    });

    for (const projectId of projectDirs) {
      const sessions = this._readIndex(projectId);
      const unreadCount = sessions.filter(s => s.hasUnread === true).length;
      if (unreadCount > 0) {
        counts[projectId] = unreadCount;
      }
    }

    return counts;
  }

  /**
   * Get a specific session by ID.
   */
  getSession(projectId, sessionId) {
    const sessions = this._readIndex(projectId);
    return sessions.find(s => s.id === sessionId) || null;
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

  // ── Streaming message support ──
  // These methods allow persisting responses as they stream in,
  // so responses survive disconnections and restarts.

  /**
   * Create a streaming message placeholder that will be updated as chunks arrive.
   * Returns the message ID for subsequent chunk appends.
   */
  createStreamingMessage({ projectId, sessionId, role, initialContent = '', metadata = {} }) {
    if (!sessionId) {
      sessionId = this.getActiveSession(projectId).id;
    }
    this._ensureProjectDir(projectId);

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

  /**
   * Append a chunk to a streaming message.
   * The chunk is saved to a separate chunks file for durability.
   */
  appendStreamChunk({ projectId, sessionId, messageId, chunk, chunkIndex }) {
    const chunksDir = path.join(this._projectDir(projectId), '_chunks');
    if (!fs.existsSync(chunksDir)) {
      fs.mkdirSync(chunksDir, { recursive: true, mode: 0o700 });
    }

    const chunkFile = path.join(chunksDir, `${messageId}.chunks`);
    const chunkData = JSON.stringify({
      index: chunkIndex,
      content: redactSecrets(chunk),
      timestamp: new Date().toISOString(),
    }) + '\n';

    fs.appendFileSync(chunkFile, chunkData, 'utf-8');
  }

  /**
   * Finalize a streaming message by combining all chunks and updating the message.
   * This replaces the placeholder with the complete content.
   */
  finalizeStreamingMessage({ projectId, sessionId, messageId, finalContent, metadata = {} }) {
    const filePath = this._sessionFile(projectId, sessionId);
    if (!fs.existsSync(filePath)) return null;

    // Read all messages
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    const updatedLines = [];
    let foundMessage = null;

    for (const line of lines) {
      if (!line.trim()) {
        updatedLines.push(line);
        continue;
      }

      const msg = deserialize(line);
      if (msg && msg.id === messageId) {
        // Update the message with final content
        msg.content = redactSecrets(finalContent);
        msg.metadata = {
          ...msg.metadata,
          ...metadata,
          streaming: false,
          streamCompletedAt: new Date().toISOString(),
        };
        delete msg.metadata.chunks; // Remove chunks array from metadata
        foundMessage = msg;
        updatedLines.push(serialize(msg));
      } else {
        updatedLines.push(line);
      }
    }

    // Write back
    fs.writeFileSync(filePath, updatedLines.join('\n'), 'utf-8');

    // Clean up chunks file
    const chunksDir = path.join(this._projectDir(projectId), '_chunks');
    const chunkFile = path.join(chunksDir, `${messageId}.chunks`);
    if (fs.existsSync(chunkFile)) {
      fs.unlinkSync(chunkFile);
    }

    return foundMessage;
  }

  /**
   * Get all chunks for a streaming message (for recovery).
   */
  getStreamChunks({ projectId, messageId }) {
    const chunksDir = path.join(this._projectDir(projectId), '_chunks');
    const chunkFile = path.join(chunksDir, `${messageId}.chunks`);

    if (!fs.existsSync(chunkFile)) return [];

    const lines = fs.readFileSync(chunkFile, 'utf-8').split('\n');
    const chunks = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        chunks.push(JSON.parse(line));
      } catch {}
    }

    return chunks.sort((a, b) => a.index - b.index);
  }

  /**
   * Get the timestamp of the last chunk for a streaming message.
   * Used to determine if streaming is still active.
   */
  getLastChunkTimestamp({ projectId, messageId }) {
    const chunksDir = path.join(this._projectDir(projectId), '_chunks');
    const chunkFile = path.join(chunksDir, `${messageId}.chunks`);

    if (!fs.existsSync(chunkFile)) return null;

    // Read last few lines efficiently
    const content = fs.readFileSync(chunkFile, 'utf-8');
    const lines = content.trim().split('\n');

    // Work backwards to find the last valid chunk with a timestamp
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const chunk = JSON.parse(line);
        if (chunk.timestamp) {
          return new Date(chunk.timestamp).getTime();
        }
      } catch {}
    }

    return null;
  }

  /**
   * Recover a streaming message by combining saved chunks.
   * Used when a connection drops mid-stream.
   * Parses raw terminal output to extract the actual response text.
   * Also extracts CLI session ID so conversation can be resumed.
   */
  recoverStreamingMessage({ projectId, sessionId, messageId }) {
    const chunks = this.getStreamChunks({ projectId, messageId });

    // Also try to get job output if available
    let rawContent = chunks.map(c => c.content).join('');

    // Try to get more data from job output file
    try {
      const msg = this._getMessage(projectId, sessionId, messageId);
      if (msg?.metadata?.jobId) {
        const jobOutputPath = path.join(__dirname, '../../data/jobs', `${msg.metadata.jobId}.output`);
        if (fs.existsSync(jobOutputPath)) {
          const jobOutput = fs.readFileSync(jobOutputPath, 'utf-8');
          if (jobOutput.length > rawContent.length) {
            rawContent = jobOutput; // Use job output if it has more data
          }
        }
      }
    } catch {}

    if (!rawContent || rawContent.length < 50) return null;

    // Parse the raw terminal output to extract the actual response AND session ID
    const { content: cleanedContent, cliSessionId } = this._parseRawChunksWithSessionId(rawContent);

    // If we found a CLI session ID, save it so conversation can be resumed
    if (cliSessionId) {
      this.updateSessionMeta(projectId, sessionId, { cliSessionId });
      console.log(`[chatStore] Recovered CLI session ID: ${cliSessionId}`);
    }

    if (!cleanedContent || cleanedContent.length < 10) {
      // Not enough content to recover - but we might have the session ID
      const failureMsg = cliSessionId
        ? '🔄 Connection was briefly interrupted. Resuming conversation automatically...'
        : '🔄 Reconnecting and recovering progress...';

      return this.finalizeStreamingMessage({
        projectId,
        sessionId,
        messageId,
        finalContent: failureMsg,
        metadata: {
          recovered: true,
          recoveryPending: true, // Changed from recoveryFailed - system will auto-resume
          chunkCount: chunks.length,
          cliSessionId: cliSessionId || null,
        },
      });
    }

    return this.finalizeStreamingMessage({
      projectId,
      sessionId,
      messageId,
      finalContent: cleanedContent,
      metadata: {
        recovered: true,
        chunkCount: chunks.length,
        cliSessionId: cliSessionId || null,
      },
    });
  }

  /**
   * Get a single message by ID (for recovery purposes)
   */
  _getMessage(projectId, sessionId, messageId) {
    const filePath = this._sessionFile(projectId, sessionId);
    if (!fs.existsSync(filePath)) return null;

    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    for (const line of lines) {
      const msg = deserialize(line);
      if (msg?.id === messageId) return msg;
    }
    return null;
  }

  /**
   * Parse raw terminal output to extract BOTH content AND CLI session ID.
   * Returns { content, cliSessionId }
   */
  _parseRawChunksWithSessionId(rawContent) {
    // Strip ANSI codes
    let clean = rawContent
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b[()][A-Z0-9]/g, '')
      .replace(/\r/g, '');

    let resultText = '';
    let cliSessionId = null;
    let partialTextBlocks = [];

    // Scan ALL JSON events - extract session_id, result, and partial content
    for (const line of clean.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;

      try {
        const json = JSON.parse(trimmed);

        // Extract session_id from any event that has it
        if (json.session_id) {
          cliSessionId = json.session_id;
        }

        // The result event has the final response text
        if (json.type === 'result' && json.result) {
          resultText = json.result;
        }

        // Capture text blocks from streaming content (partial responses)
        if (json.type === 'content_block_delta' && json.delta?.text) {
          partialTextBlocks.push(json.delta.text);
        }
        if (json.type === 'content' && json.text) {
          partialTextBlocks.push(json.text);
        }

        // Assistant message content blocks
        if (json.type === 'assistant' && json.message?.content) {
          const content = json.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                partialTextBlocks.push(block.text);
              }
            }
          }
        }
      } catch {}
    }

    // If we found a complete result, use it
    if (resultText) {
      return {
        content: resultText
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
          .trim(),
        cliSessionId,
      };
    }

    // If we have partial text blocks, combine them (partial response recovery)
    if (partialTextBlocks.length > 0) {
      const partialContent = partialTextBlocks.join('').trim();
      if (partialContent.length > 20) {
        return {
          content: partialContent + '\n\n---\n🔄 *Recovered partial response. The system will continue automatically.*',
          cliSessionId,
        };
      }
    }

    // Fallback to filtering meaningful lines
    return {
      content: this._filterMeaningfulLines(clean),
      cliSessionId,
    };
  }

  /**
   * Parse raw terminal output (with JSON events, ANSI codes) to extract clean response text.
   * Handles Claude's stream-json format.
   */
  _parseRawChunksToContent(rawContent) {
    return this._parseRawChunksWithSessionId(rawContent).content;
  }

  /**
   * Filter meaningful lines from cleaned output (fallback when JSON parsing fails)
   */
  _filterMeaningfulLines(clean) {

    // Find where JSON output starts (skip command echo)
    const lines = clean.split('\n');
    const firstJsonIdx = lines.findIndex(l => {
      const t = l.trim();
      return t.startsWith('{') && (t.includes('"type"') || t.includes('"session_id"'));
    });

    // If we found JSON, everything before it is command echo
    const outputLines = firstJsonIdx > 0 ? lines.slice(firstJsonIdx) : lines;

    // Filter out JSON lines, command echoes, and preamble content
    const meaningfulLines = outputLines.filter(line => {
      const t = line.trim();
      if (!t) return false;
      if (t.startsWith('{') && (t.includes('"type"') || t.includes('"session_id"'))) return false;
      if (t.startsWith('claude -p')) return false;
      if (t.startsWith('copilot -p')) return false;
      if (t.startsWith('aider ')) return false;
      if (/^[>#$]\s*$/.test(t)) return false; // Shell prompts
      if (/^\w+@[\w.-]+:.*[$#]\s*$/.test(t)) return false; // user@host:path$
      // All echoed preamble content starts with > (from shell continuation)
      if (t.startsWith('> ')) return false;
      // Filter out command-line arguments
      if (t.includes('--output-format')) return false;
      if (t.includes('--dangerously-skip-permissions')) return false;
      if (t.includes('--verbose')) return false;
      if (t.includes("--resume '")) return false;
      return true;
    });

    return meaningfulLines.join('\n').trim();
  }

  /**
   * Get any incomplete streaming messages for a session (for recovery on reconnect).
   */
  getIncompleteStreamingMessages(projectId, sessionId) {
    const filePath = this._sessionFile(projectId, sessionId);
    if (!fs.existsSync(filePath)) return [];

    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    const incomplete = [];

    for (const line of lines) {
      const msg = deserialize(line);
      if (msg && msg.metadata?.streaming === true) {
        // Get any saved chunks
        const chunks = this.getStreamChunks({ projectId, messageId: msg.id });
        incomplete.push({
          message: msg,
          chunks,
          partialContent: chunks.map(c => c.content).join(''),
        });
      }
    }

    return incomplete;
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
    const now = Date.now();

    for (const line of lines) {
      const msg = deserialize(line);
      if (msg) {
        // Handle incomplete streaming messages
        if (msg.metadata?.streaming === true) {
          // Check the LAST CHUNK timestamp, not when streaming started.
          // Claude can work for 30+ minutes - we need to know if it's STILL active.
          const lastChunkTime = this.getLastChunkTimestamp({ projectId, messageId: msg.id });
          const streamStarted = msg.metadata?.streamStartedAt
            ? new Date(msg.metadata.streamStartedAt).getTime()
            : new Date(msg.createdAt).getTime();

          // Use last chunk time if available, otherwise fall back to stream start
          // Consider "stale" if no activity for 5 minutes (Claude pauses can be long)
          const lastActivityTime = lastChunkTime || streamStarted;
          const silenceMs = now - lastActivityTime;
          const isStale = silenceMs > 5 * 60 * 1000; // 5 minutes of silence

          if (isStale) {
            // Try to auto-recover this stale incomplete message
            const recovered = this.recoverStreamingMessage({
              projectId,
              sessionId,
              messageId: msg.id,
            });
            if (recovered) {
              messages.push(recovered);
              continue;
            }
          }

          // Skip streaming messages entirely (both active and unrecoverable stale ones)
          // Active ones will be shown via WebSocket streaming
          // Stale unrecoverable ones would just show garbage
          continue;
        }
        messages.push(msg);
      }
    }

    // Clean up orphaned progress messages (progress messages at the end with no following agent/error response)
    // These are stale from previous interrupted sessions
    let cleanedMessages = messages;
    while (cleanedMessages.length > 0) {
      const last = cleanedMessages[cleanedMessages.length - 1];
      if (last.role === 'progress') {
        cleanedMessages = cleanedMessages.slice(0, -1);
      } else {
        break;
      }
    }

    // Also remove progress messages that appear after the last user message if there's no agent response after them
    // Find the last user message index
    const lastUserIdx = cleanedMessages.findLastIndex(m => m.role === 'user');
    if (lastUserIdx >= 0) {
      // Check if there's an agent/error response after the last user message
      const hasResponseAfterUser = cleanedMessages.slice(lastUserIdx + 1).some(m =>
        m.role === 'agent' || m.role === 'error'
      );
      if (!hasResponseAfterUser) {
        // Remove all progress messages after the last user (they're orphaned)
        cleanedMessages = [
          ...cleanedMessages.slice(0, lastUserIdx + 1),
          ...cleanedMessages.slice(lastUserIdx + 1).filter(m => m.role !== 'progress')
        ];
      }
    }

    if (before) {
      const idx = cleanedMessages.findIndex(m => m.id === before);
      if (idx > 0) return cleanedMessages.slice(Math.max(0, idx - limit), idx).reverse();
      return [];
    }

    return cleanedMessages.slice(-limit).reverse();
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
