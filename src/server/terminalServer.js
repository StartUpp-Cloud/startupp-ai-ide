/**
 * Terminal WebSocket Server
 * Handles real-time communication between frontend and PTY sessions
 */

import { WebSocketServer } from 'ws';
import { ptyManager } from './ptyManager.js';
import { OutputBuffer, stripAnsi } from './conversationParser.js';
import History from './models/History.js';
import Project from './models/Project.js';
import { autoResponder } from './autoResponder.js';
import { sessionContext } from './sessionContext.js';
import { orchestrator } from './orchestrator.js';
import { activityFeed } from './activityFeed.js';
import { agentShellPool } from './agentShellPool.js';
import { slackService } from './slackService.js';
import { mergeSessionAssistantSettings } from './sessionSettings.js';
import { shellProxy } from './shellProxy.js';
import {
  ACTIVE_RUN_STALE_MS,
  RELIABILITY_SWEEP_INTERVAL_MS,
  STREAM_AUTO_RETRY_MAX_AGE_MS,
  STREAM_RECOVERY_STALE_MS,
  VISIBLE_STREAM_RECOVERY_STALE_MS,
} from './sessionRecovery.js';

const ROLE_PROMPT_IDS = new Set([
  'principal-engineer',
  'design-director',
  'security-architect',
  'operator-ceo',
  'venture-capitalist',
]);

function normalizeRolePromptIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(id => typeof id === 'string' && ROLE_PROMPT_IDS.has(id)))];
}

function sanitizeRolePromptInstructions(value) {
  const text = String(value || '').trim();
  return text.length > 5000 ? text.slice(0, 5000) : text;
}

function appendRolePromptInstructions(content, instructions) {
  const prompt = sanitizeRolePromptInstructions(instructions);
  if (!prompt) return content;
  return `${content || ''}\n\n---\n\n${prompt}`;
}

class TerminalServer {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // ws -> { sessionId, ... }
    this.sessionClients = new Map(); // sessionId -> Set of ws clients
    this.outputBuffers = new Map(); // sessionId -> OutputBuffer
    this.userInputBuffers = new Map(); // sessionId -> current user input
    this.recentOutput = new Map(); // sessionId -> recent output for prompt detection
    this.lastInteractivePrompt = new Map(); // sessionId -> last prompt tail for input normalization
    this.sessionCliTools = new Map(); // sessionId -> cliTool
    this.autoResponseTimers = new Map(); // sessionId -> pending auto-response timer
    this.shellStreams = new Map(); // projectId:chatSessionId -> active shell output stream
    this.reliabilityMonitor = null;
    this.reliabilitySweepRunning = false;

