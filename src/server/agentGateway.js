// src/server/agentGateway.js
//
// Architecture: Route EVERYTHING to the user's selected CLI tool (Claude, Copilot, etc.)
// The tool is the brain — it handles questions, coding, research, everything.
// Local LLM only: formats raw terminal output into chat-friendly messages.
//
// Context strategy:
// - Claude: uses --continue to maintain conversation across messages in the same session
//           uses --resume <id> to return to a previous session
//           uses --output-format json to capture session_id for --resume
// - CLAUDE.md: loaded automatically by Claude for persistent project context
// - Other tools: context managed per their native mechanisms

import { EventEmitter } from 'events';
import { llmProvider } from './llmProvider.js';
import { chatStore } from './chatStore.js';
import { agentShellPool } from './agentShellPool.js';
import { getDB } from './db.js';

class AgentGateway extends EventEmitter {
  constructor() {
    super();
    this._running = new Map();
    // Track CLI session IDs per chat session for --continue/--resume
    // Map<chatSessionId, { cliSessionId, messageCount }>
    this._cliSessions = new Map();
  }

  /**
   * Main entry point. Routes the user's message to their selected CLI tool.
   */
  async handleTask({ projectId, sessionId = null, content, mode, tool = 'claude', broadcastFn }) {
    this._abort(projectId);
    this._sessionId = sessionId;

    const ctx = { aborted: false, startedAt: Date.now() };
    this._running.set(projectId, ctx);

    try {
      broadcastFn({ type: 'agent-status', projectId, busy: true });

      if (mode === 'plan') {
        await this._sendToTool(projectId, sessionId, `Create a step-by-step plan for the following task. List numbered steps but do NOT execute yet:\n\n${content}`, tool, broadcastFn, ctx);
      } else {
        await this._sendToTool(projectId, sessionId, content, tool, broadcastFn, ctx);
      }
    } catch (error) {
      this._addErrorMessage(projectId, `Error: ${error.message}`, broadcastFn);
    } finally {
      this._finish(projectId, broadcastFn);
    }
  }

  /**
   * Build the profile context string for the first message in a conversation.
   * Loaded from db.json profile field.
   */
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

