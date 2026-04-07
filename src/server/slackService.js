/**
 * Slack Integration Service
 *
 * Bridges the IDE's chat system with Slack using Socket Mode (no public URL needed).
 *
 * Mapping:
 *   - Slack channel  ↔  Project
 *   - Slack thread   ↔  Chat session
 *
 * Inbound:  Slack message → creates/resumes a chat session → dispatched to agent
 * Outbound: Agent response → posted back to the Slack thread
 *
 * @module slackService
 */

import { App as SlackApp } from '@slack/bolt';
import { getDB } from './db.js';

// ─── State ───────────────────────────────────────────────────────────────────

/** @type {SlackApp|null} */
let slackApp = null;

/** thread_ts → chatSessionId */
const threadToSession = new Map();

/** chatSessionId → { channelId, threadTs } */
const sessionToThread = new Map();

/** channelId → projectId */
const channelToProject = new Map();

/** projectId → channelId */
const projectToChannel = new Map();

/**
 * broadcastFn injected by terminalServer so we can push Slack-originated
 * messages into the normal chat pipeline.
 * Signature: (data: { projectId, sessionId, content, mode, tool }) => void
 */
let inboundHandler = null;

// ─── Settings helpers ────────────────────────────────────────────────────────

function _readSettings() {
  const db = getDB();
  return db.data.slackSettings || { enabled: false, botToken: '', appToken: '', channelMap: {} };
}

async function _writeSettings(settings) {
  const db = getDB();
  db.data.slackSettings = settings;
  await db.write();
}

// ─── Public API ──────────────────────────────────────────────────────────────

const slackService = {
  /** Whether the bot is currently connected */
  get connected() {
    return slackApp !== null;
  },

  /** Get sanitised settings (tokens masked) */
  getSettings() {
    const s = _readSettings();
    return {
      enabled: s.enabled,
      botToken: s.botToken ? '***configured***' : '',
      appToken: s.appToken ? '***configured***' : '',
      channelMap: s.channelMap || {},
    };
  },

  /** Persist tokens + channel map.  Restarts the bot if already running. */
  async updateSettings(updates) {
    const current = _readSettings();
    const merged = {
      ...current,
      ...updates,
      channelMap: { ...current.channelMap, ...updates.channelMap },
    };
    await _writeSettings(merged);

    // Rebuild in-memory maps
    _rebuildMaps(merged.channelMap);

    // Restart if running
    if (slackApp) {
      await this.disconnect();
      if (merged.enabled && merged.botToken && merged.appToken) {
        await this.connect();
      }
    }
    return this.getSettings();
  },

  /** Map a Slack channel ↔ project */
  async mapChannel(projectId, channelId) {
    const settings = _readSettings();
    settings.channelMap = settings.channelMap || {};
    settings.channelMap[projectId] = channelId;
    await _writeSettings(settings);
    channelToProject.set(channelId, projectId);
    projectToChannel.set(projectId, channelId);
  },

  /** Unmap a project's channel */
  async unmapChannel(projectId) {
    const settings = _readSettings();
    const channelId = settings.channelMap?.[projectId];
    if (channelId) {
      delete settings.channelMap[projectId];
      await _writeSettings(settings);
      channelToProject.delete(channelId);
      projectToChannel.delete(projectId);
    }
  },

  /** Register a callback for inbound Slack messages → chat pipeline */
  onInboundMessage(handler) {
    inboundHandler = handler;
  },

  // ─── Connection lifecycle ────────────────────────────────────────────────

  async connect() {
    const settings = _readSettings();
    if (!settings.botToken || !settings.appToken) {
      throw new Error('Slack bot token and app-level token are required');
    }

    _rebuildMaps(settings.channelMap || {});

    slackApp = new SlackApp({
      token: settings.botToken,
      appToken: settings.appToken,
      socketMode: true,
      // Avoid noisy logs in production
      logLevel: 'WARN',
    });

    // ── Handle channel messages (not in a thread) → new session ──
    slackApp.message(async ({ message, say }) => {
      // Ignore bot's own messages, edits, and sub-typed events
      if (message.subtype || message.bot_id) return;

      const channelId = message.channel;
      const projectId = channelToProject.get(channelId);
      if (!projectId) return; // Channel not mapped

      // If message is already in a thread, handle as thread reply
      if (message.thread_ts && message.thread_ts !== message.ts) {
        await _handleThreadReply(message, projectId);
        return;
      }

      // New top-level message → create a session and reply in a thread
      const sessionId = await _createSessionFromSlack(projectId, message);

      // Send to agent pipeline
      if (inboundHandler) {
        inboundHandler({
          projectId,
          sessionId,
          content: message.text || '',
          mode: 'agent',
          tool: 'claude',
          source: 'slack',
        });
      }
    });

    // ── Handle thread replies → existing session ──
    slackApp.event('message', async ({ event }) => {
      if (event.subtype || event.bot_id) return;
      if (!event.thread_ts || event.thread_ts === event.ts) return; // top-level handled above

      const projectId = channelToProject.get(event.channel);
      if (!projectId) return;

      await _handleThreadReply(event, projectId);
    });

    await slackApp.start();
    console.log('[SlackService] Connected via Socket Mode');
  },

  async disconnect() {
    if (slackApp) {
      try { await slackApp.stop(); } catch {}
      slackApp = null;
      console.log('[SlackService] Disconnected');
    }
  },

  // ─── Outbound: send a message to Slack ────────────────────────────────────

  /**
   * Post a message to the Slack thread corresponding to a chat session.
   * Called by terminalServer when broadcasting agent responses.
   */
  async postToThread(projectId, chatSessionId, text) {
    if (!slackApp || !text) return;

    const channelId = projectToChannel.get(projectId);
    if (!channelId) return;

    const mapping = sessionToThread.get(chatSessionId);

    try {
      if (mapping) {
        // Reply in existing thread
        await slackApp.client.chat.postMessage({
          channel: channelId,
          thread_ts: mapping.threadTs,
          text: _truncate(text, 3900), // Slack limit ~4000 chars
        });
      } else {
        // No thread yet — start a new one
        const result = await slackApp.client.chat.postMessage({
          channel: channelId,
          text: _truncate(text, 3900),
        });
        if (result.ts) {
          _linkSession(chatSessionId, channelId, result.ts);
        }
      }
    } catch (err) {
      console.warn('[SlackService] Failed to post message:', err.message);
    }
  },

  /**
   * Create a new Slack thread for a session and post an initial message.
   * Returns the thread_ts or null.
   */
  async startThread(projectId, chatSessionId, introText) {
    if (!slackApp) return null;

    const channelId = projectToChannel.get(projectId);
    if (!channelId) return null;

    try {
      const result = await slackApp.client.chat.postMessage({
        channel: channelId,
        text: introText || 'New session started from the IDE',
      });
      if (result.ts) {
        _linkSession(chatSessionId, channelId, result.ts);
        return result.ts;
      }
    } catch (err) {
      console.warn('[SlackService] Failed to start thread:', err.message);
    }
    return null;
  },

  /**
   * Auto-start on server boot if previously enabled.
   */
  async autoStart() {
    const settings = _readSettings();
    if (settings.enabled && settings.botToken && settings.appToken) {
      try {
        await this.connect();
      } catch (err) {
        console.warn('[SlackService] Auto-start failed:', err.message);
      }
    }
  },

  /** Expose maps for debugging / status endpoints */
  getStatus() {
    return {
      connected: this.connected,
      channelMappings: Object.fromEntries(channelToProject),
      activeSessions: sessionToThread.size,
    };
  },
};

