/**
 * PTY Session Manager
 * Manages persistent terminal sessions for AI CLI tools
 */

import * as pty from 'node-pty';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { sessionHistory } from './sessionHistory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

/**
 * Fix node-pty spawn-helper permissions.
 * On macOS (especially Apple Silicon), npm can strip the execute bit from
 * prebuilt binaries, causing "posix_spawnp failed" errors.
 * Returns true if any files were fixed.
 */
let _ptyPermissionsFixed = false;

function fixPtyPermissions() {
  if (_ptyPermissionsFixed) return false;
  _ptyPermissionsFixed = true;

  const platform = os.platform();
  if (platform === 'win32') return false;

  // Locate node-pty prebuilds relative to the project root
  const prebuildsDir = path.resolve(__dirname, '../../node_modules/node-pty/prebuilds');
  if (!fs.existsSync(prebuildsDir)) {
    console.warn('[ptyManager] node-pty prebuilds directory not found at:', prebuildsDir);
    return false;
  }

  let fixed = 0;

  try {
    const platforms = fs.readdirSync(prebuildsDir);
    for (const platformDir of platforms) {
      // Fix spawn-helper
      const spawnHelper = path.join(prebuildsDir, platformDir, 'spawn-helper');
      if (fs.existsSync(spawnHelper)) {
        try {
          fs.accessSync(spawnHelper, fs.constants.X_OK);
        } catch {
          fs.chmodSync(spawnHelper, 0o755);
          fixed++;
          console.log(`[ptyManager] Fixed permissions: ${spawnHelper}`);
        }
      }

      // Fix pty.node
      const ptyNode = path.join(prebuildsDir, platformDir, 'pty.node');
      if (fs.existsSync(ptyNode)) {
        try {
          fs.accessSync(ptyNode, fs.constants.X_OK);
        } catch {
          fs.chmodSync(ptyNode, 0o755);
          fixed++;
          console.log(`[ptyManager] Fixed permissions: ${ptyNode}`);
        }
      }
    }
  } catch (err) {
    console.warn('[ptyManager] Error scanning prebuilds:', err.message);
  }

  if (fixed > 0) {
    console.log(`[ptyManager] Fixed ${fixed} node-pty binary permission(s).`);
  }
  return fixed > 0;
}

// Ensure dtach is installed inside a container. Runs once per container name.
const _dtachChecked = new Set();

