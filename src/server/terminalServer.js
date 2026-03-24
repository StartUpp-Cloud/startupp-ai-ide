/**
 * Terminal WebSocket Server
 * Handles real-time communication between frontend and PTY sessions
 */

import { WebSocketServer } from 'ws';
import { ptyManager } from './ptyManager.js';
import { OutputBuffer, stripAnsi } from './conversationParser.js';
import History from './models/History.js';

class TerminalServer {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // ws -> { sessionId, ... }
    this.sessionClients = new Map(); // sessionId -> Set of ws clients
    this.outputBuffers = new Map(); // sessionId -> OutputBuffer
    this.userInputBuffers = new Map(); // sessionId -> current user input
  }

  /**
   * Initialize WebSocket server
   */
  init(server) {
    this.wss = new WebSocketServer({
      server,
      path: '/ws/terminal',
    });

    this.wss.on('connection', (ws) => {
      console.log('WebSocket client connected');

      this.clients.set(ws, { sessionId: null });

      ws.on('message', (message) => {
        try {
          const msg = JSON.parse(message.toString());
          this.handleMessage(ws, msg);
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

    // Listen to PTY manager events
    ptyManager.on('data', ({ sessionId, data }) => {
      // Broadcast raw output to clients
      this.broadcastToSession(sessionId, {
        type: 'output',
        sessionId,
        data,
      });

      // Buffer output for history parsing
      const buffer = this.outputBuffers.get(sessionId);
      if (buffer) {
        buffer.append(data);
      }
    });

    ptyManager.on('exit', ({ sessionId, exitCode, signal }) => {
      this.broadcastToSession(sessionId, {
        type: 'exit',
        sessionId,
        exitCode,
        signal,
      });
    });

    ptyManager.on('session-created', ({ sessionId, projectId, cliTool }) => {
      // Notify all clients about new session
      this.broadcast({
        type: 'session-created',
        sessionId,
        projectId,
        cliTool,
      });
    });

    console.log('Terminal WebSocket server initialized on /ws/terminal');
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(ws, msg) {
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

      case 'list-sessions':
        this.handleListSessions(ws);
        break;

      case 'get-session':
        this.handleGetSession(ws, payload);
        break;

      case 'get-history':
        this.handleGetHistory(ws, payload);
        break;

      case 'add-history':
        this.handleAddHistory(ws, payload);
        break;

      default:
        this.sendError(ws, `Unknown message type: ${type}`);
    }
  }

  /**
   * Create a new PTY session
   */
  async handleCreateSession(ws, { projectId, cliTool, cols, rows, cwd }) {
    try {
      const session = ptyManager.createSession({
        projectId,
        cliTool,
        cols: cols || 120,
        rows: rows || 30,
        cwd,
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

      // Auto-attach the creating client
      this.attachClient(ws, session.sessionId);

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

    // Write to PTY - returns false if session is terminated (don't error)
    const written = ptyManager.write(targetSession, data);
    if (!written) {
      // Session is gone, silently ignore input
      return;
    }

    // Track user input for history
    const inputBuffer = this.userInputBuffers.get(targetSession) || '';

    // If Enter was pressed (newline), save the accumulated input as user message
    if (data.includes('\r') || data.includes('\n')) {
      const userMessage = (inputBuffer + data).replace(/[\r\n]+$/, '').trim();
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
      this.userInputBuffers.set(targetSession, inputBuffer + data);
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
      // Flush any remaining output buffer
      const buffer = this.outputBuffers.get(sessionId);
      if (buffer) {
        buffer.flush();
        this.outputBuffers.delete(sessionId);
      }
      this.userInputBuffers.delete(sessionId);

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
   * Cleanup on shutdown
   */
  cleanup() {
    ptyManager.cleanup();
    if (this.wss) {
      this.wss.close();
    }
  }
}

// Export singleton instance
export const terminalServer = new TerminalServer();
export default terminalServer;
