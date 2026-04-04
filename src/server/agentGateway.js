// src/server/agentGateway.js
//
// Architecture: Route EVERYTHING to the user's selected CLI tool (Claude, Copilot, etc.)
// The tool is the brain — it handles questions, coding, research, everything.
// Local LLM only: formats raw terminal output into chat-friendly messages,
// auto-responds to y/n prompts, manages sessions.

import { EventEmitter } from 'events';
import { llmProvider } from './llmProvider.js';
import { chatStore } from './chatStore.js';
import { agentShellPool } from './agentShellPool.js';

class AgentGateway extends EventEmitter {
  constructor() {
    super();
    this._running = new Map();
  }

  /**
   * Main entry point. Routes the user's message to their selected CLI tool.
   * @param {string} tool - CLI tool to use: 'claude', 'copilot', 'aider', 'shell'
   */
  async handleTask({ projectId, sessionId = null, content, mode, tool = 'claude', broadcastFn }) {
    this._abort(projectId);
    this._sessionId = sessionId;

    const ctx = { aborted: false };
    this._running.set(projectId, ctx);

    try {
      broadcastFn({ type: 'agent-status', projectId, busy: true });

      if (mode === 'plan') {
        // In plan mode, ask the tool to make a plan first
        await this._sendToTool(projectId, `Create a step-by-step plan for the following task. List numbered steps but do NOT execute yet:\n\n${content}`, tool, broadcastFn, ctx);
      } else {
        // Agent mode: send directly to the tool
        await this._sendToTool(projectId, content, tool, broadcastFn, ctx);
      }
    } catch (error) {
      this._addErrorMessage(projectId, `Error: ${error.message}`, broadcastFn);
    } finally {
      this._finish(projectId, broadcastFn);
    }
  }

  /**
   * Send a message to the selected CLI tool and monitor the response.
   */
  async _sendToTool(projectId, message, tool, broadcastFn, ctx) {
    // Get or create a session for this tool
    let cliSessionId;
    try {
      const sess = await agentShellPool.getSession(projectId, tool);
      cliSessionId = sess.sessionId;

      if (sess.isNew) {
        this._addProgressMessage(projectId, `Starting ${tool}...`, broadcastFn);
        // Give the CLI tool time to initialize
        await new Promise(r => setTimeout(r, tool === 'shell' ? 500 : 4000));
      }
    } catch (err) {
      this._addErrorMessage(projectId, `Failed to start ${tool}: ${err.message}`, broadcastFn);
      return;
    }

    this._addProgressMessage(projectId, `Sending to ${tool}...`, broadcastFn);

    // Send the message
    agentShellPool.write(cliSessionId, message + '\n');

    // Monitor output, auto-respond to prompts, detect completion
    let totalOutput = '';
    let idleRounds = 0;
    const MAX_IDLE = 60; // 60 x 2s = 2 min max silence before giving up
    const POLL_MS = 2000;

    while (!ctx.aborted && idleRounds < MAX_IDLE) {
      const chunk = await this._waitForOutput(cliSessionId, ctx, POLL_MS);
      if (ctx.aborted) return;

      if (chunk.length === 0) {
        idleRounds++;
        // After 10 idle rounds (20s), give a progress update
        if (idleRounds === 10) {
          this._addProgressMessage(projectId, `${tool} is still working...`, broadcastFn);
        }
        continue;
      }

      idleRounds = 0;
      totalOutput += chunk;

      // Auto-respond to confirmation prompts (y/n, continue, approve, etc.)
      try {
        const { autoResponder } = await import('./autoResponder.js');
        const promptMatch = autoResponder.detectPrompt?.(chunk, tool);
        if (promptMatch) {
          const response = promptMatch.defaultResponse || 'y';
          agentShellPool.write(cliSessionId, response + '\n');
          this._addProgressMessage(projectId, `Auto-approved: ${response}`, broadcastFn);
          continue; // Don't check for completion yet — more output coming
        }
      } catch {}

      // Check if the tool is done (shell prompt returned or tool-specific markers)
      const clean = chunk.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
      if (this._looksComplete(clean, tool)) {
        break;
      }
    }

    // Format and present the result
    const cleanOutput = totalOutput.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();

    if (!cleanOutput) {
      this._addAgentMessage(projectId,
        `Sent to ${tool} — no response received. The tool may still be processing. Check Internal Console for details.`,
        broadcastFn, { tool });
      return;
    }

    // Use local LLM to create a friendly summary
    try {
      const result = await llmProvider.generateResponse(
        `You are formatting terminal output from "${tool}" for a developer chat UI.\n\nUser's message: "${message}"\n\nTool output:\n${cleanOutput.slice(-4000)}\n\nCreate a concise, helpful response. Include key results, file changes, errors, or answers. Use markdown for readability. If the output is a simple answer, just give the answer.`,
        { maxTokens: 500, temperature: 0.1 }
      );
      this._addAgentMessage(projectId, result.response, broadcastFn, { tool, rawOutput: cleanOutput.slice(-8000) });
    } catch {
      // Local LLM failed — show cleaned output directly
      const truncated = cleanOutput.length > 3000
        ? '...\n' + cleanOutput.slice(-3000)
        : cleanOutput;
      this._addAgentMessage(projectId, `**${tool} output:**\n\`\`\`\n${truncated}\n\`\`\``, broadcastFn, { tool, rawOutput: cleanOutput.slice(-8000) });
    }
  }

