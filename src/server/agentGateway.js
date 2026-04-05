// src/server/agentGateway.js
//
// Architecture: Route EVERYTHING to the user's selected CLI tool (Claude, Copilot, etc.)
// Each chat session gets its own shell PTY — multiple sessions run in parallel.
// Messages within the same session are queued (not aborted).
// Local LLM: formats output + provides live "thinking trail" summaries.

import { EventEmitter } from 'events';
import { llmProvider } from './llmProvider.js';
import { chatStore } from './chatStore.js';
import { agentShellPool } from './agentShellPool.js';
import { getDB } from './db.js';

class AgentGateway extends EventEmitter {
  constructor() {
    super();
    // Track running tasks per chat session (not per project — allows parallel)
    // Map<chatSessionId, { aborted, startedAt, queue: Promise }>
    this._running = new Map();
    // Track CLI session IDs for --continue/--resume
    // Map<chatSessionId, { cliSessionId, messageCount }>
    this._cliSessions = new Map();
  }

  /**
   * Main entry point. Queues the task if one is already running for this chat session.
   */
  async handleTask({ projectId, sessionId = null, content, mode, tool = 'claude', broadcastFn }) {
    this._sessionId = sessionId;

    const existing = this._running.get(sessionId);
    if (existing && existing.queue) {
      // Queue behind the running task — don't abort it
      existing.queue = existing.queue.then(() =>
        this._executeTask({ projectId, sessionId, content, mode, tool, broadcastFn })
      );
      return existing.queue;
    }

    // No task running — execute immediately
    const promise = this._executeTask({ projectId, sessionId, content, mode, tool, broadcastFn });
    this._running.set(sessionId, { aborted: false, startedAt: Date.now(), queue: promise });
    return promise;
  }

  async _executeTask({ projectId, sessionId, content, mode, tool, broadcastFn }) {
    this._sessionId = sessionId;
    const ctx = { aborted: false, startedAt: Date.now() };
    this._running.set(sessionId, { ...ctx, queue: this._running.get(sessionId)?.queue });

    try {
      broadcastFn({ type: 'agent-status', projectId, busy: true });

      // Immediate acknowledgment — let the local LLM craft a response
      this._sendAcknowledgment(projectId, content, tool, broadcastFn);

      // Auto-name the session after first message (async, don't wait)
      this._autoNameSession(projectId, sessionId, content);

      if (mode === 'plan') {
        await this._sendToTool(projectId, sessionId, `Create a step-by-step plan for the following task. List numbered steps but do NOT execute yet:\n\n${content}`, tool, broadcastFn, ctx);
      } else {
        await this._sendToTool(projectId, sessionId, content, tool, broadcastFn, ctx);
      }
    } catch (error) {
      this._addErrorMessage(projectId, `Error: ${error.message}`, broadcastFn);
    } finally {
      this._running.delete(sessionId);
      broadcastFn({ type: 'agent-status', projectId, busy: false });
    }
  }

  /**
   * Auto-name the chat session based on the first user message.
   * Uses the local LLM to generate a short name.
   */
  async _autoNameSession(projectId, chatSessionId, userMessage) {
    if (!chatSessionId) return;

    // Only name on first message
    const cliState = this._cliSessions.get(chatSessionId);
    if (cliState?.messageCount > 0) return;

    try {
      const result = await llmProvider.generateResponse(
        `Generate a short title (3-6 words) for a chat session that starts with this message. Just the title, no quotes or punctuation.\n\nMessage: "${userMessage.slice(0, 200)}"`,
        { maxTokens: 20, temperature: 0.3 }
      );
      const name = result.response.trim().slice(0, 50);
      if (name) {
        chatStore.renameSession(projectId, chatSessionId, name);
      }
    } catch {}
  }

  /**
   * Send an immediate acknowledgment so the user knows something is happening.
   * Uses the local LLM for a natural response (async, doesn't block).
   */
  async _sendAcknowledgment(projectId, userMessage, tool, broadcastFn) {
    try {
      const result = await llmProvider.generateResponse(
        `The user just asked an AI coding assistant (${tool}) to do something. Generate a brief, friendly 1-sentence acknowledgment that you're passing their request to ${tool}. Be specific about what they asked for. No quotes.\n\nUser said: "${userMessage.slice(0, 200)}"`,
        { maxTokens: 40, temperature: 0.4 }
      );
      this._addProgressMessage(projectId, result.response.trim(), broadcastFn);
    } catch {
      this._addProgressMessage(projectId, `Sending your request to ${tool}...`, broadcastFn);
    }
  }

