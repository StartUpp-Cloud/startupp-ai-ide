/**
 * PTY Session Manager
 * Manages persistent terminal sessions for AI CLI tools
 */

import * as pty from 'node-pty';
import os from 'os';
import fs from 'fs';
import { execSync } from 'child_process';
import { EventEmitter } from 'events';
import { sessionHistory } from './sessionHistory.js';

// Resolve the full path to the docker binary (needed for pty.spawn on macOS).
// PM2/Node inherits a minimal PATH that often excludes Docker's install location.
// We try `which docker` with an expanded PATH first, then fall back to known paths.
let _cachedDockerBinary = null;

function findDockerBinary() {
  if (_cachedDockerBinary) return _cachedDockerBinary;

  const home = os.homedir();
  // Expanded PATH covering Docker Desktop, Homebrew, OrbStack, Rancher Desktop, Colima, etc.
  const extraDirs = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    `${home}/.docker/bin`,
    '/Applications/Docker.app/Contents/Resources/bin',
    `${home}/.rd/bin`,
    `${home}/.orbstack/bin`,
    '/opt/local/bin',
    '/snap/bin',
    `${home}/bin`,
    `${home}/.local/bin`,
  ];
  const expandedPath = [...new Set([
    ...(process.env.PATH || '').split(':'),
    ...extraDirs,
  ])].join(':');

  console.log(`[ptyManager] Searching for docker binary...`);
  console.log(`[ptyManager] Platform: ${os.platform()}, HOME: ${home}`);
  console.log(`[ptyManager] Current PATH: ${process.env.PATH || '(empty)'}`);

  // Try dynamic lookup first
  try {
    const resolved = execSync('which docker', {
      env: { ...process.env, PATH: expandedPath },
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
    if (resolved && fs.existsSync(resolved)) {
      console.log(`[ptyManager] ✓ Docker found via 'which': ${resolved}`);
      _cachedDockerBinary = resolved;
      return resolved;
    }
  } catch (err) {
    console.log(`[ptyManager] 'which docker' failed: ${err.message}`);
  }

  // Static fallback — check each candidate
  for (const dir of extraDirs) {
    const p = `${dir}/docker`;
    try {
      if (fs.existsSync(p)) {
        console.log(`[ptyManager] ✓ Docker found via static check: ${p}`);
        _cachedDockerBinary = p;
        return p;
      }
    } catch {}
  }

  console.error('[ptyManager] ✗ Docker binary NOT FOUND in any location. Checked:');
  extraDirs.forEach(d => console.error(`  - ${d}/docker`));
  console.error('Session creation will fail. Install Docker and ensure it is in PATH.');
  _cachedDockerBinary = 'docker'; // will fail but at least won't search every time
  return 'docker';
}

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
      // Docker container session via dtach — survives PM2 restarts
      // dtach -A creates new or attaches to existing session socket
      // Unlike tmux, dtach passes ALL terminal escape sequences through untouched,
      // which prevents garbled rendering of TUI apps like Claude Code.
      //
      // We spawn /bin/bash and exec into docker from there, because node-pty's
      // posix_spawnp can fail on macOS when spawning docker directly (code signing).
      const dockerBin = findDockerBinary();
      const socketPath = `/tmp/${role}-session.dtach`;
      const workDir = cwd || '/workspace';
      shell = '/bin/bash';
      args = [
        '-c',
        `exec ${dockerBin} exec -it -e TERM=xterm-256color -e COLORTERM=truecolor -w '${workDir}' '${containerName}' dtach -A '${socketPath}' -z bash -l`,
      ];
      spawnCwd = undefined;
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
          // Ensure Docker is in PATH on macOS (Docker Desktop, Homebrew)
          PATH: `${process.env.PATH || ''}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/snap/bin`,
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

        // Live write — debounced 3s, always within 3s of latest output on disk
        sessionHistory.writeLive(sessionId, session.scrollback, {
          projectId: session.projectId,
          role: session.role,
        });
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
      console.error(`[ptyManager] Failed to create PTY session:`, error.message);
      console.error(`[ptyManager] Shell: ${shell}, Args: ${JSON.stringify(args)}`);
      if (containerName) {
        console.error(`[ptyManager] Container: ${containerName}, Docker binary: ${findDockerBinary()}`);
      }
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
    // Flush all live writes immediately (synchronous file writes)
    const activeSessions = [];
    for (const [, session] of this.sessions) {
      if (session.status === 'active') {
        activeSessions.push(session);
      }
    }
    sessionHistory.flushLive(activeSessions);

    // Save all active sessions to history and kill PTYs
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
    return Promise.all(savePromises);
  }
}

// Export singleton instance
export const ptyManager = new PTYManager();
export default ptyManager;
