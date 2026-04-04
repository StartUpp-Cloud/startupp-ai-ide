import { ptyManager } from './ptyManager.js';
import { EventEmitter } from 'events';

class AgentShellPool extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map(); // key -> { sessionId, projectId, tool, createdAt }
    this.outputBuffers = new Map(); // sessionId -> string (last 20KB)
  }

  _key(projectId, tool) {
    return `${projectId}:${tool || 'shell'}`;
  }

  async getSession(projectId, tool = 'shell') {
    const key = this._key(projectId, tool);
    const existing = this.sessions.get(key);

    if (existing) {
      const session = ptyManager.getSession(existing.sessionId);
      if (session && session.status === 'active') {
        return { sessionId: existing.sessionId, isNew: false };
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
      workingDir = containerManager.getWorkDir(containerName) || '/workspace';
    } else if (project?.folderPath) {
      workingDir = project.folderPath;
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
      createdAt: new Date().toISOString(),
    });
    this.outputBuffers.set(result.sessionId, '');

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
      this.emit('output', { sessionId, data });
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
      }
    }
  }

  killSession(sessionId) {
    for (const [key, entry] of this.sessions) {
      if (entry.sessionId === sessionId) {
        ptyManager.killSession(sessionId);
        this.sessions.delete(key);
        this.outputBuffers.delete(sessionId);
        return;
      }
    }
  }
}

export const agentShellPool = new AgentShellPool();
export default agentShellPool;
