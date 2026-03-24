/**
 * PTY Session Manager
 * Manages persistent terminal sessions for AI CLI tools
 */

import * as pty from 'node-pty';
import os from 'os';
import { EventEmitter } from 'events';

class PTYManager extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map(); // sessionId -> session object
    this.sessionCounter = 0;
  }

  /**
   * Get shell configuration for current OS
   */
  getShellConfig() {
    const isWindows = os.platform() === 'win32';

    if (isWindows) {
      return {
        shell: 'powershell.exe',
        args: [],
      };
    }

    return {
      shell: process.env.SHELL || '/bin/bash',
      args: [],
    };
  }

  /**
   * Create a new PTY session
   */
  createSession(options = {}) {
    const {
      projectId = null,
      cliTool = null,
      cols = 120,
      rows = 30,
      cwd = process.env.HOME || os.homedir(),
    } = options;

    const sessionId = `session-${Date.now()}-${++this.sessionCounter}`;
    const { shell, args } = this.getShellConfig();

    try {
      const ptyProcess = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        },
      });

      const session = {
        id: sessionId,
        projectId,
        cliTool,
        ptyProcess,
        status: 'active',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        history: [], // Store conversation history
        cols,
        rows,
      };

      // Handle PTY output
      ptyProcess.onData((data) => {
        session.lastActivity = new Date().toISOString();
        this.emit('data', { sessionId, data });
      });

      // Handle PTY exit
      ptyProcess.onExit(({ exitCode, signal }) => {
        session.status = 'terminated';
        session.exitCode = exitCode;
        session.signal = signal;
        this.emit('exit', { sessionId, exitCode, signal });
      });

      this.sessions.set(sessionId, session);
      this.emit('session-created', { sessionId, projectId, cliTool });

      return {
        sessionId,
        projectId,
        cliTool,
        status: 'active',
        createdAt: session.createdAt,
      };
    } catch (error) {
      console.error('Failed to create PTY session:', error);
      throw error;
    }
  }

  /**
   * Write data to a PTY session
   * Returns false if session not found or not active (instead of throwing)
   */
  write(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'active') {
      // Don't throw - session may have been terminated
      return false;
    }

    session.ptyProcess.write(data);
    session.lastActivity = new Date().toISOString();
    return true;
  }

  /**
   * Resize a PTY session
   */
  resize(sessionId, cols, rows) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'active') {
      return false;
    }

    session.ptyProcess.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
    return true;
  }

  /**
   * Get session info
   */
  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      id: session.id,
      projectId: session.projectId,
      cliTool: session.cliTool,
      status: session.status,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      cols: session.cols,
      rows: session.rows,
      exitCode: session.exitCode,
    };
  }

  /**
   * Get all sessions
   */
  getAllSessions() {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      projectId: session.projectId,
      cliTool: session.cliTool,
      status: session.status,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
    }));
  }

  /**
   * Get active sessions for a project
   */
  getProjectSessions(projectId) {
    return this.getAllSessions().filter(s => s.projectId === projectId);
  }

  /**
   * Kill a PTY session
   */
  killSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    if (session.status === 'active') {
      session.ptyProcess.kill();
      session.status = 'terminated';
    }

    return true;
  }

  /**
   * Remove a session from memory
   */
  removeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.status === 'active') {
      session.ptyProcess.kill();
    }

    this.sessions.delete(sessionId);
    return true;
  }

  /**
   * Start a CLI tool in a session
   */
  startCLI(sessionId, cliTool) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'active') {
      throw new Error(`Session ${sessionId} not found or not active`);
    }

    const commands = {
      claude: 'claude\n',
      copilot: 'gh copilot\n',
      aider: 'aider\n',
      gemini: 'gemini\n',
    };

    const command = commands[cliTool];
    if (command) {
      session.cliTool = cliTool;
      session.ptyProcess.write(command);
    }

    return true;
  }

  /**
   * Add entry to session history (our own tracking)
   */
  addHistoryEntry(sessionId, entry) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.history.push({
      ...entry,
      timestamp: new Date().toISOString(),
    });

    // Keep last 1000 entries
    if (session.history.length > 1000) {
      session.history = session.history.slice(-1000);
    }

    return true;
  }

  /**
   * Get session history
   */
  getHistory(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? session.history : [];
  }

  /**
   * Cleanup all sessions on shutdown
   */
  cleanup() {
    for (const [sessionId, session] of this.sessions) {
      if (session.status === 'active') {
        session.ptyProcess.kill();
      }
    }
    this.sessions.clear();
  }
}

// Export singleton instance
export const ptyManager = new PTYManager();
export default ptyManager;