function ensureDtach(containerName) {
  if (_dtachChecked.has(containerName)) return;

  const dockerBin = findDockerBinary();
  try {
    execSync(`${dockerBin} exec ${containerName} which dtach`, {
      encoding: 'utf8', timeout: 5000, stdio: 'pipe',
    });
    // dtach exists
    _dtachChecked.add(containerName);
  } catch {
    // dtach not found — install it
    console.log(`[ptyManager] Installing dtach in container ${containerName}...`);
    try {
      execSync(
        `${dockerBin} exec -u root ${containerName} sh -c "apt-get update -qq && apt-get install -y -qq dtach"`,
        { encoding: 'utf8', timeout: 60000, stdio: 'pipe' },
      );
      console.log(`[ptyManager] ✓ dtach installed in ${containerName}`);
      _dtachChecked.add(containerName);
    } catch (err) {
      console.error(`[ptyManager] ✗ Failed to install dtach in ${containerName}:`, err.message);
    }
  }
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
      forceNew = false,
      cols = 120,
      rows = 30,
      cwd = process.env.HOME || os.homedir(),
    } = options;

    const sessionId = `session-${Date.now()}-${++this.sessionCounter}`;

    let shell, args, spawnCwd;

    if (containerName) {
      // Docker container sessions usually go through dtach so AI/main sessions
      // survive PM2 restarts. The interactive utility console intentionally uses
      // direct docker exec because tools like `gh auth login` rely on cbreak
      // single-key prompts that are more reliable without a dtach hop.
      //
      // We spawn /bin/bash and exec into docker from there, because node-pty's
      // posix_spawnp can fail on macOS when spawning docker directly (code signing).
      const dockerBin = findDockerBinary();
      const useDtach = role !== 'utility';
      if (useDtach) ensureDtach(containerName);
      // Agent sessions need unique socket paths to prevent mixing; utility sessions share one
      const socketPath = role === 'agent'
        ? `/tmp/${role}-${sessionId}.dtach`
        : `/tmp/${role}-session.dtach`;
      const workDir = cwd || '/workspace';

      // Check for existing active session for this container+role
      // ONLY reuse utility sessions, NOT agent sessions - each chat session needs its own Claude CLI
      if (role === 'utility') {
        const existingSessions = Array.from(this.sessions.values()).filter(
          s => s.containerName === containerName && s.role === role && s.status === 'active'
        );

        if (forceNew) {
          for (const existingSession of existingSessions) {
            this.killSession(existingSession.id);
            this.sessions.delete(existingSession.id);
          }

          // Utility sessions used to run through a shared dtach socket. Clean it
          // even though new utility sessions use direct docker exec, otherwise a
          // pre-upgrade stuck `gh auth login` prompt can survive in the container.
          this._cleanDtachSocket(containerName, role, sessionId);
        } else if (existingSessions.length > 0) {
          const existingSession = existingSessions[0];
          console.log(`[ptyManager] Reusing existing ${role} session for ${containerName}: ${existingSession.id}`);
          return {
            sessionId: existingSession.id,
            projectId: existingSession.projectId,
            containerName,
            role,
            reused: true,
          };
        }
      }

      // No active session - clean any orphaned dtach socket before creating new
      if (useDtach) this._cleanDtachSocket(containerName, role, sessionId);

      shell = '/bin/bash';
      args = [
        '-c',
        useDtach
          ? `exec ${dockerBin} exec -it -e TERM=xterm-256color -e COLORTERM=truecolor -e BROWSER=false -w '${workDir}' '${containerName}' dtach -A '${socketPath}' -z bash -l`
          : `exec ${dockerBin} exec -it -e TERM=xterm-256color -e COLORTERM=truecolor -e BROWSER=false -w '${workDir}' '${containerName}' bash -l`,
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
          BROWSER: 'false',
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

        // Clean up dtach socket inside container so the next session starts fresh
        if (containerName) {
          this._cleanDtachSocket(containerName, role, sessionId);
        }

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

        // Clean up terminated session from the map after a delay
        // (allows exit event to be processed by clients first)
        setTimeout(() => this.sessions.delete(sessionId), 5000);
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
      // Auto-recovery: if posix_spawnp failed, fix spawn-helper permissions and retry once
      if (error.message?.includes('posix_spawnp failed') && fixPtyPermissions()) {
        console.warn(`[ptyManager] posix_spawnp failed — fixed node-pty binary permissions. Retrying...`);
        try {
          const ptyProcess = pty.spawn(shell, args, {
            name: 'xterm-256color',
            cols,
            rows,
            cwd: spawnCwd,
            env: {
              ...process.env,
              PATH: `${process.env.PATH || ''}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/snap/bin`,
              TERM: 'xterm-256color',
              COLORTERM: 'truecolor',
              BROWSER: 'false',
            },
          });

          console.log(`[ptyManager] Retry succeeded! Session created after permission fix.`);

          const session = {
            id: sessionId,
            projectId,
            cliTool,
            containerName,
            role,
            ptyProcess,
            status: 'active',
            name: null,
            createdAt: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            history: [],
            scrollback: '',
            outputLength: 0,
            named: false,
            cols,
            rows,
          };

          ptyProcess.onData((data) => {
            session.lastActivity = new Date().toISOString();
            session.scrollback += data;
            if (session.scrollback.length > 100000) {
              session.scrollback = session.scrollback.slice(-100000);
            }
            session.outputLength += data.length;
            this.emit('data', { sessionId, data });

            if (!session.named && session.outputLength > 2000) {
              session.named = true;
              this.emit('needs-naming', { sessionId, projectId: session.projectId });
            }

            sessionHistory.writeLive(sessionId, session.scrollback, {
              projectId: session.projectId,
              role: session.role,
            });
          });

          ptyProcess.onExit(({ exitCode, signal }) => {
            session.status = 'terminated';
            session.exitCode = exitCode;
            session.signal = signal;

            // Clean up dtach socket inside container so the next session starts fresh
            if (containerName) {
              this._cleanDtachSocket(containerName, role, sessionId);
            }

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
              sessionHistory.nameWithLLM(savedEntry.id).catch(() => {});
            }).catch(err => console.warn('Failed to save session history:', err.message));

            this.emit('exit', { sessionId, exitCode, signal });

            // Clean up terminated session from the map after a delay
            setTimeout(() => this.sessions.delete(sessionId), 5000);
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
        } catch (retryError) {
          console.error(`[ptyManager] Retry also failed:`, retryError.message);
          // Fall through to the original error reporting below
        }
      }

      console.error(`[ptyManager] Failed to create PTY session:`, error.message);
      console.error(`[ptyManager] Shell: ${shell}, Args: ${JSON.stringify(args)}`);
      console.error(`[ptyManager] Platform: ${os.platform()}, Arch: ${os.arch()}`);
      if (containerName) {
        console.error(`[ptyManager] Container: ${containerName}, Docker binary: ${findDockerBinary()}`);
      }
      if (error.message?.includes('posix_spawnp failed')) {
        console.error(`[ptyManager] ──────────────────────────────────────────────────────`);
        console.error(`[ptyManager] This is likely a node-pty permission issue.`);
        console.error(`[ptyManager] Run this command to fix it manually:`);
        console.error(`[ptyManager]   chmod +x node_modules/node-pty/prebuilds/*/spawn-helper`);
        console.error(`[ptyManager] Or run:  bash scripts/fix-pty-permissions.sh`);
        console.error(`[ptyManager] ──────────────────────────────────────────────────────`);
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

      // Kill dtach session inside container so it doesn't leave a stale socket
      if (session.containerName) {
        this._cleanDtachSocket(session.containerName, session.role || 'main', sessionId);
      }

      session.ptyProcess.kill();
      session.status = 'terminated';
    }

    return true;
  }

  /**
   * Kill the dtach process and remove its socket inside a container.
   * This prevents stale dtach sessions from being reattached to.
   */
  _cleanDtachSocket(containerName, role, sessionId = null) {
    const dockerBin = findDockerBinary();
    // Agent sessions have unique socket paths; utility sessions share one
    const socketPath = (role === 'agent' && sessionId)
      ? `/tmp/${role}-${sessionId}.dtach`
      : `/tmp/${role}-session.dtach`;
    try {
      // Kill any dtach process using this socket, then remove the socket file
      execSync(
        `${dockerBin} exec ${containerName} sh -c "pkill -f 'dtach -A ${socketPath}' 2>/dev/null; rm -f '${socketPath}'"`,
        { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' },
      );
    } catch {
      // Best-effort — container may be stopped or dtach already gone
    }
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