  /**
   * Build the shell command to invoke a CLI tool in non-interactive/print mode.
   * Handles conversation continuation and profile context injection.
   */
  _buildToolCommand(tool, message, chatSessionId) {
    const cliState = this._cliSessions.get(chatSessionId);
    const isFirstMessage = !cliState?.cliSessionId;

    // Prepend profile context on first message only — tool remembers it for follow-ups
    const fullMessage = isFirstMessage
      ? this._getProfileContext() + message
      : message;

    const escaped = fullMessage.replace(/'/g, "'\\''");

    switch (tool) {
      case 'claude': {
        // Claude: -p for print mode, --output-format json to capture session_id
        // --resume to continue a previous conversation with full context
        let cmd = `claude -p '${escaped}' --output-format json`;
        if (cliState?.cliSessionId) {
          cmd += ` --resume '${cliState.cliSessionId}'`;
        }
        return cmd;
      }

      case 'copilot': {
        // Copilot CLI: -p for print mode, --output-format json to capture session_id
        // --resume to continue conversation (same pattern as Claude)
        let cmd = `copilot -p '${escaped}' --output-format json`;
        if (cliState?.cliSessionId) {
          cmd += ` --resume '${cliState.cliSessionId}'`;
        }
        return cmd;
      }

      case 'aider':
        // Aider: --message for non-interactive, --yes to auto-approve
        // No session resume — context comes from git history + repo map
        return `aider --message '${escaped}' --yes`;

      case 'gemini':
        // Gemini CLI: -p for print mode (if available)
        return `gemini -p '${escaped}'`;

      case 'shell':
      default:
        return message;
    }
  }

  /**
   * Send a message to the selected CLI tool and monitor the response.
   */
  async _sendToTool(projectId, chatSessionId, message, tool, broadcastFn, ctx) {
    let shellSessionId;
    try {
      const sess = await agentShellPool.getSession(projectId, 'shell');
      shellSessionId = sess.sessionId;

      if (sess.isNew) {
        this._addProgressMessage(projectId, `Starting shell...`, broadcastFn);
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (err) {
      this._addErrorMessage(projectId, `Failed to start shell: ${err.message}`, broadcastFn);
      return;
    }

    const cmd = this._buildToolCommand(tool, message, chatSessionId);
    const cliState = this._cliSessions.get(chatSessionId);
    const isFollowUp = !!(cliState?.cliSessionId);

    this._addProgressMessage(projectId,
      `Running ${tool}${isFollowUp ? ' (continuing conversation)' : ''}...`,
      broadcastFn);

    // Send the command
    agentShellPool.write(shellSessionId, cmd + '\n');

    // ── Collect output with live progress streaming ──
    let totalOutput = '';
    let idleRounds = 0;
    const MAX_IDLE = 90;
    const POLL_MS = 3000;
    let lastProgressUpdate = 0;
    const PROGRESS_INTERVAL_MS = 8000; // Update progress every 8s of new output

    while (!ctx.aborted && idleRounds < MAX_IDLE) {
      const chunk = await this._waitForOutput(shellSessionId, ctx, POLL_MS);
      if (ctx.aborted) return;

      if (chunk.length === 0) {
        idleRounds++;

        // While idle, periodically show what we have so far
        if (idleRounds >= 2 && totalOutput.length > 0) {
          const clean = this._stripAnsi(totalOutput);
          if (this._shellPromptReturned(clean)) break;

          // Show live progress if enough time passed
          const now = Date.now();
          if (now - lastProgressUpdate > PROGRESS_INTERVAL_MS) {
            lastProgressUpdate = now;
            const snippet = this._getOutputSnippet(clean);
            if (snippet) {
              this._updateLiveProgress(projectId, tool, snippet, broadcastFn);
            }
          }
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
        this._addProgressMessage(projectId, `Auto: "${promptResponse || '(enter)'}"`, broadcastFn);
        continue;
      }

      // Live progress update — show what's happening as it happens
      const now = Date.now();
      if (now - lastProgressUpdate > PROGRESS_INTERVAL_MS) {
        lastProgressUpdate = now;
        const snippet = this._getOutputSnippet(clean);
        if (snippet) {
          this._updateLiveProgress(projectId, tool, snippet, broadcastFn);
        }
      }
    }

    // ── Process output ──
    const cleanOutput = this._stripAnsi(totalOutput).trim();

    if (!cleanOutput) {
      this._addAgentMessage(projectId, `No response from ${tool}. Check Internal Console.`, broadcastFn, { tool });
      return;
    }

    // For tools with JSON output (Claude, Copilot): extract session_id and result
    let displayOutput = cleanOutput;
    if (tool === 'claude' || tool === 'copilot') {
      const parsed = this._parseJsonToolOutput(cleanOutput, cmd);
      displayOutput = parsed.text;

      // Save CLI session ID for --resume on next message (conversation continuation)
      if (parsed.sessionId) {
        this._cliSessions.set(chatSessionId, {
          cliSessionId: parsed.sessionId,
          messageCount: (cliState?.messageCount || 0) + 1,
        });
      }
    } else {
      displayOutput = this._extractToolResponse(cleanOutput, cmd);
    }

    // Use LLM to format as markdown (format only, never rewrite)
    try {
      const result = await llmProvider.generateResponse(
        `Format this terminal output as clean markdown. Keep the EXACT content — only clean up terminal artifacts and add markdown formatting (bold, code blocks, bullets). Never change the meaning.\n\nOutput:\n${displayOutput.slice(-3000)}`,
        { maxTokens: 500, temperature: 0.1 }
      );
      this._addAgentMessage(projectId, result.response, broadcastFn, { tool, rawOutput: cleanOutput.slice(-8000) });
    } catch {
      this._addAgentMessage(projectId, displayOutput, broadcastFn, { tool, rawOutput: cleanOutput.slice(-8000) });
    }
  }

  /**
   * Parse JSON output from CLI tools (Claude, Copilot) to extract session_id and result text.
   * Expected format: {"type":"result","session_id":"...","result":"..."}
   */
  _parseJsonToolOutput(cleanOutput, cmd) {
    // The output contains the command echo, possibly multiple JSON lines, and a shell prompt
    const lines = cleanOutput.split('\n');
    let text = '';
    let sessionId = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Try to parse as JSON (Claude's output format)
      if (trimmed.startsWith('{')) {
        try {
          const json = JSON.parse(trimmed);
          if (json.session_id) sessionId = json.session_id;
          if (json.result) text = json.result;
          if (json.type === 'result' && json.result) text = json.result;
          continue;
        } catch {}
      }
    }

    // If we couldn't parse JSON, fall back to extracting text
    if (!text) {
      text = this._extractToolResponse(cleanOutput, cmd);
    }

    return { text, sessionId };
  }

  // ── Live progress helpers ──

  /**
   * Extract a meaningful snippet from the output so far.
   * Shows the last few non-empty lines (skipping command echo and prompts).
   */
  _getOutputSnippet(cleanOutput) {
    const lines = cleanOutput.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('claude ') && !l.startsWith('copilot ') && !/[$#>]\s*$/.test(l));

    if (lines.length === 0) return null;

    // Take last 6 meaningful lines
    const recent = lines.slice(-6);
    // Truncate each line to 120 chars
    return recent.map(l => l.length > 120 ? l.slice(0, 117) + '...' : l).join('\n');
  }

  /**
   * Broadcast a live progress update that replaces the previous progress message.
   * Uses chat-progress type which the UI replaces in-place.
   */
  _updateLiveProgress(projectId, tool, snippet, broadcastFn) {
    const elapsed = this._running.get(projectId)?.startedAt
      ? Math.round((Date.now() - this._running.get(projectId).startedAt) / 1000)
      : null;

    const timeLabel = elapsed ? ` (${elapsed}s)` : '';
    const content = `**${tool}** working${timeLabel}...\n\n\`\`\`\n${snippet}\n\`\`\``;

    // Use progress message type — UI replaces the last one in-place
    const sessionId = this._sessionId;
    const msg = chatStore.addMessage({ projectId, sessionId, role: 'progress', content, metadata: { live: true } });
    broadcastFn({ type: 'chat-progress', projectId, message: msg });
  }

  // ── Shell prompt detection ──

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