  // ── Profile context ──

  _getProfileContext() {
    try {
      const db = getDB();
      const p = db.data?.profile;
      if (!p || !p.setupComplete) return '';

      const parts = [];
      if (p.name) parts.push(`My name is ${p.name}.`);
      if (p.role) parts.push(`I'm a ${p.role}.`);
      if (p.languages) parts.push(`I work with: ${p.languages}.`);
      if (p.codeStyle) parts.push(`Code style: ${p.codeStyle}.`);
      if (p.tone === 'concise') parts.push('Be concise and direct.');
      if (p.tone === 'detailed') parts.push('Give thorough, detailed explanations.');
      if (p.tone === 'casual') parts.push('Keep it casual and conversational.');
      if (p.tone === 'formal') parts.push('Use a professional, structured tone.');
      if (p.preferences) parts.push(p.preferences);

      return parts.length > 0 ? parts.join(' ') + '\n\n' : '';
    } catch {
      return '';
    }
  }

  // ── Command building ──

  _buildToolCommand(tool, message, chatSessionId, projectId) {
    let cliState = this._cliSessions.get(chatSessionId);

    // Restore from disk if not in memory (survives PM2 restarts / page refreshes)
    if (!cliState?.cliSessionId && chatSessionId && projectId) {
      const stored = chatStore.getSession(projectId, chatSessionId);
      if (stored?.cliSessionId) {
        cliState = { cliSessionId: stored.cliSessionId, messageCount: stored.messageCount || 1 };
        this._cliSessions.set(chatSessionId, cliState);
        console.log(`[agentGateway] Restored CLI session_id from disk: ${stored.cliSessionId}`);
      }
    }
    const isFirstMessage = !cliState?.cliSessionId;

    const fullMessage = isFirstMessage
      ? this._getProfileContext() + message
      : message;

    const escaped = fullMessage.replace(/'/g, "'\\''");

    switch (tool) {
      case 'claude': {
        let cmd = `claude -p '${escaped}' --output-format json --dangerously-skip-permissions`;
        if (cliState?.cliSessionId) {
          cmd += ` --resume '${cliState.cliSessionId}'`;
        }
        return cmd;
      }

      case 'copilot': {
        let cmd = `copilot -p '${escaped}' --output-format json`;
        if (cliState?.cliSessionId) {
          cmd += ` --resume '${cliState.cliSessionId}'`;
        }
        return cmd;
      }

      case 'aider':
        return `aider --message '${escaped}' --yes`;

      case 'gemini':
        return `gemini -p '${escaped}'`;

      case 'shell':
      default:
        return message;
    }
  }

  // ── Main execution: send to tool and monitor output ──

  async _sendToTool(projectId, chatSessionId, message, tool, broadcastFn, ctx) {
    // Each chat session gets its own shell PTY — enables parallel execution
    let shellSessionId;
    try {
      const sess = await agentShellPool.getSession(projectId, chatSessionId || 'shell');
      shellSessionId = sess.sessionId;

      if (sess.isNew) {
        this._addProgressMessage(projectId, `Starting shell...`, broadcastFn);
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (err) {
      this._addErrorMessage(projectId, `Failed to start shell: ${err.message}`, broadcastFn);
      return;
    }

    const cliState = this._cliSessions.get(chatSessionId);
    const cmd = this._buildToolCommand(tool, message, chatSessionId, projectId);
    const isFollowUp = !!(cliState?.cliSessionId);

    // Initial thinking trail message
    this._addProgressMessage(projectId,
      isFollowUp ? `Continuing conversation with ${tool}...` : `Asking ${tool}...`,
      broadcastFn);

    // Send the command
    agentShellPool.write(shellSessionId, cmd + '\n');

    // ── Collect output until shell prompt returns ──
    // Client shows its own timer — server just collects output silently
    let totalOutput = '';
    let idleRounds = 0;
    const MAX_IDLE = 120; // 120 x 3s = 6 min max
    const POLL_MS = 3000;

    while (!ctx.aborted && idleRounds < MAX_IDLE) {
      const chunk = await this._waitForOutput(shellSessionId, ctx, POLL_MS);
      if (ctx.aborted) return;

      if (chunk.length === 0) {
        idleRounds++;
        if (idleRounds >= 2 && totalOutput.length > 0) {
          if (this._shellPromptReturned(this._stripAnsi(totalOutput))) break;
        }
        continue;
      }

      idleRounds = 0;
      totalOutput += chunk;

      const clean = this._stripAnsi(totalOutput);
      if (this._shellPromptReturned(clean)) {
        const trailing = await this._waitForOutput(shellSessionId, ctx, 1000);
        if (trailing) totalOutput += trailing;
        break;
      }

      // Fast y/n prompt detection
      const promptResponse = this._fastPromptDetect(this._stripAnsi(chunk));
      if (promptResponse !== null) {
        agentShellPool.write(shellSessionId, promptResponse + '\n');
      }
    }

    // ── Process output ──
    const cleanOutput = this._stripAnsi(totalOutput).trim();

    if (!cleanOutput) {
      this._addAgentMessage(projectId, `No response from ${tool}. Check Internal Console.`, broadcastFn, { tool });
      return;
    }

    // Extract session_id and result for tools with JSON output
    let displayOutput = cleanOutput;
    if (tool === 'claude' || tool === 'copilot') {
      const parsed = this._parseJsonToolOutput(cleanOutput, cmd);
      displayOutput = parsed.text;

      if (parsed.sessionId) {
        const newState = {
          cliSessionId: parsed.sessionId,
          messageCount: (cliState?.messageCount || 0) + 1,
        };
        this._cliSessions.set(chatSessionId, newState);
        // Persist to disk so it survives restarts
        chatStore.updateSessionMeta(projectId, chatSessionId, { cliSessionId: parsed.sessionId });
        console.log(`[agentGateway] Captured & persisted CLI session_id: ${parsed.sessionId}`);
      }
    } else {
      displayOutput = this._extractToolResponse(cleanOutput, cmd);
    }

    // Format with local LLM (or pass through if output is already clean)
    // Skip formatting if the output is short enough and already looks clean
    if (displayOutput.length < 2000 && !displayOutput.includes('\x1b')) {
      this._addAgentMessage(projectId, displayOutput, broadcastFn, { tool, rawOutput: cleanOutput.slice(-8000) });
    } else {
      try {
        const result = await llmProvider.generateResponse(
          `Clean up this terminal output for a chat UI. Rules:
- Keep ALL the content — do NOT trim, summarize, or cut anything
- Use markdown syntax: **bold**, \`code\`, - bullets, ## headers
- NEVER use HTML tags like <b>, <i>, <code> — only markdown
- Remove terminal artifacts and escape codes
- Preserve the full meaning and all details

Output:\n${displayOutput.slice(-5000)}`,
          { maxTokens: 2000, temperature: 0.1 }
        );
        this._addAgentMessage(projectId, result.response, broadcastFn, { tool, rawOutput: cleanOutput.slice(-8000) });
      } catch {
        this._addAgentMessage(projectId, displayOutput, broadcastFn, { tool, rawOutput: cleanOutput.slice(-8000) });
      }
    }
  }

  // (thinking trail removed — client handles its own timer)

  // ── JSON output parsing ──

  _parseJsonToolOutput(cleanOutput, cmd) {
    let text = '';
    let sessionId = null;

    // Strategy 1: regex for session_id and result in JSON
    const jsonMatch = cleanOutput.match(/\{"type"\s*:\s*"result"[^]*?"session_id"\s*:\s*"([^"]+)"[^]*?"result"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (jsonMatch) {
      sessionId = jsonMatch[1];
      text = jsonMatch[2].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }

    // Strategy 2: line-by-line JSON parsing
    if (!sessionId) {
      for (const line of cleanOutput.split('\n')) {
        const trimmed = line.trim();
        const jsonStart = trimmed.indexOf('{');
        if (jsonStart >= 0) {
          try {
            const json = JSON.parse(trimmed.slice(jsonStart));
            if (json.session_id) sessionId = json.session_id;
            if (json.result) text = json.result;
            break;
          } catch {}
        }
      }
    }

    if (!text) {
      text = this._extractToolResponse(cleanOutput, cmd);
    }

    return { text, sessionId };
  }

  // ── Shell detection ──

  _shellPromptReturned(cleanText) {
    const lines = cleanText.split('\n').filter(l => l.trim());
    if (lines.length === 0) return false;
    const lastLine = lines[lines.length - 1].trim();
    if (/[$#]\s*$/.test(lastLine) && lastLine.length > 1) return true;
    if (/>\s*$/.test(lastLine) && lastLine.includes(':')) return true;
    return false;
  }

  _fastPromptDetect(text) {
    const lastBit = text.slice(-500);
    if (/\[Y\/n\]/i.test(lastBit)) return 'Y';
    if (/\[y\/N\]/i.test(lastBit)) return 'y';
    if (/\(y\/n\)/i.test(lastBit)) return 'y';
    if (/\[Yes\].*\[No\]/i.test(lastBit)) return 'Yes';
    if (/Allow.*\?\s*$/i.test(lastBit)) return 'y';
    if (/Approve.*\?\s*$/i.test(lastBit)) return 'y';
    if (/Continue\?\s*$/i.test(lastBit)) return '';
    if (/Press Enter/i.test(lastBit)) return '';
    if (/trust.*project/i.test(lastBit)) return 'y';
    if (/Do you want to/i.test(lastBit)) return 'y';
    if (/Would you like to/i.test(lastBit)) return 'y';
    return null;
  }

  _extractToolResponse(cleanOutput, cmd) {
    let lines = cleanOutput.split('\n');
    const cmdBase = cmd.split("'")[0].trim();
    const startIdx = lines.findIndex(l => l.includes(cmdBase));
    if (startIdx >= 0) lines = lines.slice(startIdx + 1);

    while (lines.length > 0) {
      const last = lines[lines.length - 1].trim();
      if (/[$#>]\s*$/.test(last) && last.length > 1) lines.pop();
      else if (!last) lines.pop();
      else break;
    }

    return lines.join('\n').trim() || cleanOutput;
  }

  _waitForOutput(sessionId, ctx, quietMs = 3000) {
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

  _stripAnsi(text) {
    return text
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b[()][A-Z0-9]/g, '')
      .replace(/\r/g, '');
  }

  // ── Plan execution ──

  async executePlan({ projectId, sessionId = null, steps, tool = 'claude', broadcastFn }) {
    this._sessionId = sessionId;
    const ctx = { aborted: false, startedAt: Date.now() };
    this._running.set(sessionId, { ...ctx, queue: null });

    try {
      broadcastFn({ type: 'agent-status', projectId, busy: true });

      for (let i = 0; i < steps.length && !ctx.aborted; i++) {
        const step = steps[i];
        const tasks = steps.map((s, j) => ({
          title: s.title,
          status: j < i ? 'done' : j === i ? 'running' : 'pending',
        }));
        this._addProgressMessage(projectId, `Step ${i + 1}/${steps.length}: ${step.title}`, broadcastFn, tasks);

        await this._sendToTool(projectId, sessionId, step.prompt, tool, broadcastFn, ctx);
        if (ctx.aborted) break;
      }

      if (!ctx.aborted) {
        const tasks = steps.map(s => ({ title: s.title, status: 'done' }));
        this._addAgentMessage(projectId, 'Plan completed.', broadcastFn, { tasks });
      }
    } catch (error) {
      this._addErrorMessage(projectId, `Plan failed: ${error.message}`, broadcastFn);
    } finally {
      this._running.delete(sessionId);
      broadcastFn({ type: 'agent-status', projectId, busy: false });
    }
  }

  // ── Abort ──

  abort(sessionId) {
    const entry = this._running.get(sessionId);
    if (entry) entry.aborted = true;
  }

  // ── Message helpers ──

  _addAgentMessage(projectId, content, broadcastFn, metadata = null) {
    const sessionId = this._sessionId;
    const msg = chatStore.addMessage({ projectId, sessionId, role: 'agent', content, metadata });
    broadcastFn({ type: 'chat-message', message: msg });
  }

  _addProgressMessage(projectId, content, broadcastFn, tasks = null) {
    const sessionId = this._sessionId;
    const msg = chatStore.addMessage({ projectId, sessionId, role: 'progress', content, metadata: { tasks, live: true } });
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
