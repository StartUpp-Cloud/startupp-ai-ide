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

/** message event de-duplication cache (channel:ts -> seenAt) */
const processedSlackEvents = new Map();

/**
 * broadcastFn injected by terminalServer so we can push Slack-originated
 * messages into the normal chat pipeline.
 * Signature: (data: { projectId, sessionId, content, mode, tool }) => void
 */
let inboundHandler = null;

// ─── Settings helpers ────────────────────────────────────────────────────────

function _readSettings() {
  const db = getDB();
  return db.data.slackSettings || { enabled: false, botToken: '', appToken: '', channelMap: {}, defaultTool: 'claude' };
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
      defaultTool: s.defaultTool || 'claude',
    };
  },

  /** Persist tokens + channel map.  Restarts the bot if already running. */
  async updateSettings(updates) {
    const current = _readSettings();
      const merged = {
        ...current,
        ...updates,
        channelMap: { ...current.channelMap, ...updates.channelMap },
        defaultTool: updates.defaultTool || current.defaultTool || 'claude',
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

    console.log('[SlackService] Channel mappings loaded:', {
      channelToProject: Array.from(channelToProject.entries()),
      projectToChannel: Array.from(projectToChannel.entries()),
    });

    slackApp = new SlackApp({
      token: settings.botToken,
      appToken: settings.appToken,
      socketMode: true,
      // Temporarily set to DEBUG to see Slack events
      logLevel: 'DEBUG',
    });

    // ── Handle channel messages (not in a thread) → new session ──
    slackApp.message(async ({ message, say }) => {
      console.log('[SlackService] 🔔 MESSAGE RECEIVED:', {
        channel: message.channel,
        text: message.text?.substring(0, 50),
        user: message.user,
        subtype: message.subtype,
        bot_id: message.bot_id,
        thread_ts: message.thread_ts,
        ts: message.ts,
      });

      // Ignore bot's own messages, edits, and sub-typed events
      if (message.subtype || message.bot_id) {
        console.log('[SlackService] ❌ Message filtered (subtype or bot_id)');
        return;
      }

      if (!_markIfFirstEvent(message.channel, message.ts)) {
        console.log('[SlackService] ⏭️ Duplicate message event ignored');
        return;
      }

      const channelId = message.channel;
      const projectId = channelToProject.get(channelId);
      console.log('[SlackService] Channel mapping check:', {
        channelId,
        projectId,
        allMappings: Array.from(channelToProject.entries()),
      });

      if (!projectId) {
        console.log('[SlackService] ❌ Channel not mapped to any project');
        return; // Channel not mapped
      }

      // If message is already in a thread, handle as thread reply
      if (message.thread_ts && message.thread_ts !== message.ts) {
        console.log('[SlackService] → Routing to thread reply handler');
        await _handleThreadReply(message, projectId);
        return;
      }

      // New top-level message → create a session and reply in a thread
      console.log('[SlackService] ✅ Creating new session for message');
      const sessionId = await _createSessionFromSlack(projectId, message);
      await _postAck(message);

      // Send to agent pipeline
      if (inboundHandler) {
        console.log('[SlackService] → Dispatching to agent pipeline');
        inboundHandler({
          projectId,
          sessionId,
          content: message.text || '',
          mode: 'agent',
          tool: settings.defaultTool || 'claude',
          source: 'slack',
        });
      } else {
        console.log('[SlackService] ⚠️ No inbound handler registered!');
      }
    });

    // ── Handle thread replies → existing session ──
    slackApp.event('message', async ({ event }) => {
      console.log('[SlackService] 🔔 EVENT RECEIVED:', {
        type: event.type,
        channel: event.channel,
        text: event.text?.substring(0, 50),
        subtype: event.subtype,
        bot_id: event.bot_id,
        thread_ts: event.thread_ts,
        ts: event.ts,
      });

      if (event.subtype || event.bot_id) {
        console.log('[SlackService] ❌ Event filtered (subtype or bot_id)');
        return;
      }

      if (!_markIfFirstEvent(event.channel, event.ts)) {
        console.log('[SlackService] ⏭️ Duplicate event ignored');
        return;
      }

      if (!event.thread_ts || event.thread_ts === event.ts) {
        console.log('[SlackService] ⏭️ Event is top-level, skipping (handled by message listener)');
        return; // top-level handled above
      }

      const projectId = channelToProject.get(event.channel);
      if (!projectId) {
        console.log('[SlackService] ❌ Event channel not mapped');
        return;
      }

      console.log('[SlackService] ✅ Handling thread reply');
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

function _markIfFirstEvent(channelId, ts) {
  if (!channelId || !ts) return true;

  const now = Date.now();
  const key = `${channelId}:${ts}`;
  const ttlMs = 5 * 60 * 1000;
  const seenAt = processedSlackEvents.get(key);

  if (seenAt && now - seenAt < ttlMs) {
    return false;
  }

  processedSlackEvents.set(key, now);

  if (processedSlackEvents.size > 1000) {
    for (const [k, t] of processedSlackEvents.entries()) {
      if (now - t >= ttlMs) processedSlackEvents.delete(k);
    }
  }

  return true;
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
    await _postAck(event);
    inboundHandler({
      projectId,
      sessionId,
      content: event.text || '',
      mode: 'agent',
      tool: _readSettings().defaultTool || 'claude',
      source: 'slack',
    });
  }
}

async function _postAck(messageOrEvent) {
  if (!slackApp) return;
  try {
    await slackApp.client.chat.postMessage({
      channel: messageOrEvent.channel,
      thread_ts: messageOrEvent.thread_ts || messageOrEvent.ts,
      text: 'Got it - working on this now.',
    });
  } catch (err) {
    console.warn('[SlackService] Failed to post ack:', err.message);
  }
}

function _truncate(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

export { slackService };
