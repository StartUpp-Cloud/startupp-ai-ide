/**
 * Terminal WebSocket Server
 * Handles real-time communication between frontend and PTY sessions
 */

import { WebSocketServer } from 'ws';
import { ptyManager } from './ptyManager.js';

class TerminalServer {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // ws -> { sessionId, ... }
    this.sessionClients = new Map(); // sessionId -> Set of ws clients
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
      this.broadcastToSession(sessionId, {
        type: 'output',
        sessionId,
        data,
      });
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

      default:
        this.sendError(ws, `Unknown message type: ${type}`);
    }
  }

  /**
   * Create a new PTY session
   */
  handleCreateSession(ws, { projectId, cliTool, cols, rows, cwd }) {
    try {
      const session = ptyManager.createSession({
        projectId,
        cliTool,
        cols: cols || 120,
        rows: rows || 30,
        cwd,
      });

      // Auto-attach the creating client
      this.attachClient(ws, session.sessionId);

      this.send(ws, {
        type: 'session-created',
        ...session,
      });

      // If a CLI tool was specified, start it
      if (cliTool && cliTool !== 'shell') {
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
  handleInput(ws, { data, sessionId }) {
    const clientInfo = this.clients.get(ws);
    const targetSession = sessionId || clientInfo?.sessionId;

    if (!targetSession) {
      this.sendError(ws, 'Not attached to any session');
      return;
    }

    try {
      ptyManager.write(targetSession, data);
    } catch (error) {
      this.sendError(ws, error.message);
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