    // Per-session WebSocket tracking for isolation
    // Each chat session gets its own dedicated client set
    this.chatSessionClients = new Map(); // chatSessionId -> Set of ws clients
    this.clientChatSessions = new Map(); // ws -> chatSessionId (for cleanup)
  }

  /**
   * Attach a WebSocket client to a specific chat session.
   * This enables per-session isolation for parallel work.
   */
  attachToChatSession(ws, chatSessionId) {
    // Remove from previous chat session if any
    const prevSession = this.clientChatSessions.get(ws);
    if (prevSession && prevSession !== chatSessionId) {
      const prevClients = this.chatSessionClients.get(prevSession);
      if (prevClients) {
        prevClients.delete(ws);
        if (prevClients.size === 0) {
          this.chatSessionClients.delete(prevSession);
        }
      }
    }

    // Add to new chat session
    if (!this.chatSessionClients.has(chatSessionId)) {
      this.chatSessionClients.set(chatSessionId, new Set());
    }
    this.chatSessionClients.get(chatSessionId).add(ws);
    this.clientChatSessions.set(ws, chatSessionId);

    console.log(`[TerminalServer] Client attached to chat session ${chatSessionId}`);
  }

  /**
   * Broadcast to all clients attached to a specific chat session.
   * Used for isolated per-session communication.
   */
  broadcastToChatSession(chatSessionId, message) {
    const clients = this.chatSessionClients.get(chatSessionId);
    if (!clients || clients.size === 0) {
      // Even with no UI clients, still mirror to Slack
    }

    const data = JSON.stringify(message);
    if (clients) {
      for (const client of clients) {
        if (client.readyState === 1) { // WebSocket.OPEN
          try {
            client.send(data);
          } catch (err) {
            console.warn(`[TerminalServer] Failed to send to chat session client:`, err.message);
          }
        }
      }
    }

    // Mirror final agent/assistant/error output to Slack thread
    if (slackService.connected) {
      const isDirectChatMessage = message?.type === 'chat-message' && message.message;
      const isStreamComplete = message?.type === 'chat-message-stream-complete' && message.message;
      const msg = (isDirectChatMessage || isStreamComplete) ? message.message : null;
      if ((msg?.role === 'agent' || msg?.role === 'assistant' || msg?.role === 'error') && msg?.content && msg?.projectId) {
        slackService.postToThread(msg.projectId, chatSessionId, msg.content).catch(() => {});
      }
    }
  }

  /**
   * Clean up chat session tracking when a client disconnects.
   */
  detachFromChatSession(ws) {
    const chatSessionId = this.clientChatSessions.get(ws);
    if (chatSessionId) {
      const clients = this.chatSessionClients.get(chatSessionId);
      if (clients) {
        clients.delete(ws);
        if (clients.size === 0) {
          this.chatSessionClients.delete(chatSessionId);
        }
      }
      this.clientChatSessions.delete(ws);
    }
  }

  /**
   * Initialize WebSocket server
   */
  init(server) {
    this.wss = new WebSocketServer({
      server,
      path: '/ws/terminal',
    });

    // Broadcast agent shell output to all clients for live stream viewer
    agentShellPool.on('output', ({ sessionId, data, projectId, chatSessionId }) => {
      this.broadcast({ type: 'agent-shell-output', sessionId, data, projectId, chatSessionId });
    });

      // Register Slack inbound handler — Slack messages enter the same chat pipeline
    slackService.onInboundMessage(async ({ projectId, sessionId, content, mode, tool }) => {
      const { chatStore } = await import('./chatStore.js');
      const { agentGateway } = await import('./agentGateway.js');

      chatStore.migrateIfNeeded(projectId);
      const sessionMeta = chatStore.getSession(projectId, sessionId);
      // sessionMeta (persisted via PATCH) is authoritative — only use Slack tool as fallback
      const assistantSettings = mergeSessionAssistantSettings(sessionMeta || {}, {}, {
        tool: tool || 'claude',
      });
      chatStore.updateSessionMeta(projectId, sessionId, assistantSettings);

      // Persist user message
      const userMsg = chatStore.addMessage({
        projectId,
        sessionId,
        role: 'user',
        content,
        metadata: { mode, source: 'slack', ...assistantSettings },
      });

      // Broadcast to UI clients watching this session
      this.broadcastToChatSession(sessionId, { type: 'chat-message', message: userMsg });
      this.broadcast({ type: 'chat-message', message: userMsg });

      // Dispatch to agent
      agentGateway.handleTask({
        projectId,
        sessionId,
        content,
        attachments: [],
        mode: mode || 'agent',
        tool: assistantSettings.tool,
        model: assistantSettings.model,
        effort: assistantSettings.effort,
        broadcastFn: (data) => {
          this.broadcastToChatSession(sessionId, data);
          this.broadcast(data);
        },
      }).catch(err => {
        const errMsg = chatStore.addMessage({
          projectId,
          sessionId,
          role: 'error',
          content: `Gateway error: ${err.message}`,
        });
        this.broadcastToChatSession(sessionId, { type: 'chat-message', message: errMsg });
        this.broadcast({ type: 'chat-message', message: errMsg });
      });
    });

    this.wss.on('connection', (ws) => {
      console.log('WebSocket client connected');

      this.clients.set(ws, { sessionId: null });

      ws.on('message', (message) => {
        try {
          const msg = JSON.parse(message.toString());
          this.handleMessage(ws, msg).catch((error) => {
            console.error('Failed to handle WebSocket message:', error);
            this.sendError(ws, error.message || 'Failed to handle message');
          });
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
          this.sendError(ws, 'Invalid message format');
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.handleDisconnect(ws);
      });

      // Send initial connection success
      this.send(ws, { type: 'connected', timestamp: Date.now() });
    });

    // Listen to PTY manager events.
    // Coalesce output with a 5ms buffer so escape sequences aren't split across
    // WebSocket messages. This prevents fragments like [2, [34, ;165R, RRR from
    // appearing as visible text when the client-side filter can't match them.
    const coalesceBufs = new Map(); // sessionId -> { data, timer }

    ptyManager.on('data', ({ sessionId, data }) => {
      let buf = coalesceBufs.get(sessionId);
      if (!buf) {
        buf = { data: '', timer: null };
        coalesceBufs.set(sessionId, buf);
      }
      buf.data += data;

      if (buf.timer) clearTimeout(buf.timer);
      buf.timer = setTimeout(async () => {
        const coalesced = buf.data;
        buf.data = '';
        coalesceBufs.delete(sessionId);

        // Broadcast coalesced output to clients
        this.broadcastToSession(sessionId, {
          type: 'output',
          sessionId,
          data: coalesced,
        });

        // Buffer output for history parsing
        const buffer = this.outputBuffers.get(sessionId);
        if (buffer) {
          buffer.append(coalesced);
        }

        // Track recent output for prompt detection
        this.trackOutputForPromptDetection(sessionId, coalesced);

        // Forward to orchestrator if it has an active execution for this session
        orchestrator.feedOutput(sessionId, coalesced);

        // agentShellPool.feedOutput is handled via ptyManager 'data' event listener
        // (set up in agentShellPool constructor — no dynamic import needed)
      }, 5);
    });

    ptyManager.on('exit', ({ sessionId, exitCode, signal }) => {
      this.broadcastToSession(sessionId, {
        type: 'exit',
        sessionId,
        exitCode,
        signal,
      });

      orchestrator.notifyExit(sessionId, exitCode);
    });

    // session-created is sent directly to the requesting client in handleCreateSession
    // No broadcast needed — other clients get updated via list-sessions

    // Auto-name sessions using LLM when enough output has accumulated
    ptyManager.on('needs-naming', async ({ sessionId, projectId }) => {
      try {
        const settings = (await import('./llmProvider.js')).llmProvider.getSettings();
        if (!settings.enabled) return;

        const scrollback = ptyManager.getScrollback(sessionId);
        // Strip ANSI and take last 1000 chars for context
        const cleanOutput = scrollback.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').slice(-1000);

        const { llmProvider } = await import('./llmProvider.js');
        const result = await llmProvider.generateResponse(
          `Based on this terminal session output, generate a very short descriptive name (2-5 words max). Examples: "Auth API Setup", "Bug Fix Login", "DB Migration", "Test Suite Run", "Deploy Staging". Reply with ONLY the name, nothing else.\n\nOutput:\n${cleanOutput}`,
          { systemPrompt: 'You name terminal sessions concisely. Reply with ONLY a 2-5 word name. No quotes, no explanation.', maxTokens: 20, temperature: 0.3 }
        );

        const name = result.response?.replace(/<think>[\s\S]*?<\/think>/g, '').trim().slice(0, 40);
        if (name && name.length > 1) {
          ptyManager.setSessionName(sessionId, name);
          this.broadcast({ type: 'session-renamed', sessionId, name });
        }
      } catch (e) {
        // Non-critical — session stays unnamed
        console.warn('Auto-naming failed:', e.message);
      }
    });

    ptyManager.on('session-renamed', ({ sessionId, name }) => {
      this.broadcast({ type: 'session-renamed', sessionId, name });
    });

    // Listen for LLM request events from auto-responder
    autoResponder.on('llm-request', async ({ text, sessionId, cliTool, smartEngineResult }) => {
      await this.handleLLMRequest(sessionId, text, cliTool, smartEngineResult);
    });

    autoResponder.on('llm-error', ({ sessionId, error }) => {
      this.broadcastToSession(sessionId, {
        type: 'llm-error',
        sessionId,
        error,
      });
    });

    shellProxy.on('data', (event) => this.handleShellProxyData(event));
    shellProxy.on('exit', (event) => this.handleShellProxyExit(event));

    // Forward orchestrator events to WebSocket clients
    orchestrator.on('status-change', (data) => {
      const sessionId = data.sessionId || orchestrator.getStatus(data.executionId)?.sessionId || '';
      this.broadcastToSession(sessionId, { type: 'orchestrator-status', ...data });
    });
    orchestrator.on('step-complete', (data) => {
      const sessionId = data.sessionId || orchestrator.getStatus(data.executionId)?.sessionId || '';
      this.broadcastToSession(sessionId, { type: 'orchestrator-step-complete', ...data });
    });
    orchestrator.on('waiting-approval', (data) => {
      const sessionId = data.sessionId || orchestrator.getStatus(data.executionId)?.sessionId || '';
      this.broadcastToSession(sessionId, { type: 'orchestrator-waiting-approval', ...data });
    });
    orchestrator.on('completed', (data) => {
      const sessionId = data.sessionId || orchestrator.getStatus(data.executionId)?.sessionId || '';
      this.broadcastToSession(sessionId, { type: 'orchestrator-completed', ...data });
    });

    // Forward activity feed entries to all connected clients
    activityFeed.on('entry', (entry) => {
      this.broadcast({ type: 'activity-entry', entry });
    });

    this._startReliabilityMonitor();

    console.log('Terminal WebSocket server initialized on /ws/terminal');
  }

  _startReliabilityMonitor() {
    if (this.reliabilityMonitor) return;
    this.reliabilityMonitor = setInterval(() => {
      this._runReliabilitySweep().catch(err => {
        console.warn('[TerminalServer] Reliability sweep failed:', err.message);
      });
    }, RELIABILITY_SWEEP_INTERVAL_MS);
    this.reliabilityMonitor.unref?.();
  }

  async _runReliabilitySweep() {
    if (this.reliabilitySweepRunning) return;
    this.reliabilitySweepRunning = true;
    try {
      const { chatStore } = await import('./chatStore.js');
      const { jobManager } = await import('./jobManager.js');
      const { agentOrchestrator } = await import('./agentOrchestrator.js');

      agentOrchestrator.recoverStaleActiveRuns({
        staleMs: ACTIVE_RUN_STALE_MS,
        broadcastFn: (data) => this.broadcastChatData(data),
      });

      const interruptedRuns = agentOrchestrator.reconcileInterruptedRuns((data) => this.broadcastChatData(data));
      for (const run of interruptedRuns) {
        const pending = this._findPendingRecoveredMessage(run.projectId, run.sessionId, chatStore);
        if (pending) {
          this._autoRetryRecoveredSession(null, run.projectId, run.sessionId, pending).catch(err => {
            console.warn('[TerminalServer] Run recovery retry failed:', err.message);
          });
        }
      }

      const staleStreams = chatStore.getStaleStreamingMessages({
        staleMs: STREAM_RECOVERY_STALE_MS,
        maxAgeMs: STREAM_AUTO_RETRY_MAX_AGE_MS,
        limit: 50,
      });
      for (const item of staleStreams) {
        const recovered = await this._recoverOneStreamingMessage({ item, chatStore, jobManager });
        if (recovered?.metadata?.recoveryPending) {
          this._autoRetryRecoveredSession(null, recovered.projectId, recovered.sessionId, recovered).catch(err => {
            console.warn('[TerminalServer] Stream recovery retry failed:', err.message);
          });
        }
      }
    } finally {
      this.reliabilitySweepRunning = false;
    }
  }

  broadcastChatData(data) {
    const sessionId = data?.message?.sessionId || data?.sessionId || data?.chatSessionId;
    if (sessionId) this.broadcastToChatSession(sessionId, data);
    this.broadcast(data);
  }

  /**
   * Handle async LLM request
   */
  async handleLLMRequest(sessionId, text, cliTool, smartEngineResult) {
    // Don't auto-respond when orchestrator owns the session
    if (orchestrator.isSessionActive(sessionId)) return;

    try {
      const result = await autoResponder.processLLMRequest(text, sessionId, cliTool, smartEngineResult);

      if (result) {
        // Notify clients about LLM-generated response
        this.broadcastToSession(sessionId, {
          type: 'prompt-detected',
          sessionId,
          pattern: result.pattern,
          matchedText: result.matchedText,
          action: result.action,
          suggestedResponse: result.suggestedResponse,
          responses: result.responses,
          llmGenerated: true,
          llmProvider: result.llmProvider,
          llmModel: result.llmModel,
          confidence: result.confidence || result.smartEngineConfidence,
          reasoning: result.reasoning,
          // Security info
          requiresConfirmation: result.requiresConfirmation,
          riskLevel: result.riskLevel,
          riskReasons: result.riskReasons,
        });

        // Handle auto-response if enabled
        if (result.action === 'auto' && result.suggestedResponse !== null) {
          const settings = autoResponder.getSettings();
          const delay = settings.responseDelay || 500;

          setTimeout(() => {
            ptyManager.write(sessionId, result.suggestedResponse + '\r');

            this.broadcastToSession(sessionId, {
              type: 'auto-response-sent',
              sessionId,
              response: result.suggestedResponse,
              pattern: result.pattern,
              confidence: result.confidence,
              wasLLM: true,
            });
          }, delay);
        }
      }
    } catch (error) {
      console.warn('LLM request handling failed:', error.message);
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  async handleMessage(ws, msg) {
    const { type, ...payload } = msg;

    switch (type) {
      case 'create-session':
        this.handleCreateSession(ws, payload);
        break;

      case 'attach':
        this.handleAttach(ws, payload);
        break;

      case 'detach':
        this.handleDetach(ws);
        break;

      case 'input':
        this.handleInput(ws, payload);
        break;

      case 'resize':
        this.handleResize(ws, payload);
        break;

      case 'start-cli':
        this.handleStartCLI(ws, payload);
        break;

      case 'kill-session':
        this.handleKillSession(ws, payload);
        break;

      case 'clear-scrollback': {
        const targetSession = payload.sessionId || this.clients.get(ws)?.sessionId;
        if (targetSession) {
          const session = ptyManager.sessions?.get(targetSession);
          if (session) session.scrollback = '';
        }
        break;
      }

      case 'list-sessions':
        this.handleListSessions(ws);
        break;

      case 'get-session':
        this.handleGetSession(ws, payload);
        break;

      case 'get-project-sessions':
        this.handleGetProjectSessions(ws, payload);
        break;

      case 'get-history':
        this.handleGetHistory(ws, payload);
        break;

      case 'add-history':
        this.handleAddHistory(ws, payload);
        break;

      case 'set-auto-responder':
        this.handleSetAutoResponder(ws, payload);
        break;

      case 'send-response':
        this.handleSendResponse(ws, payload);
        break;

      case 'get-auto-responder-settings':
        this.handleGetAutoResponderSettings(ws, payload);
        break;

      case 'orchestrator-start':
        this.handleOrchestratorStart(ws, payload);
        break;
      case 'orchestrator-pause':
        this.handleOrchestratorPause(ws, payload);
        break;
      case 'orchestrator-resume':
        this.handleOrchestratorResume(ws, payload);
        break;
      case 'orchestrator-stop':
        this.handleOrchestratorStop(ws, payload);
        break;
      case 'orchestrator-approve':
        this.handleOrchestratorApprove(ws, payload);
        break;
      case 'orchestrator-skip':
        this.handleOrchestratorSkip(ws, payload);
        break;
      case 'rename-session':
        this.handleRenameSession(ws, payload);
        break;

      case 'ping':
        this.send(ws, { type: 'pong' });
        break;

      case 'kill-switch':
        this.handleKillSwitch(ws, payload);
        break;

      // ── Per-session WebSocket management ──

      case 'attach-chat-session': {
        // Attach this WebSocket to a specific chat session for isolated communication
        const { chatSessionId, projectId } = payload;
        console.log(`[terminalServer] ▶ attach-chat-session received: project=${projectId}, session=${chatSessionId}`);
        if (chatSessionId) {
          await this._inspectChatSession(ws, { projectId, chatSessionId, acknowledgeAttach: true, reason: 'attach' });
        }
        break;
      }

      case 'chat-session-health': {
        const { chatSessionId, projectId, reason, recover } = payload;
        if (chatSessionId && projectId) {
          await this._inspectChatSession(ws, { projectId, chatSessionId, acknowledgeAttach: false, reason: reason || 'health', recover: recover === true });
        }
        break;
      }

      case 'chat-session-reconcile': {
        await this._reconcileChatSession(ws, payload);
        break;
      }

      case 'recover-streaming-message': {
        // Recover a streaming message that was interrupted
        const { chatStore } = await import('./chatStore.js');
        const { projectId, sessionId, messageId } = payload;

        const recovered = chatStore.recoverStreamingMessage({ projectId, sessionId, messageId });
        if (recovered) {
          this.broadcastToChatSession(sessionId, {
            type: 'chat-message-recovered',
            projectId,
            sessionId,
            message: recovered,
          });
        } else {
          // Don't show error - the auto-resume will handle this
          console.log(`[terminalServer] Message ${messageId} recovery deferred to auto-resume`);
        }
        break;
      }

      case 'chat-send': {
        const { chatStore } = await import('./chatStore.js');
        const { agentGateway } = await import('./agentGateway.js');
        const { agentOrchestrator } = await import('./agentOrchestrator.js');
        const { classifySteerUrgency, addSteer } = await import('./steeringInbox.js');

        if (!payload.projectId) {
          this.sendError(ws, 'projectId is required');
          break;
        }

        // Ensure session exists
        chatStore.migrateIfNeeded(payload.projectId);
        const chatSessionId = payload.sessionId || chatStore.getActiveSession(payload.projectId).id;
        const sessionMeta = chatStore.getSession(payload.projectId, chatSessionId);
        // The current chat payload reflects the visible assistant selector; use it
        // to avoid stale persisted metadata sending a run to the wrong CLI tool.
        const assistantSettings = mergeSessionAssistantSettings(sessionMeta || {}, payload, {
          tool: payload.tool || 'claude',
          model: payload.model,
          effort: payload.effort,
        });
        const activeRolePromptIds = normalizeRolePromptIds(payload.activeRolePromptIds);
        const rolePromptInstructions = sanitizeRolePromptInstructions(payload.rolePromptInstructions);
        chatStore.updateSessionMeta(payload.projectId, chatSessionId, { ...assistantSettings, mode: payload.mode || sessionMeta?.mode || 'agent', activeRolePromptIds });

        // Attach client to this chat session for isolated communication
        this.attachToChatSession(ws, chatSessionId);

        // Build display content with attachment info
        let displayContent = payload.content || '';
        const attachments = payload.attachments || [];
        let agentContent = appendRolePromptInstructions(payload.content, rolePromptInstructions);
        if (sessionMeta?.isMainThread) {
          agentContent = [
            'You are the project main thread inside the IDE. Treat this chat as the durable project knowledge base and coordinator.',
            'When the user asks what happened before, inspect/search prior chat sessions and summarize with specific session names or dates when available.',
            'When work in child sessions appears complete, proactively summarize what needs review in a friendly, concise way.',
            'Suggest updates to project rules, descriptions, or workflow only as proposals and always wait for explicit approval before changing them.',
            'If the user asks for implementation work, either answer directly or help launch/focus a child session; keep the main thread useful as the home base.',
            '',
            agentContent,
          ].join('\n');
        }
        if (attachments.length > 0) {
          const attachmentList = attachments.map(a => `📎 ${a.name}`).join('\n');
          displayContent = displayContent ? `${displayContent}\n\n${attachmentList}` : attachmentList;
        }

        // Persist user message
        const clientMessageId = typeof payload.clientMessageId === 'string'
          ? payload.clientMessageId.trim().slice(0, 160)
          : null;
        const existingUserMsg = clientMessageId
          ? chatStore.getMessages(payload.projectId, { sessionId: chatSessionId, limit: 20 })
            .find(message => message.role === 'user' && message.metadata?.clientMessageId === clientMessageId)
          : null;
        const userMsg = existingUserMsg || chatStore.addMessage({
          projectId: payload.projectId,
          sessionId: chatSessionId,
          role: 'user',
          content: displayContent,
          metadata: { mode: payload.mode, attachments, activeRolePromptIds, rolePromptInstructionsApplied: !!rolePromptInstructions, clientMessageId, ...assistantSettings },
        });

        // Broadcast to all clients attached to this chat session
        this.broadcastToChatSession(chatSessionId, { type: 'chat-message', message: userMsg });

        // Also broadcast globally for any listeners (backward compatibility)
        this.broadcast({ type: 'chat-message', message: userMsg });

        if (existingUserMsg) {
          console.log(`[terminalServer] Suppressed duplicate chat-send for clientMessageId=${clientMessageId}`);
          break;
        }

        const sharedBroadcast = (data) => {
          // Broadcast to chat session clients first (isolated)
          this.broadcastToChatSession(chatSessionId, data);
          // Also broadcast globally (backward compatibility)
          this.broadcast(data);
        };

        // Auto-name session on first message (before routing fork so both
        // gateway and orchestrator paths trigger naming).
        agentGateway.autoNameSession(payload.projectId, chatSessionId, payload.content);

        // ── Steering: if a run/turn is already in flight for this session, fold
        // this message into it instead of spawning a duplicate run. Smart triage:
        // a clear correction ("stop", "actually no…") interrupts and redirects;
        // anything else is queued and folded in at the next safe boundary. ──
        const sessionBusy = agentOrchestrator.hasActiveSession(payload.projectId, chatSessionId)
          || agentGateway.isBusy(chatSessionId);
        if (sessionBusy) {
          const urgent = classifySteerUrgency(payload.content) === 'urgent';
          const steerNote = (text) => sharedBroadcast({
            type: 'chat-progress',
            projectId: payload.projectId,
            message: {
              id: `steer-${Date.now()}`,
              sessionId: chatSessionId,
              role: 'progress',
              content: text,
              createdAt: new Date().toISOString(),
              metadata: { transient: true },
            },
          });
          if (urgent) {
            // Interrupt the current turn; this message becomes a fresh turn that
            // also drains any previously-queued steers.
            steerNote('↪️ Redirecting the agent to your new message…');
            agentGateway.abort(chatSessionId);
            agentOrchestrator.abortSession(chatSessionId);
            // fall through to route a fresh run/turn below
          } else {
            // Queue and let the active run fold it in at its next boundary.
            addSteer(chatSessionId, agentContent, { urgent: false });
            steerNote('📨 Queued — the agent will fold this into the current run at its next step.');
            break;
          }
        }

        const shouldOrchestrate = agentOrchestrator.shouldOrchestrate({ mode: payload.mode, content: payload.content });
        const runner = shouldOrchestrate ? agentOrchestrator.startRun.bind(agentOrchestrator) : agentGateway.handleTask.bind(agentGateway);

        runner({
          projectId: payload.projectId,
          sessionId: chatSessionId,
          content: agentContent,
          attachments,
          mode: payload.mode,
          tool: assistantSettings.tool,
          model: assistantSettings.model,
          effort: assistantSettings.effort,
          broadcastFn: sharedBroadcast,
        }).catch(err => {
          const errMsg = chatStore.addMessage({
            projectId: payload.projectId,
            sessionId: chatSessionId,
            role: 'error',
            content: `Gateway error: ${err.message}`,
          });
          this.broadcastToChatSession(chatSessionId, { type: 'chat-message', message: errMsg });
          this.broadcast({ type: 'chat-message', message: errMsg });
        });
        break;
      }

      case 'chat-shell-send': {
        const { chatStore } = await import('./chatStore.js');

        if (!payload.projectId) {
          this.sendError(ws, 'projectId is required');
          break;
        }

        chatStore.migrateIfNeeded(payload.projectId);
        const chatSessionId = payload.sessionId || chatStore.getActiveSession(payload.projectId).id;
        const content = (payload.content || '').trim();
        if (!content) {
          this.sendError(ws, 'Shell input is required');
          break;
        }

        this.attachToChatSession(ws, chatSessionId);

        const userMsg = chatStore.addMessage({
          projectId: payload.projectId,
          sessionId: chatSessionId,
          role: 'user',
          content,
          metadata: { mode: 'shell', channel: 'shell' },
        });

        this.broadcastToChatSession(chatSessionId, { type: 'chat-message', message: userMsg });
        this.broadcast({ type: 'chat-message', message: userMsg });

        try {
          this.openShellStream(payload.projectId, chatSessionId, content);
          shellProxy.send({ projectId: payload.projectId, chatSessionId, input: content });
        } catch (err) {
          this.completeShellStream(this.shellKey(payload.projectId, chatSessionId), {
            error: `Shell proxy error: ${err.message}`,
          });
        }
        break;
      }

      case 'chat-retry': {
        const { chatStore } = await import('./chatStore.js');
        const { agentGateway } = await import('./agentGateway.js');
        const { agentOrchestrator } = await import('./agentOrchestrator.js');

        if (!payload.projectId) {
          this.sendError(ws, 'projectId is required');
          break;
        }

        chatStore.migrateIfNeeded(payload.projectId);
        const chatSessionId = payload.sessionId || chatStore.getActiveSession(payload.projectId).id;
        const sessionMeta = chatStore.getSession(payload.projectId, chatSessionId);
        // The retry payload reflects the visible assistant selector.
        const assistantSettings = mergeSessionAssistantSettings(sessionMeta || {}, payload, {
          tool: payload.tool || 'claude',
          model: payload.model,
          effort: payload.effort,
        });
        const activeRolePromptIds = normalizeRolePromptIds(payload.activeRolePromptIds);
        const rolePromptInstructions = sanitizeRolePromptInstructions(payload.rolePromptInstructions);
        chatStore.updateSessionMeta(payload.projectId, chatSessionId, { ...assistantSettings, activeRolePromptIds });
        this.attachToChatSession(ws, chatSessionId);

        const retryContent = (payload.content || '').trim();
        if (!retryContent) {
          this.sendError(ws, 'Retry content is required');
          break;
        }
        const agentRetryContent = appendRolePromptInstructions(retryContent, rolePromptInstructions);

        // Optional marker message to show user-initiated regeneration
        const retryMsg = chatStore.addMessage({
          projectId: payload.projectId,
          sessionId: chatSessionId,
          role: 'system',
          content: payload.executeReviewedPlan
            ? '✅ Plan approved. Executing with latest instructions...'
            : '🔁 Re-evaluating response with latest instructions...',
          metadata: { retry: true, executeReviewedPlan: !!payload.executeReviewedPlan, activeRolePromptIds, rolePromptInstructionsApplied: !!rolePromptInstructions },
        });
        this.broadcastToChatSession(chatSessionId, { type: 'chat-message', message: retryMsg });
        this.broadcast({ type: 'chat-message', message: retryMsg });

        const sharedBroadcast = (data) => {
          this.broadcastToChatSession(chatSessionId, data);
          this.broadcast(data);
        };
        const shouldOrchestrate = agentOrchestrator.shouldOrchestrate({
          mode: payload.mode,
          content: retryContent,
          executeReviewedPlan: !!payload.executeReviewedPlan,
        });
        const runner = shouldOrchestrate ? agentOrchestrator.startRun.bind(agentOrchestrator) : agentGateway.handleTask.bind(agentGateway);

        runner({
          projectId: payload.projectId,
          sessionId: chatSessionId,
          content: agentRetryContent,
          attachments: [],
          mode: payload.mode,
          tool: assistantSettings.tool,
          model: assistantSettings.model,
          effort: assistantSettings.effort,
          executeReviewedPlan: !!payload.executeReviewedPlan,
          broadcastFn: sharedBroadcast,
        }).catch(err => {
          const errMsg = chatStore.addMessage({
            projectId: payload.projectId,
            sessionId: chatSessionId,
            role: 'error',
            content: `Retry failed: ${err.message}`,
          });
          this.broadcastToChatSession(chatSessionId, { type: 'chat-message', message: errMsg });
          this.broadcast({ type: 'chat-message', message: errMsg });
        });
        break;
      }

      case 'chat-approve-plan': {
        const { agentGateway } = await import('./agentGateway.js');
        agentGateway.executePlan({
          projectId: payload.projectId,
          steps: payload.steps,
          broadcastFn: (data) => this.broadcast(data),
        }).catch(err => {
          console.error('Plan execution error:', err);
          this.broadcast({
            type: 'chat-message',
            message: { id: Date.now().toString(), projectId: payload.projectId, role: 'error', content: `Plan failed: ${err.message}`, createdAt: new Date().toISOString() },
          });
        });
        break;
      }

      case 'chat-stop': {
        const { agentGateway } = await import('./agentGateway.js');
        const { agentOrchestrator } = await import('./agentOrchestrator.js');
        const { chatStore: stopChatStore } = await import('./chatStore.js');
        const stopSessionId = payload.sessionId || payload.projectId;
        // Check running state before abort (abort flips the flag)
        const wasRunning = agentGateway.isRunning(stopSessionId);
        // Abort by session ID (supports parallel sessions)
        const orchestratorAborted = agentOrchestrator.abortSession(stopSessionId);
        agentGateway.abort(stopSessionId);
        // Persist a visible "Stopped" message so the user sees feedback in chat history
        if (wasRunning || orchestratorAborted > 0) {
          const stoppedMsg = stopChatStore.addMessage({
            projectId: payload.projectId,
            sessionId: payload.sessionId,
            role: 'error',
            content: 'Stopped by user.',
          });
          this.broadcastToChatSession(payload.sessionId, { type: 'chat-message', message: stoppedMsg });
        }
        this.broadcastToChatSession(payload.sessionId, { type: 'agent-status', projectId: payload.projectId, sessionId: payload.sessionId, busy: false });
        this.broadcast({ type: 'agent-status', projectId: payload.projectId, sessionId: payload.sessionId, busy: false });
        break;
      }

      // ── Log sharing: inject terminal output or container logs into chat ──
      case 'chat-share-terminal': {
        // Option A: User shares their InternalConsole output as context
        const { chatStore } = await import('./chatStore.js');
        const { agentGateway } = await import('./agentGateway.js');

        const chatSessionId = payload.sessionId;
        const terminalContent = (payload.content || '').trim();
        if (!terminalContent || !payload.projectId || !chatSessionId) {
          this.sendError(ws, 'Missing terminal content or session info');
          break;
        }

        const sessionMeta = chatStore.getSession(payload.projectId, chatSessionId);
        const assistantSettings = mergeSessionAssistantSettings(sessionMeta || {}, payload, {
          tool: payload.tool || 'claude',
          model: payload.model,
          effort: payload.effort,
        });
        const activeRolePromptIds = normalizeRolePromptIds(payload.activeRolePromptIds);
        const rolePromptInstructions = sanitizeRolePromptInstructions(payload.rolePromptInstructions);
        chatStore.updateSessionMeta(payload.projectId, chatSessionId, { ...assistantSettings, activeRolePromptIds });

        this.attachToChatSession(ws, chatSessionId);

        const contextMsg = chatStore.addMessage({
          projectId: payload.projectId,
          sessionId: chatSessionId,
          role: 'user',
          content: `Here is the recent terminal output for context:\n\n\`\`\`\n${terminalContent}\n\`\`\`\n\n${payload.instruction || 'Please analyze this output and continue.'}`,
          metadata: { mode: 'agent', source: 'terminal-share', activeRolePromptIds, rolePromptInstructionsApplied: !!rolePromptInstructions, ...assistantSettings },
        });

        this.broadcastToChatSession(chatSessionId, { type: 'chat-message', message: contextMsg });
        this.broadcast({ type: 'chat-message', message: contextMsg });

        agentGateway.handleTask({
          projectId: payload.projectId,
          sessionId: chatSessionId,
          content: appendRolePromptInstructions(contextMsg.content, rolePromptInstructions),
          attachments: [],
          mode: 'agent',
          tool: assistantSettings.tool,
          model: assistantSettings.model,
          effort: assistantSettings.effort,
          broadcastFn: (data) => {
            this.broadcastToChatSession(chatSessionId, data);
            this.broadcast(data);
          },
        }).catch(err => {
          const errMsg = chatStore.addMessage({
            projectId: payload.projectId,
            sessionId: chatSessionId,
            role: 'error',
            content: `Failed to process terminal output: ${err.message}`,
          });
          this.broadcastToChatSession(chatSessionId, { type: 'chat-message', message: errMsg });
          this.broadcast({ type: 'chat-message', message: errMsg });
        });
        break;
      }

      case 'chat-capture-logs': {
        // Option B/C: Capture logs from inside the container and inject into chat
        const { chatStore } = await import('./chatStore.js');
        const { agentGateway } = await import('./agentGateway.js');
        const { containerManager } = await import('./containerManager.js');

        const chatSessionId = payload.sessionId;
        if (!payload.projectId || !chatSessionId) {
          this.sendError(ws, 'Missing project or session info');
          break;
        }

        const project = Project.findById(payload.projectId);
        if (!project?.containerName) {
          this.sendError(ws, 'No container found for this project');
          break;
        }

        const filePath = payload.filePath || '';
        const lines = Math.min(payload.lines || 200, 1000);
        let logOutput;

        try {
          if (filePath) {
            // Capture specific log file
            logOutput = containerManager.execInContainer(
              project.containerName,
              `tail -n ${lines} ${filePath.replace(/"/g, '\\"')}`,
              { timeout: 10000 },
            );
          } else {
            // Capture recent shell output from the utility terminal scrollback
            const utilSessions = Array.from(ptyManager.sessions?.entries?.() || [])
              .filter(([, s]) => s.projectId === payload.projectId && s.role === 'utility');
            const utilSession = utilSessions[utilSessions.length - 1];
            if (utilSession) {
              const scrollback = ptyManager.getScrollback?.(utilSession[0]);
              logOutput = scrollback
                ? stripAnsi(scrollback).split('\n').slice(-lines).join('\n')
                : null;
            }
            if (!logOutput) {
              logOutput = '(No recent terminal output available)';
            }
          }
        } catch (err) {
          logOutput = `Error capturing logs: ${err.message}`;
        }

        const sessionMeta = chatStore.getSession(payload.projectId, chatSessionId);
        const assistantSettings = mergeSessionAssistantSettings(sessionMeta || {}, payload, {
          tool: payload.tool || 'claude',
          model: payload.model,
          effort: payload.effort,
        });
        const activeRolePromptIds = normalizeRolePromptIds(payload.activeRolePromptIds);
        const rolePromptInstructions = sanitizeRolePromptInstructions(payload.rolePromptInstructions);
        chatStore.updateSessionMeta(payload.projectId, chatSessionId, { ...assistantSettings, activeRolePromptIds });

        this.attachToChatSession(ws, chatSessionId);

        const label = filePath ? `logs from \`${filePath}\`` : 'recent terminal output';
        const instruction = payload.instruction || 'Please analyze these logs and continue.';
        const logMsg = chatStore.addMessage({
          projectId: payload.projectId,
          sessionId: chatSessionId,
          role: 'user',
          content: `Here are the ${label} (last ${lines} lines):\n\n\`\`\`\n${logOutput}\n\`\`\`\n\n${instruction}`,
          metadata: { mode: 'agent', source: 'log-capture', filePath, activeRolePromptIds, rolePromptInstructionsApplied: !!rolePromptInstructions, ...assistantSettings },
        });

        this.broadcastToChatSession(chatSessionId, { type: 'chat-message', message: logMsg });
        this.broadcast({ type: 'chat-message', message: logMsg });

        agentGateway.handleTask({
          projectId: payload.projectId,
          sessionId: chatSessionId,
          content: appendRolePromptInstructions(logMsg.content, rolePromptInstructions),
          attachments: [],
          mode: 'agent',
          tool: assistantSettings.tool,
          model: assistantSettings.model,
          effort: assistantSettings.effort,
          skipUnread: true,
          broadcastFn: (data) => {
            this.broadcastToChatSession(chatSessionId, data);
            this.broadcast(data);
          },
        }).catch(err => {
          const errMsg = chatStore.addMessage({
            projectId: payload.projectId,
            sessionId: chatSessionId,
            role: 'error',
            content: `Failed to process logs: ${err.message}`,
          });
          this.broadcastToChatSession(chatSessionId, { type: 'chat-message', message: errMsg });
          this.broadcast({ type: 'chat-message', message: errMsg });
        });
        break;
      }

      default:
        this.sendError(ws, `Unknown message type: ${type}`);
    }
  }

  shellKey(projectId, chatSessionId) {
    return `${projectId}:${chatSessionId}`;
  }

  limitShellOutput(output) {
    const text = String(output || '').trimEnd();
    const max = 20000;
    if (text.length <= max) return text;
    return `[output truncated to last ${max} chars]\n` + text.slice(-max);
  }

  stripShellControls(text) {
    return stripAnsi(String(text || '')
      .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
      .replace(/\x1B[P^_][\s\S]*?\x1B\\/g, ''))
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x1B[()][A-Za-z0-9]/g, '')
      .replace(/\x1B[78=><]/g, '')
      .replace(/\x1B./g, '')
      .replace(/␛\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/␛[78=><]?/g, '');
  }

  detectShellPrompt(text) {
    const clean = this.stripShellControls(text).trimEnd();
    const lines = clean.split('\n').map(line => line.trim()).filter(Boolean);
    const lastLine = lines[lines.length - 1] || '';

    if (/Use arrows to move/i.test(clean)) {
      const questionLine = [...lines].reverse().find(line => /\?/.test(line)) || lastLine;
      const selectedLine = [...lines].reverse().find(line => line.startsWith('>'));
      const promptText = selectedLine ? `${questionLine}\n${selectedLine}` : questionLine;
      return { type: 'menu', text: promptText.slice(-240), responses: ['enter', 'down', 'up', 'ctrl-c'] };
    }

    if (/(?:\(|\[)[Yy]\/[Nn](?:\)|\])\s*$/.test(lastLine)) {
      return { type: 'yes-no', text: lastLine.slice(-240), responses: ['y', 'n', 'enter', 'ctrl-c'] };
    }

    if (/https?:\/\/[^\s]+/i.test(lastLine)) {
      return { type: 'url', text: lastLine.slice(-240), responses: ['enter', 'ctrl-c'] };
    }

    return null;
  }

  openShellStream(projectId, chatSessionId, command = '') {
    const key = this.shellKey(projectId, chatSessionId);
    const existing = this.shellStreams.get(key);
    if (existing) this.completeShellStream(key, { fallback: existing.output || '_Previous shell output ended._' });

    const messageId = `shell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stream = {
      key,
      projectId,
      chatSessionId,
      command,
      messageId,
      output: '',
      tail: '',
      timer: null,
      noOutputTimer: null,
      prompt: null,
    };
    this.shellStreams.set(key, stream);

    this.broadcastToChatSession(chatSessionId, {
      type: 'chat-message-stream-start',
      projectId,
      sessionId: chatSessionId,
      messageId,
      jobId: messageId,
      content: 'Running shell command...',
      shell: true,
    });

    stream.noOutputTimer = setTimeout(() => {
      this.completeShellStream(key, { fallback: '_Command sent. Waiting for output or the next prompt._' });
    }, 1800);

    return stream;
  }

  handleShellProxyData({ projectId, chatSessionId, data, atPrompt, tail }) {
    const key = this.shellKey(projectId, chatSessionId);
    let stream = this.shellStreams.get(key);
    if (!stream) stream = this.openShellStream(projectId, chatSessionId, '');

    if (stream.noOutputTimer) {
      clearTimeout(stream.noOutputTimer);
      stream.noOutputTimer = null;
    }
    if (stream.timer) clearTimeout(stream.timer);

    stream.output += data;
    stream.tail = tail || stream.tail;
    stream.prompt = this.detectShellPrompt(stream.output) || this.detectShellPrompt(stream.tail) || stream.prompt;

    this.broadcastToChatSession(chatSessionId, {
      type: 'chat-message-chunk',
      projectId,
      sessionId: chatSessionId,
      messageId: stream.messageId,
      chunk: data,
      shell: true,
    });

    stream.timer = setTimeout(() => {
      this.completeShellStream(key);
    }, atPrompt ? 250 : 1800);
  }

  handleShellProxyExit({ projectId, chatSessionId, exitCode, signal }) {
    const key = this.shellKey(projectId, chatSessionId);
    this.completeShellStream(key, {
      fallback: `Shell session exited (${signal || (exitCode ?? 'unknown')}).`,
    });
  }

  async completeShellStream(key, { error = null, fallback = null } = {}) {
    const stream = this.shellStreams.get(key);
    if (!stream) return;
    this.shellStreams.delete(key);

    if (stream.timer) clearTimeout(stream.timer);
    if (stream.noOutputTimer) clearTimeout(stream.noOutputTimer);

    const { chatStore } = await import('./chatStore.js');
    const rawOutput = error || this.limitShellOutput(stream.output || fallback || '_No output._');
    const content = error
      ? rawOutput
      : rawOutput.startsWith('_')
        ? rawOutput
        : `\`\`\`shell\n${rawOutput}\n\`\`\``;

    const message = chatStore.addMessage({
      projectId: stream.projectId,
      sessionId: stream.chatSessionId,
      role: error ? 'error' : 'agent',
      content,
      metadata: {
        mode: 'shell',
        channel: 'shell',
        shell: {
          command: stream.command || null,
          prompt: stream.prompt,
        },
      },
    });

    this.broadcastToChatSession(stream.chatSessionId, {
      type: 'chat-message-stream-complete',
      projectId: stream.projectId,
      sessionId: stream.chatSessionId,
      messageId: stream.messageId,
      message,
      shell: true,
    });
    this.broadcast({
      type: 'chat-message-stream-complete',
      projectId: stream.projectId,
      sessionId: stream.chatSessionId,
      messageId: stream.messageId,
      message,
      shell: true,
    });
  }

  /**
   * Create a new PTY session
   */
  async handleCreateSession(ws, { projectId, cliTool, cols, rows, cwd, role, forceNew = false }) {
    try {
      // If projectId provided, use project's folder path as cwd
      let workingDir = cwd;
      let containerName = null;

      if (projectId && !cwd) {
        const project = Project.findById(projectId);
        if (project?.containerName) {
          // Container-based project
          containerName = project.containerName;

          // Ensure container is running before creating a session
          const { containerManager } = await import('./containerManager.js');
          const status = containerManager.getContainerStatus(containerName);
          if (!status) {
            throw new Error(`Container '${containerName}' does not exist. Please recreate the project.`);
          }
          if (status !== 'running') {
            const started = containerManager.startContainer(containerName);
            if (!started) {
              throw new Error(`Failed to start container '${containerName}' (status: ${status})`);
            }
          }

          workingDir = containerManager.getWorkDir(containerName) || '/workspace';
        } else if (project?.folderPath) {
          workingDir = project.folderPath;
        }
      }

      const session = ptyManager.createSession({
        projectId,
        cliTool,
        containerName,
        role: role || 'main',
        forceNew,
        cols: cols || 120,
        rows: rows || 30,
        cwd: workingDir,
      });

      // Initialize history for this session
      await History.createHistory(session.sessionId, projectId);

      // Initialize output buffer for conversation parsing
      const buffer = new OutputBuffer(cliTool || 'generic');
      buffer.setOnEntries(async (entries) => {
        // Store parsed conversation entries in history
        for (const entry of entries) {
          await History.addHistoryEntry(session.sessionId, {
            role: entry.role,
            content: entry.content,
            projectId,
          });
        }
      });
      this.outputBuffers.set(session.sessionId, buffer);

      // Initialize user input buffer
      this.userInputBuffers.set(session.sessionId, '');

      // Track CLI tool for auto-responder
      this.sessionCliTools.set(session.sessionId, cliTool || 'shell');
      this.recentOutput.set(session.sessionId, '');

      // Set project path for smart engine context
      if (workingDir) {
        autoResponder.setSessionProjectPath(session.sessionId, workingDir);
      }

      // Initialize session context with full project info
      await sessionContext.initSession(session.sessionId, {
        projectId,
        projectPath: workingDir,
        cliTool: cliTool || 'shell',
      });

      // Auto-attach the creating client
      this.attachClient(ws, session.sessionId);

      // Replay saved scrollback from a previous session (if any)
      // This preserves terminal history across PM2 restarts
      try {
        const { sessionHistory } = await import('./sessionHistory.js');
        const fs = await import('fs');
        const path = await import('path');
        const { fileURLToPath } = await import('url');
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const liveDir = path.join(__dirname, '../../data/session-live');

        // Look for live files from previous sessions for this project + role.
        // Fresh utility sessions intentionally skip replay to avoid restoring stuck output.
        let replayText = null;

        if (!forceNew && fs.existsSync(liveDir)) {
          const files = fs.readdirSync(liveDir).filter(f => f.endsWith('.txt'));
          // Find the LARGEST matching file (most content = most useful session)
          let bestFile = null;
          let bestSize = 0;
          const matchingFiles = [];

          for (const file of files) {
            try {
              const filePath = path.join(liveDir, file);
              const content = fs.readFileSync(filePath, 'utf-8');
              const matchProject = content.includes(`Project: ${projectId}`);
              const matchRole = content.includes(`Role: ${role || 'main'}`);
              if (matchProject && matchRole) {
                matchingFiles.push(filePath);
                if (content.length > bestSize) {
                  bestSize = content.length;
                  bestFile = { filePath, content };
                }
              }
            } catch {}
          }

          if (bestFile && bestSize > 300) { // Skip tiny files (just a prompt)
            const headerEnd = bestFile.content.indexOf('─'.repeat(10));
            replayText = headerEnd >= 0 ? bestFile.content.slice(headerEnd).replace(/^─+\n/, '') : bestFile.content;
          }

          // Clean up ALL matching live files
          for (const fp of matchingFiles) {
            try { fs.unlinkSync(fp); } catch {}
          }
        }

        // If no live file, check session history for the most recent.
        // Forced new sessions should start clean.
        if (!forceNew && !replayText) {
          const history = sessionHistory.getHistory(projectId, 5);
          const match = history.find(h => (h.role || 'main') === (role || 'main'));
          if (match) {
            const entry = sessionHistory.getScrollback(match.id);
            if (entry?.scrollback && entry.scrollback.length > 50) {
              replayText = entry.scrollback;
            }
          }
        }

        // Send saved output as a replay before the session-created message
        if (replayText) {
          this.send(ws, {
            type: 'output',
            sessionId: session.sessionId,
            data: `\x1b[90m── Previous session output ──\x1b[0m\r\n${replayText}\r\n\x1b[90m── Session resumed ──\x1b[0m\r\n`,
          });
        }
      } catch {}

      this.send(ws, {
        type: 'session-created',
        ...session,
      });

      // If a CLI tool was specified, start it
      if (cliTool && cliTool !== 'shell') {
        // Update history metadata with CLI tool
        await History.updateHistoryMetadata(session.sessionId, { cliTool });

        setTimeout(() => {
          ptyManager.startCLI(session.sessionId, cliTool);
        }, 100);
      }
    } catch (error) {
      this.sendError(ws, `Failed to create session: ${error.message}`);
    }
  }

  /**
   * Attach client to an existing session
   */
  handleAttach(ws, { sessionId }) {
    const session = ptyManager.getSession(sessionId);
    if (!session) {
      this.sendError(ws, `Session ${sessionId} not found`);
      return;
    }

    this.attachClient(ws, sessionId);

    // Send scrollback buffer so the client sees recent output history
    const scrollback = ptyManager.getScrollback(sessionId);
    if (scrollback) {
      this.rememberInteractivePrompt(sessionId, scrollback);
      this.send(ws, {
        type: 'output',
        sessionId,
        data: scrollback,
      });
    }

    this.send(ws, {
      type: 'attached',
      session,
    });
  }

  /**
   * Detach client from current session
   */
  handleDetach(ws) {
    const clientInfo = this.clients.get(ws);
    if (clientInfo?.sessionId) {
      this.detachClient(ws);
      this.send(ws, { type: 'detached' });
    }
  }

  /**
   * Handle terminal input
   */
  async handleInput(ws, { data, sessionId }) {
    const clientInfo = this.clients.get(ws);
    const targetSession = sessionId || clientInfo?.sessionId;

    if (!targetSession) {
      this.sendError(ws, 'Not attached to any session');
      return;
    }

    const inputData = data;

    // Write to PTY - returns false if session is terminated (don't error)
    const written = ptyManager.write(targetSession, inputData);
    if (!written) {
      // Session is gone, silently ignore input
      return;
    }

    // Track user input for history
    const inputBuffer = this.userInputBuffers.get(targetSession) || '';
    if (inputData.includes('\r') || inputData.includes('\n')) {
      this.lastInteractivePrompt.delete(targetSession);
    }

    // If Enter was pressed (newline), save the accumulated input as user message
    if (inputData.includes('\r') || inputData.includes('\n')) {
      const userMessage = (inputBuffer + inputData).replace(/[\r\n]+$/, '').trim();
      if (userMessage.length > 0) {
        // Store user input in history
        await History.addHistoryEntry(targetSession, {
          role: 'user',
          content: userMessage,
        });
      }
      this.userInputBuffers.set(targetSession, '');
    } else {
      // Accumulate input
      this.userInputBuffers.set(targetSession, inputBuffer + inputData);
    }
  }

  normalizeInputForInteractivePrompt(sessionId, data, promptText = '') {
    if (data !== 'Y' && data !== 'y' && data !== 'N' && data !== 'n') {
      return data;
    }

    const tail = [
      this.recentOutput.get(sessionId),
      promptText,
      this.lastInteractivePrompt.get(sessionId),
    ].filter(Boolean).join('\n').slice(-800);
    const cleanTail = stripAnsi(tail).replace(/\x1b[78]/g, '').trimEnd();
    const defaultYesPrompt = /(?:\(|\[)Y\/n(?:\)|\])\s*$/i.test(cleanTail);

    if (!defaultYesPrompt) return data;

    this.lastInteractivePrompt.delete(sessionId);
    return data;
  }

  rememberInteractivePrompt(sessionId, text) {
    const promptTail = stripAnsi(text || '').slice(-500).replace(/\x1b[78]/g, '').trimEnd();
    if (/(?:\(|\[)Y\/n(?:\)|\])\s*$/i.test(promptTail)) {
      this.lastInteractivePrompt.set(sessionId, promptTail);
    }
  }

  /**
   * Handle terminal resize
   */
  handleResize(ws, { cols, rows, sessionId }) {
    const clientInfo = this.clients.get(ws);
    const targetSession = sessionId || clientInfo?.sessionId;

    if (!targetSession) {
      return;
    }

    ptyManager.resize(targetSession, cols, rows);
  }

  /**
   * Start a CLI tool in the session
   */
  handleStartCLI(ws, { sessionId, cliTool }) {
    const clientInfo = this.clients.get(ws);
    const targetSession = sessionId || clientInfo?.sessionId;

    if (!targetSession) {
      this.sendError(ws, 'Not attached to any session');
      return;
    }

    try {
      ptyManager.startCLI(targetSession, cliTool);
      // Update CLI tool tracker for auto-responder
      this.sessionCliTools.set(targetSession, cliTool);
      this.send(ws, { type: 'cli-started', cliTool, sessionId: targetSession });
    } catch (error) {
      this.sendError(ws, error.message);
    }
  }

  /**
   * Kill a session
   */
  handleKillSession(ws, { sessionId }) {
    const success = ptyManager.killSession(sessionId);

    if (success) {
      // Flush any remaining output buffer before cleanup
      const buffer = this.outputBuffers.get(sessionId);
      if (buffer) {
        buffer.flush();
      }

      // Clean up all session data
      this.cleanupSession(sessionId);

      this.send(ws, { type: 'session-killed', sessionId });

      // Notify all clients attached to this session
      this.broadcastToSession(sessionId, {
        type: 'session-terminated',
        sessionId,
      });
    } else {
      this.sendError(ws, `Failed to kill session ${sessionId}`);
    }
  }

  /**
   * List all sessions
   */
  handleListSessions(ws) {
    const sessions = ptyManager.getAllSessions();
    this.send(ws, { type: 'sessions-list', sessions });
  }

  /**
   * Get specific session info
   */
  handleGetSession(ws, { sessionId }) {
    const session = ptyManager.getSession(sessionId);
    if (session) {
      this.send(ws, { type: 'session-info', session });
    } else {
      this.sendError(ws, `Session ${sessionId} not found`);
    }
  }

  /**
   * Get history for a session
   */
  handleGetHistory(ws, { sessionId }) {
    const history = History.getHistoryBySession(sessionId);
    if (history) {
      this.send(ws, { type: 'history', history });
    } else {
      this.send(ws, { type: 'history', history: { entries: [] } });
    }
  }

  /**
   * Manually add a history entry (e.g., from "Send to CLI" button)
   */
  async handleAddHistory(ws, { sessionId, role, content, metadata }) {
    try {
      const entry = await History.addHistoryEntry(sessionId, {
        role,
        content,
        metadata,
      });
      this.send(ws, { type: 'history-entry-added', entry });
    } catch (error) {
      this.sendError(ws, `Failed to add history entry: ${error.message}`);
    }
  }

  /**
   * Attach a client to a session
   */
  attachClient(ws, sessionId) {
    // Detach from previous session if any
    this.detachClient(ws);

    // Update client info
    const clientInfo = this.clients.get(ws);
    if (clientInfo) {
      clientInfo.sessionId = sessionId;
    }

    // Add to session clients
    if (!this.sessionClients.has(sessionId)) {
      this.sessionClients.set(sessionId, new Set());
    }
    this.sessionClients.get(sessionId).add(ws);
  }

  /**
   * Detach a client from its session
   */
  detachClient(ws) {
    const clientInfo = this.clients.get(ws);
    if (clientInfo?.sessionId) {
      const sessionClients = this.sessionClients.get(clientInfo.sessionId);
      if (sessionClients) {
        sessionClients.delete(ws);
        if (sessionClients.size === 0) {
          this.sessionClients.delete(clientInfo.sessionId);
        }
      }
      clientInfo.sessionId = null;
    }
  }

  /**
   * Handle client disconnect
   */
  handleDisconnect(ws) {
    this.detachClient(ws);
    this.detachFromChatSession(ws); // Clean up chat session tracking
    this.clients.delete(ws);
    console.log('WebSocket client disconnected');
  }

  /**
   * Send message to a specific client
   */
  send(ws, message) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send error to a client
   */
  sendError(ws, error) {
    this.send(ws, { type: 'error', error });
  }

  /**
   * Broadcast to all clients attached to a session
   */
  broadcastToSession(sessionId, message) {
    const clients = this.sessionClients.get(sessionId);
    if (clients) {
      for (const ws of clients) {
        this.send(ws, message);
      }
    }
  }

  /**
   * Broadcast to all connected clients
   */
  broadcast(message) {
    for (const ws of this.clients.keys()) {
      this.send(ws, message);
    }
  }

  /**
   * Track output for prompt detection
   */
  trackOutputForPromptDetection(sessionId, data) {
    // Get or initialize recent output buffer
    let recent = this.recentOutput.get(sessionId) || '';

    // Strip ANSI codes for pattern matching
    const cleanData = stripAnsi(data);
    recent += cleanData;

    // Keep only last 2000 chars
    if (recent.length > 2000) {
      recent = recent.slice(-2000);
    }
    this.recentOutput.set(sessionId, recent);

    this.rememberInteractivePrompt(sessionId, recent);

    // Also track in session context for history
    sessionContext.addCliOutput(sessionId, cleanData);

    // Skip prompt detection if the data looks like a large code/output dump
    // (prompts are short — if we just received a big chunk, it's probably output not a prompt)
    if (cleanData.length > 300) return;

    // Skip prompt detection when the orchestrator is actively driving this session.
    // The orchestrator has its own completion detector; firing the auto-responder
    // mid-execution can cause the LLM to inject stray "y"/"n" into the terminal.
    if (orchestrator.isSessionActive(sessionId)) return;

    // Check for prompts after a long idle delay
    // CLI tools stream output with small pauses — we need to wait for TRUE idle
    const existingTimer = this.autoResponseTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      // Final guard: only check if the output tail looks like an interactive question
      // NOT a CLI input prompt (> , $ , # ) or regular output
      const tail = (this.recentOutput.get(sessionId) || '').slice(-200);
      const lastLine = tail.split('\n').filter(l => l.trim()).pop() || '';

      // Ignore CLI input prompts — these are the tool waiting for USER commands, not asking a question
      const isInputPrompt = /^[>$#›»]\s/.test(lastLine.trim()) || // Shell/CLI prompts
        /^>\s*$/.test(lastLine.trim()) || // Empty > prompt
        /Try "/.test(lastLine) || // Claude Code's hint prompt
        /shift\+tab|tab to cycle/i.test(lastLine) || // Claude Code UI hints
        /MCP server/i.test(lastLine) || // MCP status messages
        /bypass permissions/i.test(lastLine); // Claude Code permission mode

      if (isInputPrompt) return;

      // A real interactive question looks like:
      // "Do you want to proceed? (y/n)"
      // "Allow access to file.ts? [Y/n]"
      // "Choose an option:"
      const looksLikeQuestion = /\?\s*$/.test(lastLine) || // Ends with ?
        /\?\s*\(y\/n\)/i.test(lastLine) || // ? (y/n)
        /\[Y\/n\]/i.test(lastLine) || // [Y/n]
        /\[yes\/no\]/i.test(lastLine) || // [yes/no]
        /\(yes\/no\)/i.test(lastLine) || // (yes/no)
        /:\s*$/.test(lastLine) && /select|choose|enter|type|pick/i.test(lastLine); // "Select option:"

      if (looksLikeQuestion) {
        this.checkForPrompts(sessionId);
      }
    }, 2000); // 2 seconds of true idle

    this.autoResponseTimers.set(sessionId, timer);
  }

  /**
   * Check for prompts in recent output
   */
  checkForPrompts(sessionId) {
    // Orchestrator owns prompt handling for its sessions
    if (orchestrator.isSessionActive(sessionId)) return;

    const recent = this.recentOutput.get(sessionId);
    if (!recent) return;

    // Only check the last ~200 chars — a real prompt is at the end of output,
    // not buried in the middle of a code dump
    const tail = recent.slice(-200);

    const cliTool = this.sessionCliTools.get(sessionId) || 'generic';
    const result = autoResponder.checkForPrompt(tail, sessionId, cliTool);

    if (result) {
      // Notify clients about detected prompt
      this.broadcastToSession(sessionId, {
        type: 'prompt-detected',
        sessionId,
        pattern: result.pattern,
        matchedText: result.matchedText,
        action: result.action,
        suggestedResponse: result.suggestedResponse,
        responses: result.responses,
        // Smart engine specific fields
        smartEngine: result.smartEngine || false,
        confidence: result.confidence,
        reasoning: result.reasoning,
        projectContext: result.projectContext,
      });

      // Handle auto-response if configured
      if (result.action === 'auto') {
        const settings = autoResponder.getSettings();
        const delay = settings.responseDelay || 500;

        setTimeout(() => {
          // Send the auto-response
          const response = result.suggestedResponse ?? '';
          ptyManager.write(sessionId, response + '\r');

          // Notify clients
          this.broadcastToSession(sessionId, {
            type: 'auto-response-sent',
            sessionId,
            response,
            pattern: result.pattern,
          });
        }, delay);
      }

      // Clear recent output after match to avoid re-matching
      this.recentOutput.set(sessionId, '');
    }
  }

  /**
   * Handle auto-responder settings update for a session
   */
  handleSetAutoResponder(ws, { sessionId, enabled, autoMode }) {
    const targetSession = sessionId || this.clients.get(ws)?.sessionId;
    if (!targetSession) {
      this.sendError(ws, 'No session specified');
      return;
    }

    autoResponder.setSessionSettings(targetSession, { enabled, autoMode });
    this.send(ws, {
      type: 'auto-responder-updated',
      sessionId: targetSession,
      settings: autoResponder.getSessionSettings(targetSession),
    });
  }

  /**
   * Send a response to a detected prompt
   */
  handleSendResponse(ws, { sessionId, response, promptText }) {
    const targetSession = sessionId || this.clients.get(ws)?.sessionId;
    if (!targetSession) {
      this.sendError(ws, 'No session specified');
      return;
    }

    const normalized = this.normalizeInputForInteractivePrompt(targetSession, response, promptText);
    const data = /[\r\n]$/.test(normalized) ? normalized : `${normalized}\r`;
    const visibleData = data.replace(/\r/g, '<CR>').replace(/\n/g, '<LF>');
    console.log(`[terminalServer] prompt response -> session=${targetSession}, response=${JSON.stringify(response)}, data=${JSON.stringify(visibleData)}, hasPromptText=${Boolean(promptText)}`);

    const written = ptyManager.write(targetSession, data);
    console.log(`[terminalServer] prompt response write ${written ? 'succeeded' : 'failed'} -> session=${targetSession}`);
    if (written) {
      this.send(ws, { type: 'response-sent', sessionId: targetSession, response });
      // Clear recent output
      this.recentOutput.set(targetSession, '');
      this.lastInteractivePrompt.delete(targetSession);
    }
  }

  /**
   * Get auto-responder settings
   */
  handleGetAutoResponderSettings(ws, { sessionId }) {
    const targetSession = sessionId || this.clients.get(ws)?.sessionId;

    this.send(ws, {
      type: 'auto-responder-settings',
      sessionId: targetSession,
      sessionSettings: targetSession ? autoResponder.getSessionSettings(targetSession) : null,
      globalSettings: autoResponder.getSettings(),
    });
  }

  /**
   * Clean up session-specific data
   */
  cleanupSession(sessionId) {
    this.recentOutput.delete(sessionId);
    this.lastInteractivePrompt.delete(sessionId);
    this.sessionCliTools.delete(sessionId);
    this.userInputBuffers.delete(sessionId);
    this.outputBuffers.delete(sessionId);
    autoResponder.clearSessionSettings(sessionId);
    sessionContext.clearSession(sessionId);

    const timer = this.autoResponseTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.autoResponseTimers.delete(sessionId);
    }
  }

  /**
   * Start orchestrator execution
   */
  handleOrchestratorStart(ws, { sessionId, projectId, projectPath, steps, planTitle, cliTool, config }) {
    const targetSession = sessionId || this.clients.get(ws)?.sessionId;
    if (!targetSession) { this.sendError(ws, 'No session specified'); return; }

    const writeFn = (data) => ptyManager.write(targetSession, data);

    try {
      const executionId = orchestrator.start({
        sessionId: targetSession,
        projectId,
        projectPath,
        steps,
        planTitle,
        cliTool: cliTool || this.sessionCliTools.get(targetSession) || 'shell',
        config,
        writeFn,
      });
      this.send(ws, { type: 'orchestrator-started', executionId });
    } catch (error) {
      this.sendError(ws, `Failed to start orchestrator: ${error.message}`);
    }
  }

  /**
   * Pause orchestrator execution
   */
  handleOrchestratorPause(ws, { executionId }) {
    orchestrator.pause(executionId);
    this.send(ws, { type: 'orchestrator-paused', executionId });
  }

  /**
   * Resume orchestrator execution
   */
  handleOrchestratorResume(ws, { executionId }) {
    orchestrator.resume(executionId);
    this.send(ws, { type: 'orchestrator-resumed', executionId });
  }

  /**
   * Stop orchestrator execution
   */
  handleOrchestratorStop(ws, { executionId }) {
    orchestrator.stop(executionId);
    this.send(ws, { type: 'orchestrator-stopped', executionId });
  }

  /**
   * Approve current orchestrator step
   */
  handleOrchestratorApprove(ws, { executionId }) {
    orchestrator.approveStep(executionId);
  }

  /**
   * Skip current orchestrator step
   */
  handleOrchestratorSkip(ws, { executionId }) {
    orchestrator.skipStep(executionId);
  }

  /**
   * Get active sessions for a specific project
   */
  handleGetProjectSessions(ws, { projectId, role }) {
    if (!projectId) { this.sendError(ws, 'projectId is required'); return; }
    let sessions = ptyManager.getProjectSessions(projectId);
    // Filter by role if specified (main vs utility)
    if (role) sessions = sessions.filter(s => (s.role || 'main') === role);
    this.send(ws, { type: 'project-sessions', projectId, role, sessions });
  }

  /**
   * Manually rename a session
   */
  handleRenameSession(ws, { sessionId, name }) {
    if (!sessionId || !name?.trim()) {
      this.sendError(ws, 'sessionId and name are required');
      return;
    }
    ptyManager.setSessionName(sessionId, name.trim().slice(0, 40));
    this.send(ws, { type: 'session-renamed', sessionId, name: name.trim().slice(0, 40) });
  }

  /**
   * Emergency kill switch - stop orchestrator and kill PTY
   */
  handleKillSwitch(ws, { executionId }) {
    // Emergency stop: stop orchestrator + kill PTY
    const execution = orchestrator.getStatus(executionId);
    if (execution) {
      orchestrator.stop(executionId);
      if (execution.sessionId) {
        ptyManager.write(execution.sessionId, '\x03'); // Send Ctrl+C first
        setTimeout(() => {
          ptyManager.killSession(execution.sessionId);
        }, 1000);
      }
    }
    this.send(ws, { type: 'kill-switch-activated', executionId });
  }

  async _inspectChatSession(ws, { projectId, chatSessionId, acknowledgeAttach = false, reason = 'health', recover = true }) {
    if (!projectId || !chatSessionId) return;

    this.attachToChatSession(ws, chatSessionId);
    if (acknowledgeAttach) this.send(ws, { type: 'chat-session-attached', chatSessionId, projectId });

    const { chatStore } = await import('./chatStore.js');
    const { jobManager } = await import('./jobManager.js');
    const { agentGateway } = await import('./agentGateway.js');
    const { agentOrchestrator } = await import('./agentOrchestrator.js');

    if (recover) {
      agentOrchestrator.recoverStaleActiveRuns({
        staleMs: ACTIVE_RUN_STALE_MS,
        broadcastFn: (data) => this.broadcastChatData(data),
      });
    }

    const incomplete = chatStore.getIncompleteStreamingMessages(projectId, chatSessionId);
    const visibleStaleIncomplete = incomplete.map(item => {
      if (item.stale) return item;
      const lastChunkAt = item.lastChunkAt || (item.chunks?.length > 0 ? item.chunks[item.chunks.length - 1].timestamp : null);
      const streamStartedAt = item.streamStartedAt || item.message?.metadata?.streamStartedAt || item.message?.createdAt;
      const lastActivityAt = lastChunkAt || streamStartedAt;
      const stale = lastActivityAt
        ? Date.now() - new Date(lastActivityAt).getTime() > VISIBLE_STREAM_RECOVERY_STALE_MS
        : false;
      return { ...item, stale };
    });

    const resumableJobs = recover ? jobManager.getResumableJobs(projectId, chatSessionId, 60) : [];
    if (recover) agentOrchestrator.reconcileSessionRuns(projectId, chatSessionId, (data) => this.send(ws, data));
    const recentRuns = agentOrchestrator.getRecentSessionRuns(projectId, chatSessionId, 5, { reconcile: false });
    const runsWithTasks = recentRuns.map(run => ({ ...run, tasks: agentOrchestrator.getTasks(run.id) }));

    for (const run of runsWithTasks) {
      this.send(ws, {
        type: 'orchestrator-run',
        projectId,
        sessionId: chatSessionId,
        run,
      });
    }

    const recoveredMessages = recover && visibleStaleIncomplete.length > 0
      ? await this._recoverIncompleteStreamingMessages({ projectId, chatSessionId, incomplete: visibleStaleIncomplete, chatStore, jobManager })
      : [];

    if (recover && resumableJobs.length > 0) {
      const mostRecent = resumableJobs[0];
      console.log(`[terminalServer] Found resumable job ${mostRecent.id} with CLI session ${mostRecent.cliSessionId}`);
      this.send(ws, {
        type: 'chat-recovery-starting',
        chatSessionId,
        projectId,
        jobId: mostRecent.id,
        message: 'Attempting to recover interrupted conversation...',
      });
      this._autoResumeJob(ws, projectId, chatSessionId, mostRecent);
    }

    const pendingRecovered = recover
      ? (recoveredMessages.find(message => message?.metadata?.recoveryPending)
        || this._findPendingRecoveredMessage(projectId, chatSessionId, chatStore))
      : null;
    if (recover && pendingRecovered && resumableJobs.length === 0) {
      this._autoRetryRecoveredSession(ws, projectId, chatSessionId, pendingRecovered).catch(err => {
        console.warn('[terminalServer] Auto-retry recovered session failed:', err.message);
      });
    } else if (recover && visibleStaleIncomplete.length === 0 && resumableJobs.length === 0) {
      const lastIncomplete = await this._checkForIncompleteResponse(projectId, chatSessionId, chatStore);
      if (lastIncomplete) {
        const sessionMeta = chatStore.getSessionMeta(projectId, chatSessionId);
        const lastRecoveryAt = sessionMeta?.lastIncompleteRecoveryAt
          ? new Date(sessionMeta.lastIncompleteRecoveryAt).getTime()
          : 0;
        const recentlyChecked = sessionMeta?.lastIncompleteRecoveryMessageId === lastIncomplete.messageId
          && Date.now() - lastRecoveryAt < 10 * 60 * 1000;
        if (!recentlyChecked) {
          chatStore.updateSessionMeta(projectId, chatSessionId, {
            lastIncompleteRecoveryMessageId: lastIncomplete.messageId,
            lastIncompleteRecoveryAt: new Date().toISOString(),
          });
          console.log(`[terminalServer] Last message looks incomplete, auto-resuming: "${lastIncomplete.snippet}"`);
          this.send(ws, {
            type: 'chat-recovery-starting',
            chatSessionId,
            projectId,
            message: 'Checking on previous work...',
          });
          this._autoResumeIncomplete(ws, projectId, chatSessionId, lastIncomplete.cliSessionId);
        }
      }
    }

    const activeJob = jobManager.getSessionJobs(projectId, chatSessionId, 5)
      .find(job => (job.status === 'running' || job.status === 'pending') && jobManager.isJobActive(job.id));
    const hasOpenStream = visibleStaleIncomplete.some(item => !item.stale);
    const busy = agentGateway.isRunning(chatSessionId)
      || agentOrchestrator.hasActiveSession(projectId, chatSessionId)
      || Boolean(activeJob)
      || hasOpenStream
      || resumableJobs.length > 0
      || Boolean(pendingRecovered);

    const messages = chatStore.getMessages(projectId, { sessionId: chatSessionId, limit: 30 });
    this.send(ws, {
      type: 'chat-session-health',
      projectId,
      chatSessionId,
      sessionId: chatSessionId,
      reason,
      busy,
      activeJobId: activeJob?.id || null,
      messages,
      runs: runsWithTasks,
      checkedAt: new Date().toISOString(),
    });
    if (busy) this.send(ws, { type: 'agent-status', projectId, sessionId: chatSessionId, busy: true });
  }

  async _reconcileChatSession(ws, payload = {}) {
    const projectId = payload.projectId;
    const chatSessionId = payload.sessionId || payload.chatSessionId;
    if (!projectId || !chatSessionId) {
      this.sendError(ws, 'projectId and sessionId are required');
      return;
    }

    const { chatStore } = await import('./chatStore.js');
    const { jobManager } = await import('./jobManager.js');
    const { agentGateway } = await import('./agentGateway.js');
    const { agentOrchestrator } = await import('./agentOrchestrator.js');

    chatStore.migrateIfNeeded(projectId);
    this.attachToChatSession(ws, chatSessionId);

    // The backend owns recovery decisions. First reconcile persisted work and
    // stream state, then decide whether any retry is still necessary.
    await this._inspectChatSession(ws, {
      projectId,
      chatSessionId,
      acknowledgeAttach: false,
      reason: payload.intent || 'reconcile',
      recover: false,
    });

    const activeJob = jobManager.getSessionJobs(projectId, chatSessionId, 5)
      .find(job => (job.status === 'running' || job.status === 'pending') && jobManager.isJobActive(job.id));
    if (agentGateway.isRunning(chatSessionId) || agentOrchestrator.hasActiveSession(projectId, chatSessionId) || activeJob) {
      this.send(ws, { type: 'chat-reconcile-result', projectId, sessionId: chatSessionId, action: 'already-running' });
      return;
    }

    const incomplete = chatStore.getIncompleteStreamingMessages(projectId, chatSessionId).map(item => {
      if (item.stale) return item;
      const lastChunkAt = item.lastChunkAt || (item.chunks?.length > 0 ? item.chunks[item.chunks.length - 1].timestamp : null);
      const streamStartedAt = item.streamStartedAt || item.message?.metadata?.streamStartedAt || item.message?.createdAt;
      const lastActivityAt = lastChunkAt || streamStartedAt;
      const stale = lastActivityAt
        ? Date.now() - new Date(lastActivityAt).getTime() > VISIBLE_STREAM_RECOVERY_STALE_MS
        : false;
      return { ...item, stale };
    });
    const recoveredMessages = incomplete.length > 0
      ? await this._recoverIncompleteStreamingMessages({ projectId, chatSessionId, incomplete, chatStore, jobManager })
      : [];
    const recoveredIds = new Set(recoveredMessages.map(message => message?.id).filter(Boolean));
    const hasOpenStream = incomplete.some(item => !item.stale && !recoveredIds.has(item.message?.id));
    if (hasOpenStream) {
      this.send(ws, { type: 'chat-reconcile-result', projectId, sessionId: chatSessionId, action: 'already-running' });
      await this._inspectChatSession(ws, { projectId, chatSessionId, acknowledgeAttach: false, reason: 'stream-active', recover: false });
      return;
    }
    const recoveredPending = recoveredMessages.find(message => message?.metadata?.recoveryPending);
    if (recoveredPending) {
      await this._autoRetryRecoveredSession(ws, projectId, chatSessionId, recoveredPending);
      return;
    }

    const messages = chatStore.getMessages(projectId, { sessionId: chatSessionId, limit: 120 });
    const sorted = [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const target = payload.targetMessageId
      ? sorted.find(message => message.id === payload.targetMessageId)
      : null;
    const targetIndex = target ? sorted.findIndex(message => message.id === target.id) : sorted.length;
    const laterFinal = target
      ? sorted.slice(targetIndex + 1).find(message => this._isCompleteAgentMessage(message))
      : null;

    if (!target) {
      const latestUserIndex = sorted.findLastIndex(message => message.role === 'user');
      const visibleResponse = latestUserIndex >= 0
        ? sorted.slice(latestUserIndex + 1).find(message => this._isUserVisibleTerminalMessage(message))
        : null;
      if (visibleResponse) {
        this.send(ws, {
          type: 'chat-reconcile-result',
          projectId,
          sessionId: chatSessionId,
          action: 'already-complete',
          messageId: visibleResponse.id,
        });
        await this._inspectChatSession(ws, { projectId, chatSessionId, acknowledgeAttach: false, reason: 'already-complete', recover: false });
        return;
      }
    }

    if (laterFinal) {
      this.send(ws, {
        type: 'chat-reconcile-result',
        projectId,
        sessionId: chatSessionId,
        action: 'already-complete',
        messageId: laterFinal.id,
      });
      await this._inspectChatSession(ws, { projectId, chatSessionId, acknowledgeAttach: false, reason: 'already-complete', recover: false });
      return;
    }

    const retryTarget = target || [...sorted].reverse().find(message => (
      message.role === 'error' || message.metadata?.recoveryPending || message.metadata?.interrupted
    ));
    const retryIndex = retryTarget ? sorted.findIndex(message => message.id === retryTarget.id) : sorted.length;
    const priorUser = [...sorted.slice(0, Math.max(0, retryIndex))].reverse().find(message => message.role === 'user')
      || [...sorted].reverse().find(message => message.role === 'user');

    if (!priorUser?.content) {
      this.send(ws, { type: 'chat-reconcile-result', projectId, sessionId: chatSessionId, action: 'no-user-message' });
      return;
    }

    const sessionMeta = chatStore.getSessionMeta(projectId, chatSessionId) || {};
    const actionKey = `${payload.intent || 'reconcile'}:${retryTarget?.id || target?.id || 'latest'}:${priorUser.id}`;
    const lastActionAt = sessionMeta.lastReconcileActionAt ? new Date(sessionMeta.lastReconcileActionAt).getTime() : 0;
    if (sessionMeta.lastReconcileActionKey === actionKey && Date.now() - lastActionAt < 60_000) {
      this.send(ws, { type: 'chat-reconcile-result', projectId, sessionId: chatSessionId, action: 'duplicate-suppressed' });
      await this._inspectChatSession(ws, { projectId, chatSessionId, acknowledgeAttach: false, reason: 'duplicate-suppressed', recover: false });
      return;
    }

    if (retryTarget?.metadata?.recoveryPending || retryTarget?.metadata?.interrupted) {
      await this._autoRetryRecoveredSession(ws, projectId, chatSessionId, retryTarget);
      return;
    }

    let retryContent = priorUser.content.trim();
    if (payload.executeReviewedPlan && payload.review?.docPath) {
      retryContent += `\n\nApproved. Execute the plan from ${payload.review.docPath}. Start implementation now.`;
    }

    chatStore.updateSessionMeta(projectId, chatSessionId, {
      lastReconcileActionKey: actionKey,
      lastReconcileActionAt: new Date().toISOString(),
    });

    await this._startReconciledRetry(ws, {
      projectId,
      chatSessionId,
      content: retryContent,
      payload,
      priorUserId: priorUser.id,
      targetMessageId: retryTarget?.id || target?.id || null,
    });
  }

  _isCompleteAgentMessage(message) {
    if (!message || message.role !== 'agent') return false;
    if (message.metadata?.streaming || message.metadata?.recoveryPending || message.metadata?.interrupted || message.metadata?.error) return false;
    const content = String(message.content || '').trim();
    if (!content) return false;
    return !/interrupted before it could send a final response|previous .* stopped before it produced a final response/i.test(content);
  }

  _isUserVisibleTerminalMessage(message) {
    if (!message) return false;
    if (message.role === 'error') return true;
    return this._isCompleteAgentMessage(message);
  }

  async _startReconciledRetry(ws, { projectId, chatSessionId, content, payload, priorUserId, targetMessageId }) {
    const { chatStore } = await import('./chatStore.js');
    const { agentGateway } = await import('./agentGateway.js');
    const { agentOrchestrator } = await import('./agentOrchestrator.js');

    const sessionMeta = chatStore.getSession(projectId, chatSessionId);
    const assistantSettings = mergeSessionAssistantSettings(sessionMeta || {}, payload, {
      tool: payload.tool || sessionMeta?.tool || 'claude',
      model: payload.model ?? sessionMeta?.model,
      effort: payload.effort ?? sessionMeta?.effort,
    });
    const activeRolePromptIds = normalizeRolePromptIds(payload.activeRolePromptIds);
    const rolePromptInstructions = sanitizeRolePromptInstructions(payload.rolePromptInstructions);
    chatStore.updateSessionMeta(projectId, chatSessionId, { ...assistantSettings, activeRolePromptIds });

    const marker = chatStore.addMessage({
      projectId,
      sessionId: chatSessionId,
      role: 'system',
      content: payload.executeReviewedPlan
        ? '✅ Plan approved. Executing with latest backend state...'
        : '🔁 Backend reconciled missing response. Retrying from the last user request...',
      metadata: { reconcile: true, retry: true, priorUserId, targetMessageId, executeReviewedPlan: !!payload.executeReviewedPlan },
    });
    this.broadcastToChatSession(chatSessionId, { type: 'chat-message', message: marker });
    this.broadcast({ type: 'chat-message', message: marker });

    const sharedBroadcast = (data) => {
      this.broadcastToChatSession(chatSessionId, data);
      this.broadcast(data);
    };
    const mode = payload.mode || 'agent';
    const agentContent = appendRolePromptInstructions(content, rolePromptInstructions);
    const shouldOrchestrate = agentOrchestrator.shouldOrchestrate({
      mode,
      content,
      executeReviewedPlan: !!payload.executeReviewedPlan,
    });
    const runner = shouldOrchestrate ? agentOrchestrator.startRun.bind(agentOrchestrator) : agentGateway.handleTask.bind(agentGateway);

    runner({
      projectId,
      sessionId: chatSessionId,
      content: agentContent,
      attachments: [],
      mode,
      tool: assistantSettings.tool,
      model: assistantSettings.model,
      effort: assistantSettings.effort,
      executeReviewedPlan: !!payload.executeReviewedPlan,
      broadcastFn: sharedBroadcast,
    }).catch(err => {
      const errMsg = chatStore.addMessage({
        projectId,
        sessionId: chatSessionId,
        role: 'error',
        content: `Retry failed: ${err.message}`,
        metadata: { reconcile: true, targetMessageId },
      });
      this.broadcastToChatSession(chatSessionId, { type: 'chat-message', message: errMsg });
      this.broadcast({ type: 'chat-message', message: errMsg });
    });
  }

  /**
   * Check if the last assistant message looks incomplete (waiting on agents, etc.)
   * Returns { snippet, cliSessionId } if incomplete, null otherwise.
   */
  async _checkForIncompleteResponse(projectId, chatSessionId, chatStore) {
    try {
      const messages = chatStore.getMessages(projectId, { sessionId: chatSessionId, limit: 10 });
      if (!messages || messages.length === 0) {
        console.log(`[terminalServer] No messages found for session ${chatSessionId}`);
        return null;
      }

      // Find the most recent assistant/agent message
      // Note: getMessages returns messages in reverse chronological order (most recent first)
      const lastAssistant = messages.find(m =>
        m.role === 'assistant' || m.role === 'agent'
      );
      if (!lastAssistant) {
        console.log(`[terminalServer] No assistant/agent message found in session ${chatSessionId}`);
        return null;
      }

      const content = lastAssistant.content || '';
      console.log(`[terminalServer] Checking last message (${lastAssistant.role}): "${content.slice(0, 80)}..."`);

      if (!lastAssistant.metadata?.recoveryPending && !lastAssistant.metadata?.interrupted) {
        console.log('[terminalServer] Last message is finalized; skipping heuristic auto-resume');
        return null;
      }

      // Patterns that indicate an incomplete response (waiting for background work)
      const incompletePatterns = [
        /waiting (on|for).*(agent|task|background)/i,
        /agent.*running/i,
        /background.*running/i,
        /working in the background/i,
        /launched.*agent/i,
        /\bI(?:'|\u2019)ll (?:implement|add|trace|start|look|investigate|work)\b/i,
        /\bI(?:'|\u2019)m (?:adding|implementing|checking|locating|working)\b/i,
        /\bstarting by\b/i,
        /\.\.\.$/,  // Ends with ellipsis
      ];

      const looksIncomplete = incompletePatterns.some(p => p.test(content));
      console.log(`[terminalServer] Pattern match result: looksIncomplete=${looksIncomplete}`);

      // Also check if it was recent (within last 2 hours)
      const msgTime = new Date(lastAssistant.createdAt || lastAssistant.timestamp);
      const ageMinutes = (Date.now() - msgTime.getTime()) / (1000 * 60);
      console.log(`[terminalServer] Message age: ${ageMinutes.toFixed(1)} minutes`);

      if (looksIncomplete && ageMinutes < 120) {
        // Try to get CLI session ID from session metadata
        const sessionMeta = chatStore.getSessionMeta(projectId, chatSessionId);
        const tool = sessionMeta?.tool || 'claude';
        const cliSessionId = sessionMeta?.toolSessions?.[tool]?.cliSessionId
          || (sessionMeta?.cliSessionTool === tool ? sessionMeta?.cliSessionId : null)
          || lastAssistant.metadata?.cliSessionId;

        if (cliSessionId) {
          return {
            snippet: content.slice(0, 100),
            cliSessionId,
            messageId: lastAssistant.id,
          };
        }
      }

      return null;
    } catch (err) {
      console.warn('[terminalServer] Error checking for incomplete response:', err.message);
      return null;
    }
  }

  /**
   * Auto-resume when last message looks incomplete (was waiting for background agents).
   */
  async _autoResumeIncomplete(ws, projectId, chatSessionId, cliSessionId) {
    try {
      const { chatStore } = await import('./chatStore.js');
      const { agentGateway } = await import('./agentGateway.js');

      // Create a system message explaining the check
      const recoveryMsg = chatStore.addMessage({
        projectId,
        sessionId: chatSessionId,
        role: 'system',
        content: '🔄 Checking on previous work...',
        metadata: { recovery: true },
      });
      this.broadcastToChatSession(chatSessionId, { type: 'chat-message', message: recoveryMsg });
      this.broadcast({ type: 'chat-message', message: recoveryMsg });

      // Ensure CLI session ID is stored
      const sessionMeta = chatStore.getSessionMeta(projectId, chatSessionId);
      const assistantSettings = mergeSessionAssistantSettings(sessionMeta || {}, {}, {
        tool: sessionMeta?.tool || 'claude',
      });
      chatStore.updateSessionMeta(projectId, chatSessionId, {
        cliSessionId,
        cliSessionTool: assistantSettings.tool,
        toolSessions: {
          ...(sessionMeta?.toolSessions || {}),
          [assistantSettings.tool]: { cliSessionId, updatedAt: new Date().toISOString() },
        },
      });

      // Ask Claude to check on the status
      const followUpPrompt = 'What is the status of the background agents or tasks you were working on? If they completed, please summarize the results. If they are still running, let me know.';

      console.log(`[terminalServer] Checking incomplete work with CLI session ${cliSessionId}`);

      await agentGateway.handleTask({
        projectId,
        sessionId: chatSessionId,
        content: followUpPrompt,
        mode: 'agent',
        tool: assistantSettings.tool,
        model: assistantSettings.model,
        effort: assistantSettings.effort,
        skipUnread: true,
        broadcastFn: (msg) => {
          this.broadcastToChatSession(chatSessionId, msg);
          this.broadcast(msg);
        },
      });

      this.send(ws, {
        type: 'chat-recovery-complete',
        chatSessionId,
        projectId,
        message: 'Status check complete.',
      });

    } catch (err) {
      console.warn('[terminalServer] Auto-resume incomplete failed:', err.message);
      this.send(ws, {
        type: 'chat-recovery-complete',
        chatSessionId,
        projectId,
        message: 'Ready to continue.',
      });
    }
  }

  async _recoverIncompleteStreamingMessages({ projectId, chatSessionId, incomplete, chatStore, jobManager }) {
    const recovered = [];
    for (const item of incomplete || []) {
      const recoveredMsg = await this._recoverOneStreamingMessage({
        item: { ...item, message: { ...(item.message || {}), projectId, sessionId: chatSessionId } },
        chatStore,
        jobManager,
      });
      if (!recoveredMsg) continue;
      recovered.push(recoveredMsg);
    }
    return recovered;
  }

  async _recoverOneStreamingMessage({ item, chatStore, jobManager }) {
    const messageId = item?.message?.id;
    const projectId = item?.message?.projectId;
    const sessionId = item?.message?.sessionId;
    if (!messageId || !projectId || !sessionId) return null;

    const jobId = item.message?.metadata?.jobId || null;
    const job = jobId ? jobManager.getJob(jobId) : null;
    if (job?.status === 'running' || job?.status === 'pending') {
      if (jobManager.isJobActive(job.id)) return null;
      jobManager.markJobFailed(job.id, 'Recovered stale job with no active backend worker.');
    }
    if (!item.stale && !job) return null;

    const recoveredMsg = chatStore.recoverStreamingMessage({ projectId, sessionId, messageId });
    if (!recoveredMsg) return null;
    this.broadcastChatData({
      type: 'chat-message-recovered',
      projectId,
      sessionId,
      message: recoveredMsg,
    });
    return recoveredMsg;
  }

  _findPendingRecoveredMessage(projectId, chatSessionId, chatStore) {
    const messages = chatStore.getMessages(projectId, { sessionId: chatSessionId, limit: 20 });
    return messages.find(message =>
      (message.role === 'agent' || message.role === 'error') && message.metadata?.recoveryPending
    ) || null;
  }

  async _autoRetryRecoveredSession(ws, projectId, chatSessionId, recoveryMessage) {
    const { chatStore } = await import('./chatStore.js');
    const { agentGateway } = await import('./agentGateway.js');
    const { agentOrchestrator } = await import('./agentOrchestrator.js');
    const { jobManager } = await import('./jobManager.js');

    if (agentGateway.isRunning(chatSessionId) || agentOrchestrator.hasActiveSession(projectId, chatSessionId)) return;

    const activeJob = jobManager.getSessionJobs(projectId, chatSessionId, 5)
      .find(job => (job.status === 'running' || job.status === 'pending') && jobManager.isJobActive(job.id));
    if (activeJob) return;

    const sessionMeta = chatStore.getSessionMeta(projectId, chatSessionId);
    if (sessionMeta?.lastAutoRecoveryMessageId === recoveryMessage?.id) return;

    const messages = chatStore.getMessages(projectId, { sessionId: chatSessionId, limit: 50 });
    const lastUser = messages.find(message => message.role === 'user');
    if (!lastUser?.content) return;
    if (sessionMeta?.lastAutoRecoveryUserMessageId === lastUser.id) return;

    if (ws) {
      this.send(ws, {
        type: 'chat-recovery-starting',
        chatSessionId,
        projectId,
        message: 'Retrying interrupted work automatically...',
      });
    }

    chatStore.updateSessionMeta(projectId, chatSessionId, {
      lastAutoRecoveryMessageId: recoveryMessage?.id || null,
      lastAutoRecoveryUserMessageId: lastUser.id,
      lastAutoRecoveryAt: new Date().toISOString(),
    });

    const assistantSettings = mergeSessionAssistantSettings(sessionMeta || {}, lastUser.metadata || {}, {
      tool: lastUser.metadata?.tool || sessionMeta?.tool || 'claude',
      model: lastUser.metadata?.model ?? sessionMeta?.model,
      effort: lastUser.metadata?.effort ?? sessionMeta?.effort,
    });
    const mode = lastUser.metadata?.mode || 'agent';
    const attachments = Array.isArray(lastUser.metadata?.attachments) ? lastUser.metadata.attachments : [];

    const sharedBroadcast = (data) => {
      this.broadcastToChatSession(chatSessionId, data);
      this.broadcast(data);
    };

    const runner = agentOrchestrator.shouldOrchestrate({ mode, content: lastUser.content })
      ? agentOrchestrator.startRun.bind(agentOrchestrator)
      : agentGateway.handleTask.bind(agentGateway);

    try {
      await runner({
        projectId,
        sessionId: chatSessionId,
        content: lastUser.content,
        attachments,
        mode,
        tool: assistantSettings.tool,
        model: assistantSettings.model,
        effort: assistantSettings.effort,
        broadcastFn: sharedBroadcast,
      });
    } catch (err) {
      const errMsg = chatStore.addMessage({
        projectId,
        sessionId: chatSessionId,
        role: 'error',
        content: `Automatic retry failed: ${err.message}`,
        metadata: { recovery: true, recoveryMessageId: recoveryMessage?.id || null },
      });
      this.broadcastToChatSession(chatSessionId, { type: 'chat-message', message: errMsg });
      this.broadcast({ type: 'chat-message', message: errMsg });
    } finally {
      if (ws) {
        this.send(ws, {
          type: 'chat-recovery-complete',
          chatSessionId,
          projectId,
          message: 'Automatic retry completed.',
        });
      }
    }
  }

  /**
   * Auto-resume an interrupted job by sending a follow-up prompt to Claude.
   * Uses the preserved CLI session ID to continue the conversation.
   */
  async _autoResumeJob(ws, projectId, chatSessionId, job) {
    try {
      const { chatStore } = await import('./chatStore.js');
      const { agentGateway } = await import('./agentGateway.js');
      const { jobManager } = await import('./jobManager.js');

      // Mark this job as resumed so we don't try again
      jobManager.markJobResumed(job.id);

      // Create a system message explaining the recovery
      const recoveryMsg = chatStore.addMessage({
        projectId,
        sessionId: chatSessionId,
        role: 'system',
        content: '🔄 Reconnected. Checking on interrupted work...',
        metadata: { recovery: true, jobId: job.id },
      });
      this.broadcastToChatSession(chatSessionId, { type: 'chat-message', message: recoveryMsg });
      this.broadcast({ type: 'chat-message', message: recoveryMsg });

      // Ensure the CLI session ID is stored in the chat session
      const sessionMeta = chatStore.getSessionMeta(projectId, chatSessionId);
      const assistantSettings = mergeSessionAssistantSettings(sessionMeta || {}, {}, {
        tool: sessionMeta?.tool || job.tool || 'claude',
      });
      chatStore.updateSessionMeta(projectId, chatSessionId, {
        cliSessionId: job.cliSessionId,
        cliSessionTool: assistantSettings.tool,
        toolSessions: {
          ...(sessionMeta?.toolSessions || {}),
          [assistantSettings.tool]: { cliSessionId: job.cliSessionId, updatedAt: new Date().toISOString() },
        },
      });

      // Send a follow-up prompt to check on the interrupted work
      const followUpPrompt = 'Connection was interrupted. Please summarize what you were working on and its current status. If there were any pending tasks or agents, check their status and complete any remaining work.';

      console.log(`[terminalServer] Auto-resuming job ${job.id} with CLI session ${job.cliSessionId}`);

      // Use the agentGateway to send the follow-up
      await agentGateway.handleTask({
        projectId,
        sessionId: chatSessionId,
        content: followUpPrompt,
        mode: 'agent',
        tool: assistantSettings.tool,
        model: assistantSettings.model,
        effort: assistantSettings.effort,
        skipUnread: true,
        broadcastFn: (msg) => {
          this.broadcastToChatSession(chatSessionId, msg);
          this.broadcast(msg);
        },
      });

      // Notify client that recovery completed
      this.send(ws, {
        type: 'chat-recovery-complete',
        chatSessionId,
        projectId,
        jobId: job.id,
        message: 'Conversation resumed successfully.',
      });

    } catch (err) {
      console.warn(`[terminalServer] Auto-resume needs manual retry for job ${job.id}:`, err.message);
      // Don't show scary error - just add a helpful message
      const { chatStore } = await import('./chatStore.js');
      const helpMsg = chatStore.addMessage({
        projectId,
        sessionId: chatSessionId,
        role: 'system',
        content: '🔄 Previous work was interrupted. You can continue by sending a message - Claude will remember the context.',
        metadata: { recovery: true, recoveryRetry: true },
      });
      this.broadcastToChatSession(chatSessionId, { type: 'chat-message', message: helpMsg });
      this.broadcast({ type: 'chat-message', message: helpMsg });

      this.send(ws, {
        type: 'chat-recovery-complete', // Mark as complete even if partial - don't alarm user
        chatSessionId,
        projectId,
        jobId: job.id,
        message: 'Ready to continue.',
      });
    }
  }

  /**
   * Cleanup on shutdown
   */
  cleanup() {
    if (this.reliabilityMonitor) clearInterval(this.reliabilityMonitor);
    this.reliabilityMonitor = null;
    // Clear all auto-response timers
    for (const timer of this.autoResponseTimers.values()) {
      clearTimeout(timer);
    }
    this.autoResponseTimers.clear();

    ptyManager.cleanup();
    if (this.wss) {
      this.wss.close();
    }
  }
}

// Export singleton instance
export const terminalServer = new TerminalServer();
export default terminalServer;