  /**
   * Heuristic: does the output look like the tool finished?
   */
  _looksComplete(text, tool) {
    const lastLine = text.split('\n').filter(l => l.trim()).pop() || '';

    // Shell prompt returned
    if (/[$#>]\s*$/.test(lastLine)) return true;

    // Claude Code specific completion markers
    if (tool === 'claude') {
      if (/^[>❯]\s*$/.test(lastLine)) return true; // Claude's prompt
      if (lastLine.includes('Cost:') && lastLine.includes('tokens')) return true;
    }

    // Copilot specific
    if (tool === 'copilot') {
      if (/^>\s*$/.test(lastLine)) return true;
    }

    return false;
  }

  // ── Plan execution ──

  async executePlan({ projectId, sessionId = null, steps, tool = 'claude', broadcastFn }) {
    this._abort(projectId);
    this._sessionId = sessionId;
    const ctx = { aborted: false };
    this._running.set(projectId, ctx);

    try {
      broadcastFn({ type: 'agent-status', projectId, busy: true });

      for (let i = 0; i < steps.length && !ctx.aborted; i++) {
        const step = steps[i];
        const tasks = steps.map((s, j) => ({
          title: s.title,
          status: j < i ? 'done' : j === i ? 'running' : 'pending',
        }));
        this._addProgressMessage(projectId, `Step ${i + 1}/${steps.length}: ${step.title}`, broadcastFn, tasks);

        await this._sendToTool(projectId, step.prompt, tool, broadcastFn, ctx);
        if (ctx.aborted) break;
      }

      if (!ctx.aborted) {
        const tasks = steps.map(s => ({ title: s.title, status: 'done' }));
        this._addAgentMessage(projectId, 'Plan completed.', broadcastFn, { tasks });
      }
    } catch (error) {
      this._addErrorMessage(projectId, `Plan failed: ${error.message}`, broadcastFn);
    } finally {
      this._finish(projectId, broadcastFn);
    }
  }

  // ── Helpers ──

  _abort(projectId) {
    const ctx = this._running.get(projectId);
    if (ctx) ctx.aborted = true;
    this._running.delete(projectId);
  }

  _finish(projectId, broadcastFn) {
    this._running.delete(projectId);
    broadcastFn({ type: 'agent-status', projectId, busy: false });
  }

  _waitForOutput(sessionId, ctx, quietMs = 2000) {
    return new Promise((resolve) => {
      let timeout;
      let output = '';
      const handler = ({ sessionId: sid, data }) => {
        if (sid !== sessionId || ctx.aborted) return;
        output += data;
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          agentShellPool.removeListener('output', handler);
          resolve(output);
        }, quietMs);
      };
      agentShellPool.on('output', handler);
      timeout = setTimeout(() => {
        agentShellPool.removeListener('output', handler);
        resolve(output);
      }, quietMs);
    });
  }

  _addAgentMessage(projectId, content, broadcastFn, metadata = null) {
    const sessionId = this._sessionId;
    const msg = chatStore.addMessage({ projectId, sessionId, role: 'agent', content, metadata });
    broadcastFn({ type: 'chat-message', message: msg });
  }

  _addProgressMessage(projectId, content, broadcastFn, tasks = null) {
    const sessionId = this._sessionId;
    const msg = chatStore.addMessage({ projectId, sessionId, role: 'progress', content, metadata: { tasks } });
    broadcastFn({ type: 'chat-progress', projectId, message: msg });
  }

  _addErrorMessage(projectId, content, broadcastFn) {
    const sessionId = this._sessionId;
    const msg = chatStore.addMessage({ projectId, sessionId, role: 'error', content });
    broadcastFn({ type: 'chat-message', message: msg });
  }
}

export const agentGateway = new AgentGateway();
export default agentGateway;
