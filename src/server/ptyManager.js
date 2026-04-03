/**
 * PTY Session Manager
 * Manages persistent terminal sessions for AI CLI tools
 */

import * as pty from 'node-pty';
import os from 'os';
import { EventEmitter } from 'events';
import { sessionHistory } from './sessionHistory.js';

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
      containerName = null,
      role = 'main', // 'main' or 'utility'
      cols = 120,
      rows = 30,
      cwd = process.env.HOME || os.homedir(),
    } = options;

    const sessionId = `session-${Date.now()}-${++this.sessionCounter}`;

    let shell, args, spawnCwd;

    if (containerName) {
      // Docker container session
      shell = 'docker';
      args = ['exec', '-it', '-w', cwd || '/workspace', containerName, 'bash'];
      spawnCwd = undefined; // cwd is inside the container, not on the host
    } else {
      // Local session
      const config = this.getShellConfig();
      shell = config.shell;
      args = config.args;
      spawnCwd = cwd;
    }

    try {
      const ptyProcess = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: spawnCwd,
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
        containerName,
        role,
        ptyProcess,
        status: 'active',
        name: null, // LLM-generated descriptive name, set after first activity
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        history: [], // Store conversation history
        scrollback: '', // Rolling buffer of recent output for reconnection replay
        outputLength: 0, // Track total output for auto-naming trigger
        named: false, // Whether LLM has named this session
        cols,
        rows,
      };

      // Periodic save timer — saves scrollback snapshot every 30 seconds
      let lastSaveAt = Date.now();
      let saveTimer = null;

      // Handle PTY output
      ptyProcess.onData((data) => {
        session.lastActivity = new Date().toISOString();
        // Append to scrollback buffer (keep last 100KB)
        session.scrollback += data;
        if (session.scrollback.length > 100000) {
          session.scrollback = session.scrollback.slice(-100000);
        }
        session.outputLength += data.length;
        this.emit('data', { sessionId, data });

        // Trigger auto-naming after ~2KB of output
        if (!session.named && session.outputLength > 2000) {
          session.named = true;
          this.emit('needs-naming', { sessionId, projectId: session.projectId });
        }

        // Periodic save — debounced, every 30 seconds of activity
        if (Date.now() - lastSaveAt > 30000 && !saveTimer) {
          saveTimer = setTimeout(() => {
            lastSaveAt = Date.now();
            saveTimer = null;
            sessionHistory.saveSession({
              sessionId,
              projectId: session.projectId,
              role: session.role,
              name: session.name,
              cliTool: session.cliTool,
              containerName: session.containerName,
              scrollback: session.scrollback,
              createdAt: session.createdAt,
              endedAt: new Date().toISOString(),
              exitCode: null,
            }).catch(() => {}); // Non-critical
          }, 5000); // 5s debounce
        }
      });

      // Handle PTY exit
      ptyProcess.onExit(({ exitCode, signal }) => {
        session.status = 'terminated';
        session.exitCode = exitCode;
        session.signal = signal;

        // Save session to history before cleanup
        sessionHistory.saveSession({
          sessionId,
          projectId: session.projectId,
          role: session.role,
          name: session.name,
          cliTool: session.cliTool,
          containerName: session.containerName,
          scrollback: session.scrollback,
          createdAt: session.createdAt,
          endedAt: new Date().toISOString(),
          exitCode,
        }).then(savedEntry => {
          // Async name the session (non-blocking)
          sessionHistory.nameWithLLM(savedEntry.id).catch(() => {});
        }).catch(err => console.warn('Failed to save session history:', err.message));

        this.emit('exit', { sessionId, exitCode, signal });
      });

      this.sessions.set(sessionId, session);
      this.emit('session-created', { sessionId, projectId, cliTool });

      return {
        sessionId,
        projectId,
        cliTool,
        containerName,
        role,
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
      containerName: session.containerName,
      role: session.role || 'main',
      status: session.status,
      name: session.name,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      cols: session.cols,
      rows: session.rows,
      exitCode: session.exitCode,
    };
  }

  /**
   * Get the scrollback buffer for a session (for replay on reconnect)
   */
  getScrollback(sessionId) {
    const session = this.sessions.get(sessionId);
    return session?.scrollback || '';
  }

  /**
   * Set a descriptive name for a session
   */
  setSessionName(sessionId, name) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.name = name;
      this.emit('session-renamed', { sessionId, name });
    }
  }

  /**
   * Get all sessions
   */
  getAllSessions() {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      projectId: session.projectId,
      cliTool: session.cliTool,
      containerName: session.containerName,
      role: session.role || 'main',
      status: session.status,
      name: session.name,
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
      // Save session to history before killing
      sessionHistory.saveSession({
        sessionId,
        projectId: session.projectId,
        role: session.role,
        name: session.name,
        cliTool: session.cliTool,
        containerName: session.containerName,
        scrollback: session.scrollback,
        createdAt: session.createdAt,
        endedAt: new Date().toISOString(),
        exitCode: null,
      }).then(savedEntry => {
        sessionHistory.nameWithLLM(savedEntry.id).catch(() => {});
      }).catch(err => console.warn('Failed to save session history:', err.message));

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
    // Save all active sessions to history before killing them
    const savePromises = [];
    for (const [sessionId, session] of this.sessions) {
      if (session.status === 'active') {
        savePromises.push(
          sessionHistory.saveSession({
            sessionId,
            projectId: session.projectId,
            role: session.role,
            name: session.name,
            cliTool: session.cliTool,
            containerName: session.containerName,
            scrollback: session.scrollback,
            createdAt: session.createdAt,
            endedAt: new Date().toISOString(),
            exitCode: null,
          }).catch(err => console.warn(`Failed to save session ${sessionId}:`, err.message))
        );
        session.ptyProcess.kill();
      }
    }
    this.sessions.clear();
    // Return promise so shutdown can wait for saves
    return Promise.all(savePromises);
  }
}

// Export singleton instance
export const ptyManager = new PTYManager();
export default ptyManager;
