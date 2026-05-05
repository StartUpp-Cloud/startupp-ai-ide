import { ptyManager } from './ptyManager.js';
import { EventEmitter } from 'events';

class AgentShellPool extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map(); // key -> { sessionId, projectId, tool, createdAt }
    this.outputBuffers = new Map(); // sessionId -> string (last 20KB)
    this.shellToChat = new Map(); // shellSessionId -> { projectId, chatSessionId }

    // Listen directly to ptyManager data events — reliable, no dynamic imports needed
    ptyManager.on('data', ({ sessionId, data }) => {
      this.feedOutput(sessionId, data);
    });
  }

  _key(projectId, tool) {
    return `${projectId}:${tool || 'shell'}`;
  }

  async getSession(projectId, tool = 'shell', cwdOverride = null) {
    const key = this._key(projectId, tool);
    const existing = this.sessions.get(key);

    if (existing) {
      const session = ptyManager.getSession(existing.sessionId);
      const cwdChanged = (cwdOverride || null) !== (existing.cwdOverride || null);
      if (session && session.status === 'active' && !cwdChanged) {
        console.log(`[agentShellPool] Reusing session ${existing.sessionId} for ${key}`);
        return { sessionId: existing.sessionId, isNew: false };
      }
      if (cwdChanged) {
        console.log(`[agentShellPool] CWD changed for ${key} (${existing.cwdOverride} -> ${cwdOverride}), creating new session`);
      } else {
        console.log(`[agentShellPool] Session ${existing.sessionId} is ${session?.status || 'gone'}, creating new for ${key}`);
      }
      this.sessions.delete(key);
      this.outputBuffers.delete(existing.sessionId);
    }

    const { default: Project } = await import('./models/Project.js');
    const project = Project.findById(projectId);
    let containerName = null;
    let workingDir = null;

    if (project?.containerName) {
      containerName = project.containerName;
      const { containerManager } = await import('./containerManager.js');
      const status = containerManager.getContainerStatus(containerName);
      if (!status) throw new Error(`Container ${containerName} does not exist`);
      if (status !== 'running') {
        const started = containerManager.startContainer(containerName);
        if (!started) throw new Error(`Failed to start container ${containerName}`);
      }
      // Use worktree path override if provided (branch-per-session)
      workingDir = cwdOverride || containerManager.getWorkDir(containerName) || '/workspace';
      // Verify the CWD exists in the container — attempt to re-create worktree if missing
      if (workingDir !== '/workspace') {
        const exists = containerManager.execInContainer(containerName,
          `test -d '${workingDir}' && echo yes`,
          { timeout: 3000 },
        )?.trim();
        if (exists !== 'yes') {
          console.log(`[agentShellPool] CWD '${workingDir}' does not exist, attempting to re-create worktree...`);
          // Try to re-create: extract branch name from path (/workspace/.worktrees/<branch>)
          const branchName = workingDir.split('/').pop();
          if (branchName && workingDir.includes('.worktrees')) {
            try {
              const repoRoot = containerManager.execInContainer(containerName,
                `find /workspace -maxdepth 2 -name .git -print -quit 2>/dev/null`,
                { timeout: 5000 },
              )?.trim()?.replace(/\/.git$/, '') || '/workspace';
              containerManager.execInContainer(containerName, `mkdir -p /workspace/.worktrees`, { timeout: 3000 });
              // Try local branch first, then remote
              const addResult = containerManager.execInContainer(containerName,
                `cd '${repoRoot}' && (git worktree add '${workingDir}' '${branchName}' 2>/dev/null || git worktree add '${workingDir}' -b '${branchName}' 'origin/${branchName}' 2>/dev/null)`,
                { timeout: 15000 },
              );
              const recreated = containerManager.execInContainer(containerName,
                `test -d '${workingDir}' && echo yes`, { timeout: 3000 },
              )?.trim() === 'yes';
              if (recreated) {
                console.log(`[agentShellPool] Successfully re-created worktree at ${workingDir}`);
              } else {
                console.log(`[agentShellPool] Failed to re-create worktree, falling back to /workspace`);
                workingDir = '/workspace';
              }
            } catch (e) {
              console.log(`[agentShellPool] Worktree re-creation error: ${e.message}, falling back to /workspace`);
              workingDir = '/workspace';
            }
          } else {
            workingDir = '/workspace';
          }
        }
      }
    } else if (project?.folderPath) {
      workingDir = cwdOverride || project.folderPath;
    }

    const result = ptyManager.createSession({
      projectId,
      cliTool: tool === 'shell' ? null : tool,
      containerName,
      role: 'agent',
      cols: 120,
      rows: 30,
      cwd: workingDir,
    });

    this.sessions.set(key, {
      sessionId: result.sessionId,
      projectId,
      tool,
      cwdOverride: cwdOverride || null,
      createdAt: new Date().toISOString(),
    });
    this.outputBuffers.set(result.sessionId, '');
    // Track reverse mapping: shell session -> chat session info
    this.shellToChat.set(result.sessionId, { projectId, chatSessionId: tool === 'shell' ? null : tool });

    if (tool && tool !== 'shell') {
      setTimeout(() => {
        try { ptyManager.startCLI(result.sessionId, tool); } catch {}
      }, 300);
    }

    return { sessionId: result.sessionId, isNew: true };
  }

  write(sessionId, data) {
    return ptyManager.write(sessionId, data);
  }

  feedOutput(sessionId, data) {
    const buf = this.outputBuffers.get(sessionId);
    if (buf !== undefined) {
      const combined = buf + data;
      this.outputBuffers.set(sessionId, combined.slice(-20480));
      // Include chat session info for UI matching
      const chatInfo = this.shellToChat.get(sessionId) || {};
      this.emit('output', { sessionId, data, projectId: chatInfo.projectId, chatSessionId: chatInfo.chatSessionId });
    }
  }

  getRecentOutput(sessionId) {
    return this.outputBuffers.get(sessionId) || '';
  }

  killProjectSessions(projectId) {
    for (const [key, entry] of this.sessions) {
      if (entry.projectId === projectId) {
        ptyManager.killSession(entry.sessionId);
        this.sessions.delete(key);
        this.outputBuffers.delete(entry.sessionId);
        this.shellToChat.delete(entry.sessionId);
      }
    }
  }

  killSession(sessionId) {
    for (const [key, entry] of this.sessions) {
      if (entry.sessionId === sessionId) {
        ptyManager.killSession(sessionId);
        this.sessions.delete(key);
        this.outputBuffers.delete(sessionId);
        this.shellToChat.delete(sessionId);
        return;
      }
    }
  }
}

export const agentShellPool = new AgentShellPool();
export default agentShellPool;
