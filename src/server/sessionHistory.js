/**
 * Session History Manager
 * Saves and retrieves terminal session scrollback history.
 * Scrollback text is stored as .txt files; metadata lives in the DB.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDB } from './db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Store scrollback text files in data/session-history/
const HISTORY_DIR = path.join(__dirname, '../../data/session-history');

// Live scrollback files — written continuously per active session
const LIVE_DIR = path.join(__dirname, '../../data/session-live');
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
if (!fs.existsSync(LIVE_DIR)) fs.mkdirSync(LIVE_DIR, { recursive: true });

class SessionHistory {
  constructor() {
    // Track debounce timers per session for live writes
    this._liveTimers = new Map();
  }

  /**
   * Write live scrollback to disk (debounced 3s).
   * Called on every PTY output chunk. The file is always up-to-date
   * within 3 seconds — survives hard kills, PM2 restarts, crashes.
   */
  writeLive(sessionId, scrollback, meta = {}) {
    // Debounce: schedule a write 3 seconds after the last call
    if (this._liveTimers.has(sessionId)) {
      clearTimeout(this._liveTimers.get(sessionId));
    }
    this._liveTimers.set(sessionId, setTimeout(() => {
      this._liveTimers.delete(sessionId);
      try {
        const cleanText = (scrollback || '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
        const header = `Session: ${sessionId}\nProject: ${meta.projectId || 'unknown'}\nRole: ${meta.role || 'main'}\nSaved: ${new Date().toISOString()}\n${'─'.repeat(60)}\n`;
        fs.writeFileSync(path.join(LIVE_DIR, `${sessionId}.txt`), header + cleanText, 'utf-8');
      } catch { /* non-critical */ }
    }, 3000));
  }

  /**
   * Flush all pending live writes immediately (called on shutdown).
   */
  flushLive(sessions) {
    for (const [sessionId, timer] of this._liveTimers) {
      clearTimeout(timer);
    }
    this._liveTimers.clear();
    // Write all provided sessions immediately
    if (sessions) {
      for (const s of sessions) {
        try {
          const cleanText = (s.scrollback || '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
          const header = `Session: ${s.id}\nProject: ${s.projectId || 'unknown'}\nRole: ${s.role || 'main'}\nSaved: ${new Date().toISOString()}\n${'─'.repeat(60)}\n`;
          fs.writeFileSync(path.join(LIVE_DIR, `${s.id}.txt`), header + cleanText, 'utf-8');
        } catch { /* non-critical */ }
      }
    }
  }

  /**
   * Clean up a live file when a session ends (it's been saved to history).
   */
  removeLive(sessionId) {
    if (this._liveTimers.has(sessionId)) {
      clearTimeout(this._liveTimers.get(sessionId));
      this._liveTimers.delete(sessionId);
    }
    try { fs.unlinkSync(path.join(LIVE_DIR, `${sessionId}.txt`)); } catch {}
  }

  /**
   * Save a session's scrollback when it ends.
   * Strips ANSI codes from the scrollback for readable storage.
   * Stores metadata in db.data.sessionHistory and scrollback as a .txt file.
   */
  async saveSession({ sessionId, projectId, role, name, cliTool, containerName, scrollback, createdAt, endedAt, exitCode }) {
    const id = uuidv4();
    const fileName = `${id}.txt`;
    const filePath = path.join(HISTORY_DIR, fileName);

    // Strip ANSI codes for readable text
    const cleanScrollback = (scrollback || '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

    // Save scrollback to file
    fs.writeFileSync(filePath, cleanScrollback, 'utf-8');

    // Save metadata to DB
    const entry = {
      id,
      sessionId,
      projectId,
      role: role || 'main',
      name: name || null, // LLM-generated name, or null (will be filled async)
      cliTool: cliTool || null,
      containerName: containerName || null,
      fileName,
      scrollbackSize: cleanScrollback.length,
      createdAt: createdAt || new Date().toISOString(),
      endedAt: endedAt || new Date().toISOString(),
      exitCode: exitCode ?? null,
      namedAt: null, // Set when LLM names it
    };

    const db = getDB();
    if (!db.data.sessionHistory) db.data.sessionHistory = [];
    db.data.sessionHistory.unshift(entry); // newest first

    // Keep max 100 entries — delete oldest files
    while (db.data.sessionHistory.length > 100) {
      const old = db.data.sessionHistory.pop();
      try { fs.unlinkSync(path.join(HISTORY_DIR, old.fileName)); } catch {}
    }

    await db.write();
    return entry;
  }

  /**
   * Get session history entries, optionally filtered by project
   */
  getHistory(projectId = null, limit = 50) {
    const db = getDB();
    let entries = db.data.sessionHistory || [];
    if (projectId) entries = entries.filter(e => e.projectId === projectId);
    return entries.slice(0, limit);
  }

  /**
   * Get the scrollback content for a history entry
   */
  getScrollback(historyId) {
    const db = getDB();
    const entry = (db.data.sessionHistory || []).find(e => e.id === historyId);
    if (!entry) return null;

    const filePath = path.join(HISTORY_DIR, entry.fileName);
    try {
      return { ...entry, scrollback: fs.readFileSync(filePath, 'utf-8') };
    } catch {
      return { ...entry, scrollback: '(scrollback file not found)' };
    }
  }

  /**
   * Update a history entry's name (called by LLM async naming)
   */
  async updateName(historyId, name) {
    const db = getDB();
    const entry = (db.data.sessionHistory || []).find(e => e.id === historyId);
    if (entry) {
      entry.name = name;
      entry.namedAt = new Date().toISOString();
      await db.write();
    }
  }

  /**
   * Delete a history entry and its file
   */
  async deleteEntry(historyId) {
    const db = getDB();
    const idx = (db.data.sessionHistory || []).findIndex(e => e.id === historyId);
    if (idx === -1) return false;
    const entry = db.data.sessionHistory[idx];
    try { fs.unlinkSync(path.join(HISTORY_DIR, entry.fileName)); } catch {}
    db.data.sessionHistory.splice(idx, 1);
    await db.write();
    return true;
  }

  /**
   * Async LLM naming for a history entry.
   * Uses the last 1000 chars of scrollback to generate a 2-5 word name.
   */
  async nameWithLLM(historyId) {
    try {
      const entry = this.getScrollback(historyId);
      if (!entry || !entry.scrollback || entry.scrollback.length < 50) {
        // Not enough content to name — use date
        await this.updateName(historyId, new Date(entry.endedAt).toLocaleString());
        return;
      }

      const { llmProvider } = await import('./llmProvider.js');
      if (!llmProvider.getSettings().enabled) {
        await this.updateName(historyId, new Date(entry.endedAt).toLocaleString());
        return;
      }

      const sample = entry.scrollback.slice(-1000);
      const result = await llmProvider.generateResponse(
        `Based on this terminal session, generate a very short name (2-5 words). Examples: "Auth API Setup", "Deploy Staging Fix". Reply ONLY with the name.\n\n${sample}`,
        { systemPrompt: 'Name terminal sessions concisely. Reply with ONLY a 2-5 word name.', maxTokens: 20, temperature: 0.3 }
      );

      const name = (result.response || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim().slice(0, 40);
      if (name && name.length > 1) {
        await this.updateName(historyId, `${name} — ${new Date(entry.endedAt).toLocaleDateString()}`);
      } else {
        await this.updateName(historyId, new Date(entry.endedAt).toLocaleString());
      }
    } catch {
      // Non-critical — use date as fallback
      try { await this.updateName(historyId, new Date().toLocaleString()); } catch {}
    }
  }
}

export const sessionHistory = new SessionHistory();
export default sessionHistory;