// ─── Internal helpers ────────────────────────────────────────────────────────

function _rebuildMaps(channelMap) {
  channelToProject.clear();
  projectToChannel.clear();
  for (const [projectId, channelId] of Object.entries(channelMap)) {
    channelToProject.set(channelId, projectId);
    projectToChannel.set(projectId, channelId);
  }
}

function _linkSession(chatSessionId, channelId, threadTs) {
  threadToSession.set(threadTs, chatSessionId);
  sessionToThread.set(chatSessionId, { channelId, threadTs });
}

async function _createSessionFromSlack(projectId, message) {
  const { chatStore } = await import('./chatStore.js');
  chatStore.migrateIfNeeded(projectId);

  const userName = message.user ? `<@${message.user}>` : 'Slack user';
  const session = chatStore.createSession(projectId, `Slack: ${userName}`);

  _linkSession(session.id, message.channel, message.ts);

  return session.id;
}

async function _handleThreadReply(event, projectId) {
  const threadTs = event.thread_ts;
  let sessionId = threadToSession.get(threadTs);

  if (!sessionId) {
    // Thread exists in Slack but we lost the mapping (e.g., server restarted).
    // Create a new session and link it.
    const { chatStore } = await import('./chatStore.js');
    chatStore.migrateIfNeeded(projectId);
    const session = chatStore.createSession(projectId, 'Slack (resumed)');
    sessionId = session.id;
    _linkSession(sessionId, event.channel, threadTs);
  }

  if (inboundHandler) {
    inboundHandler({
      projectId,
      sessionId,
      content: event.text || '',
      mode: 'agent',
      tool: 'claude',
      source: 'slack',
    });
  }
}

function _truncate(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

export { slackService };
