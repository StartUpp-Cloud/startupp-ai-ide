// src/server/agentGateway.js
//
// Architecture: Smart routing based on local LLM capability.
//
// Ollama (weak): Everything goes to Claude/Copilot, local LLM only formats output.
//
// GitHub/OpenAI/DeepSeek (capable): Local LLM acts as orchestrator.
//   - Questions it can answer → answers directly with full context
//   - Coding tasks / architecture → routes to Claude with --resume
//   - Shell commands → generates and executes them
//
// Each chat session gets its own shell PTY — multiple sessions run in parallel.
// Messages within the same session are queued (not aborted).

import { EventEmitter } from 'events';
import { llmProvider } from './llmProvider.js';
import { chatStore } from './chatStore.js';
import { agentShellPool } from './agentShellPool.js';
import { getDB } from './db.js';

class AgentGateway extends EventEmitter {
  constructor() {
    super();
    this._running = new Map();
    this._cliSessions = new Map();
  }

  // ── Entry point ──

  async handleTask({ projectId, sessionId = null, content, mode, tool = 'claude', broadcastFn }) {
    this._sessionId = sessionId;

    const existing = this._running.get(sessionId);
    if (existing && existing.queue) {
      existing.queue = existing.queue.then(() =>
        this._executeTask({ projectId, sessionId, content, mode, tool, broadcastFn })
      );
      return existing.queue;
    }

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

      // Auto-name session on first message (async, don't wait)
      this._autoNameSession(projectId, sessionId, content);

      const provider = llmProvider.getSettings().provider;
      const isCapable = provider !== 'ollama';

      if (isCapable) {
        // Smart routing: local LLM decides how to handle the request
        await this._smartRoute(projectId, sessionId, content, mode, tool, broadcastFn, ctx);
      } else {
        // Dumb routing: everything goes to the CLI tool
        this._addProgressMessage(projectId, `Sending to ${tool}...`, broadcastFn);
        await this._sendToCliTool(projectId, sessionId, content, tool, broadcastFn, ctx);
      }
    } catch (error) {
      this._addErrorMessage(projectId, `Error: ${error.message}`, broadcastFn);
    } finally {
      this._running.delete(sessionId);
      broadcastFn({ type: 'agent-status', projectId, busy: false });
    }
  }

  // ── Smart routing (capable local LLM) ──

  async _smartRoute(projectId, sessionId, content, mode, tool, broadcastFn, ctx) {
    // Build rich context for the local LLM
    const context = this._buildContext(projectId, sessionId, content);

    // Ask the local LLM to classify and potentially answer
    try {
      const result = await llmProvider.generateResponse(
        `${context}

USER MESSAGE: "${content}"

You are an AI orchestrator in a coding IDE. Decide how to handle this message.

RESPOND with exactly ONE of these formats (first line must be the keyword):

ANSWER:
<your direct answer in markdown>
(Use this for: general questions, explanations, how-to, status inquiries, advice, conversation)

COMMAND:
<shell command to run>
(Use this for: when the user wants to run something, check something in the terminal, install packages)

DELEGATE:
<message to send to ${tool}>
(Use this for: code changes, file edits, architecture work, debugging, complex analysis that needs codebase access, planning features)

RULES:
- ANSWER directly if you can answer from context (project info, conversation history, general knowledge)
- COMMAND only for simple info-gathering commands: git status, ls, cat, grep, df, ps, pwd, which, node -v
- DELEGATE to ${tool} for EVERYTHING else: deployments, builds, tests, code changes, installs, fixes, debugging, architecture, planning, npm/pnpm scripts, any multi-step task
- When in doubt, ALWAYS DELEGATE — ${tool} has full codebase access and can execute complex tasks safely
- NEVER use COMMAND for destructive or complex operations (deploy, build, rm, install)
- NEVER return [NEEDS_USER_CONFIRMATION] — either ANSWER, COMMAND, or DELEGATE
- For ANSWER, use markdown formatting
- For COMMAND, give the exact simple command to run
- For DELEGATE, pass the user's request as-is to ${tool}`,
        { maxTokens: 1500, temperature: 0.2 }
      );

      const response = result.response.trim();
      const firstLine = response.split('\n')[0].trim().toUpperCase();
      const body = response.slice(response.indexOf('\n') + 1).trim();

      if (firstLine.startsWith('ANSWER')) {
        this._addProgressMessage(projectId, `Analyzing your question — I can answer this directly.`, broadcastFn);
        this._addAgentMessage(projectId, body || response, broadcastFn, { tool: 'local' });

      } else if (firstLine.startsWith('COMMAND')) {
        const cmd = body;
        const looksValid = cmd && !cmd.includes('[') && !cmd.includes('NEEDS') && cmd.length < 200;
        if (looksValid) {
          this._addProgressMessage(projectId, `Running shell command: \`${cmd}\``, broadcastFn);
          await this._runShellCommand(projectId, sessionId, cmd, content, broadcastFn, ctx);
        } else {
          this._addProgressMessage(projectId, `This needs ${tool} — delegating your request...`, broadcastFn);
          await this._sendToCliTool(projectId, sessionId, content, tool, broadcastFn, ctx);
        }

      } else if (firstLine.startsWith('DELEGATE')) {
        this._addProgressMessage(projectId, `This needs ${tool}'s codebase access — delegating...`, broadcastFn);
        // Always pass the user's original message — not the LLM's reformulation
        await this._sendToCliTool(projectId, sessionId, content, tool, broadcastFn, ctx);

      } else {
        // Unrecognized format — delegate to tool if it looks like garbage/error
        const isGarbage = response.includes('NEEDS_USER') || response.includes('[') || response.length < 10;
        if (!isGarbage && response.length < 500 && !response.includes('```')) {
          this._addAgentMessage(projectId, response, broadcastFn, { tool: 'local' });
        } else {
          this._addProgressMessage(projectId, `Routing to ${tool}...`, broadcastFn);
          await this._sendToCliTool(projectId, sessionId, content, tool, broadcastFn, ctx);
        }
      }
    } catch (err) {
      this._addProgressMessage(projectId, `Routing to ${tool}...`, broadcastFn);
      await this._sendToCliTool(projectId, sessionId, content, tool, broadcastFn, ctx);
    }
  }

  // ── Context builder for smart routing ──

  _buildContext(projectId, sessionId, userMessage) {
    const parts = [];

    // Profile
    const profile = this._getProfileContext();
    if (profile) parts.push(`USER PROFILE:\n${profile}`);

    // Project info
    try {
      const db = getDB();
      const project = (db.data.projects || []).find(p => p.id === projectId);
      if (project) {
        parts.push(`PROJECT: "${project.name}"${project.containerName ? ` (Docker container: ${project.containerName})` : ''}${project.folderPath ? ` (Path: ${project.folderPath})` : ''}`);
      }
    } catch {}

    // System context
    parts.push(`ENVIRONMENT:
- Running inside a Docker container with a full development environment
- CLI tools available: claude (Claude Code), copilot (GitHub Copilot), aider, git, npm, node
- Claude Code is used via: claude -p 'prompt' --output-format json --dangerously-skip-permissions --resume <session_id>
- The user interacts through a chat UI that can show markdown, code blocks, and bullet lists`);

    // Recent conversation
    try {
      const recent = chatStore.getMessages(projectId, { sessionId, limit: 10 }).reverse();
      if (recent.length > 0) {
        const history = recent
          .filter(m => m.role !== 'progress' && m.role !== 'system')
          .map(m => `[${m.role}]: ${m.content.slice(0, 300)}`)
          .join('\n');
        parts.push(`RECENT CONVERSATION:\n${history}`);
      }
    } catch {}

    return parts.join('\n\n');
  }

  // ── Run a shell command and format the result ──

  async _runShellCommand(projectId, sessionId, cmd, originalQuestion, broadcastFn, ctx) {
    let shellSessionId;
    try {
      const sess = await agentShellPool.getSession(projectId, sessionId || 'shell');
      shellSessionId = sess.sessionId;
      if (sess.isNew) await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      this._addErrorMessage(projectId, `Failed to start shell: ${err.message}`, broadcastFn);
      return;
    }

    agentShellPool.write(shellSessionId, cmd + '\n');

    let totalOutput = '';
    let idleRounds = 0;
    while (!ctx.aborted && idleRounds < 30) {
      const chunk = await this._waitForOutput(shellSessionId, ctx, 3000);
      if (ctx.aborted) return;
      if (chunk.length === 0) {
        idleRounds++;
        if (idleRounds >= 2 && totalOutput.length > 0 && this._shellPromptReturned(this._stripAnsi(totalOutput))) break;
        continue;
      }
      idleRounds = 0;
      totalOutput += chunk;
      if (this._shellPromptReturned(this._stripAnsi(totalOutput))) break;
    }

    const cleanOutput = this._stripAnsi(totalOutput).trim();
    const display = this._extractToolResponse(cleanOutput, cmd);

    // Format with local LLM
    try {
      const result = await llmProvider.generateResponse(
        `The user asked: "${originalQuestion}"\nCommand run: ${cmd}\nOutput:\n${display.slice(-3000)}\n\nGive a clean, helpful answer based on this output. Use markdown.`,
        { maxTokens: 500, temperature: 0.1 }
      );
      this._addAgentMessage(projectId, result.response, broadcastFn, { tool: 'shell', rawOutput: cleanOutput.slice(-8000) });
    } catch {
      this._addAgentMessage(projectId, `\`\`\`\n${display}\n\`\`\``, broadcastFn, { tool: 'shell', rawOutput: cleanOutput.slice(-8000) });
    }
  }

  // ── Send to CLI tool (Claude/Copilot/Aider) ──

  async _sendToCliTool(projectId, chatSessionId, message, tool, broadcastFn, ctx) {
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

    this._addProgressMessage(projectId,
      isFollowUp ? `Continuing conversation with ${tool}...` : `Asking ${tool}...`,
      broadcastFn);

    agentShellPool.write(shellSessionId, cmd + '\n');

    // Collect output with live event parsing for stream-json
    let totalOutput = '';
    let idleRounds = 0;
    const MAX_IDLE = 120;
    let lastProgressTime = 0;

    while (!ctx.aborted && idleRounds < MAX_IDLE) {
      const chunk = await this._waitForOutput(shellSessionId, ctx, 3000);
      if (ctx.aborted) return;
      if (chunk.length === 0) {
        idleRounds++;
        if (idleRounds >= 2 && totalOutput.length > 0 && this._shellPromptReturned(this._stripAnsi(totalOutput))) break;
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

      // Parse stream-json events for live progress (Claude)
      const cleanChunk = this._stripAnsi(chunk);
      const now = Date.now();
      if (now - lastProgressTime > 2000) {
        const event = this._parseStreamEvent(cleanChunk);
        if (event) {
          lastProgressTime = now;
          this._addProgressMessage(projectId, event, broadcastFn);
        }
      }

      // Auto-approve prompts
      const fastResponse = this._fastPromptDetect(cleanChunk);
      if (fastResponse !== null) {
        const lastQ = cleanChunk.split('\n').filter(l => l.trim()).pop()?.trim() || '';
        agentShellPool.write(shellSessionId, fastResponse + '\n');
        this._addProgressMessage(projectId, `Confirmed "${fastResponse || 'enter'}" → ${lastQ.slice(0, 80)}`, broadcastFn);
      } else {
        const provider = llmProvider.getSettings().provider;
        if (provider !== 'ollama' && this._looksLikePrompt(cleanChunk)) {
          const autoResponse = await this._smartAutoConfirm(cleanChunk, projectId, broadcastFn);
          if (autoResponse !== null) {
            agentShellPool.write(shellSessionId, autoResponse + '\n');
            this._addProgressMessage(projectId, `Auto-confirmed: "${autoResponse}"`, broadcastFn);
          }
        }
      }
    }

    const cleanOutput = this._stripAnsi(totalOutput).trim();
    if (!cleanOutput) {
      this._addAgentMessage(projectId, `No response from ${tool}. Check Internal Console.`, broadcastFn, { tool });
      return;
    }

    // Extract session_id for --resume
    let displayOutput = cleanOutput;
    if (tool === 'claude' || tool === 'copilot') {
      const parsed = this._parseJsonToolOutput(cleanOutput, cmd);
      displayOutput = parsed.text;
      if (parsed.sessionId) {
        const newState = { cliSessionId: parsed.sessionId, messageCount: (cliState?.messageCount || 0) + 1 };
        this._cliSessions.set(chatSessionId, newState);
        chatStore.updateSessionMeta(projectId, chatSessionId, { cliSessionId: parsed.sessionId });
      }
    } else {
      displayOutput = this._extractToolResponse(cleanOutput, cmd);
    }

    // Check if Claude lost context — if so, retry with context injection
    const lostContext = /don't have context|no context|start of.*conversation|what.*retry|clarify what/i.test(displayOutput);
    if (lostContext && !ctx._retried) {
      ctx._retried = true;
      this._addProgressMessage(projectId, `${tool} lost context — resending with conversation history...`, broadcastFn);
      const contextSummary = await this._getContextSummary(projectId, chatSessionId);
      const enrichedMsg = `Here's the conversation context you need:\n\n${contextSummary}\n\nNow, the user's latest request: ${message}`;
      // Reset CLI session so we don't use stale --resume
      this._cliSessions.delete(chatSessionId);
      await this._sendToCliTool(projectId, chatSessionId, enrichedMsg, tool, broadcastFn, ctx);
      return;
    }

    // Format output
    let finalContent;
    if (displayOutput.length < 2000 && !displayOutput.includes('\x1b')) {
      finalContent = displayOutput;
    } else {
      try {
        const result = await llmProvider.generateResponse(
          `Clean up this terminal output for a chat UI. Rules:\n- Keep ALL content, do NOT trim or summarize\n- Use markdown: **bold**, \`code\`, bullets, headers\n- NEVER use HTML tags\n- Remove terminal artifacts\n\nOutput:\n${displayOutput.slice(-5000)}`,
          { maxTokens: 2000, temperature: 0.1 }
        );
        finalContent = result.response;
      } catch {
        finalContent = displayOutput;
      }
    }

    this._addAgentMessage(projectId, finalContent, broadcastFn, { tool, rawOutput: cleanOutput.slice(-8000) });

    // Persist context summary for recovery (async, don't block)
    this._persistContext(projectId, chatSessionId, message, finalContent);
  }

  /**
   * Save a running context summary for the session.
   * Used to recover if Claude loses context on --resume.
   */
  async _persistContext(projectId, chatSessionId, userMessage, agentResponse) {
    const provider = llmProvider.getSettings().provider;
    if (provider === 'ollama') return; // Skip for weak models

    try {
      const result = await llmProvider.generateResponse(
        `Summarize this exchange in 2-3 bullet points for future context recovery. Include: what was asked, what was done, key files/decisions.\n\nUser: ${userMessage.slice(0, 300)}\nAssistant: ${agentResponse.slice(0, 500)}`,
        { maxTokens: 150, temperature: 0.1 }
      );
      chatStore.updateSessionMeta(projectId, chatSessionId, {
        lastContext: result.response.trim(),
        lastContextAt: new Date().toISOString(),
      });
    } catch {}
  }

  /**
   * Build a context summary from the session's chat history.
   * Used when Claude loses context and we need to re-inject it.
   */
  async _getContextSummary(projectId, chatSessionId) {
    const parts = [];

    // Profile
    const profile = this._getProfileContext();
    if (profile) parts.push(`User profile:\n${profile}`);

    // Saved context summary
    try {
      const session = chatStore.getSession(projectId, chatSessionId);
      if (session?.lastContext) {
        parts.push(`Previous context:\n${session.lastContext}`);
      }
    } catch {}

    // Recent messages
    try {
      const recent = chatStore.getMessages(projectId, { sessionId: chatSessionId, limit: 15 }).reverse();
      const history = recent
        .filter(m => m.role === 'user' || m.role === 'agent')
        .map(m => `[${m.role}]: ${m.content.slice(0, 200)}`)
        .join('\n');
      if (history) parts.push(`Conversation history:\n${history}`);
    } catch {}

    // Project info
    try {
      const db = getDB();
      const project = (db.data.projects || []).find(p => p.id === projectId);
      if (project) {
        parts.push(`Project: ${project.name}${project.containerName ? ` (container: ${project.containerName})` : ''}`);
      }
    } catch {}

    return parts.join('\n\n') || 'No prior context available.';
  }

  // ── Profile context ──

  _getProfileContext() {
    try {
      const db = getDB();
      const p = db.data?.profile;
      if (!p || !p.setupComplete) return '';
      const parts = [];
      if (p.name) parts.push(`Name: ${p.name}`);
      if (p.role) parts.push(`Role: ${p.role}`);
      if (p.languages) parts.push(`Languages: ${p.languages}`);
      if (p.codeStyle) parts.push(`Code style: ${p.codeStyle}`);
      if (p.tone) parts.push(`Preferred tone: ${p.tone}`);
      if (p.preferences) parts.push(`Preferences: ${p.preferences}`);
      return parts.join('\n');
    } catch { return ''; }
  }

  // ── Command building ──

  _buildToolCommand(tool, message, chatSessionId, projectId) {
    let cliState = this._cliSessions.get(chatSessionId);
    if (!cliState?.cliSessionId && chatSessionId && projectId) {
      const stored = chatStore.getSession(projectId, chatSessionId);
      if (stored?.cliSessionId) {
        cliState = { cliSessionId: stored.cliSessionId, messageCount: stored.messageCount || 1 };
        this._cliSessions.set(chatSessionId, cliState);
      }
    }

    const isFirstMessage = !cliState?.cliSessionId;
    const profilePrefix = isFirstMessage ? (this._getProfileContext() + '\n\n') : '';
    const escaped = (profilePrefix + message).replace(/'/g, "'\\''");

    switch (tool) {
      case 'claude': {
        let cmd = `claude -p '${escaped}' --output-format stream-json --verbose --dangerously-skip-permissions`;
        if (cliState?.cliSessionId) cmd += ` --resume '${cliState.cliSessionId}'`;
        return cmd;
      }
      case 'copilot': {
        let cmd = `copilot -p '${escaped}' --output-format json`;
        if (cliState?.cliSessionId) cmd += ` --resume '${cliState.cliSessionId}'`;
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

  // ── Auto-name session ──

  async _autoNameSession(projectId, chatSessionId, userMessage) {
    if (!chatSessionId) return;
    const cliState = this._cliSessions.get(chatSessionId);
    if (cliState?.messageCount > 0) return;
    try {
      const result = await llmProvider.generateResponse(
        `Generate a short title (3-6 words) for a chat session starting with this message. Just the title, no quotes.\n\nMessage: "${userMessage.slice(0, 200)}"`,
        { maxTokens: 20, temperature: 0.3 }
      );
      const name = result.response.trim().slice(0, 50);
      if (name) chatStore.renameSession(projectId, chatSessionId, name);
    } catch {}
  }

  // ── Plan execution ──

  async executePlan({ projectId, sessionId = null, steps, tool = 'claude', broadcastFn }) {
    this._sessionId = sessionId;
    const ctx = { aborted: false, startedAt: Date.now() };
    this._running.set(sessionId, { ...ctx, queue: null });

    try {
      broadcastFn({ type: 'agent-status', projectId, busy: true });
      for (let i = 0; i < steps.length && !ctx.aborted; i++) {
        const tasks = steps.map((s, j) => ({
          title: s.title,
          status: j < i ? 'done' : j === i ? 'running' : 'pending',
        }));
        this._addProgressMessage(projectId, `Step ${i + 1}/${steps.length}: ${steps[i].title}`, broadcastFn, tasks);
        await this._sendToCliTool(projectId, sessionId, steps[i].prompt, tool, broadcastFn, ctx);
        if (ctx.aborted) break;
      }
      if (!ctx.aborted) {
        this._addAgentMessage(projectId, 'Plan completed.', broadcastFn, {
          tasks: steps.map(s => ({ title: s.title, status: 'done' }))
        });
      }
    } catch (error) {
      this._addErrorMessage(projectId, `Plan failed: ${error.message}`, broadcastFn);
    } finally {
      this._running.delete(sessionId);
      broadcastFn({ type: 'agent-status', projectId, busy: false });
    }
  }

  // ── Helpers ──

  abort(sessionId) {
    const entry = this._running.get(sessionId);
    if (entry) entry.aborted = true;
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

  _shellPromptReturned(cleanText) {
    const lines = cleanText.split('\n').filter(l => l.trim());
    if (lines.length === 0) return false;
    const lastLine = lines[lines.length - 1].trim();
    // Standard shell prompt
    if (/[$#]\s*$/.test(lastLine) && lastLine.length > 1) return true;
    if (/>\s*$/.test(lastLine) && lastLine.includes(':')) return true;
    // stream-json: final result event marks completion
    if (lastLine.startsWith('{') && lastLine.includes('"type"') && lastLine.includes('"result"')) {
      try { const j = JSON.parse(lastLine); if (j.type === 'result') return true; } catch {}
    }
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

  /**
   * Check if output looks like it's waiting for user input.
   */
  _looksLikePrompt(text) {
    const lastBit = text.slice(-300);
    return /\?\s*$/.test(lastBit) || /\[.*\]\s*$/.test(lastBit) || /:\s*$/.test(lastBit);
  }

  /**
   * Use the local LLM to decide how to respond to an ambiguous prompt.
   * Returns the response string, or null if it needs user input.
   */
  async _smartAutoConfirm(text, projectId, broadcastFn) {
    const lastBit = text.slice(-500);
    try {
      const result = await llmProvider.generateResponse(
        `A coding AI tool is asking for input. Decide what to respond.

Prompt: "${lastBit}"

Rules:
- If it's asking for approval/confirmation of a safe operation (file edit, command, install): respond YES
- If it's asking for approval of something destructive (delete, force push, drop table): respond NEEDS_USER
- If it's asking a question that needs the user's specific input (which file, what name): respond NEEDS_USER
- If it's asking to continue/proceed: respond YES

Respond with EXACTLY one line:
YES: <response to type> (e.g., "YES: y" or "YES: " for enter)
NEEDS_USER`,
        { maxTokens: 20, temperature: 0.1 }
      );

      const response = result.response.trim();
      if (response.startsWith('YES:')) {
        const answer = response.slice(4).trim();
        this._addProgressMessage(projectId, `Auto-confirmed: "${answer || '(enter)'}"`, broadcastFn);
        return answer;
      }
      return null; // Needs user input
    } catch {
      return null;
    }
  }

  /**
   * Parse stream-json events from Claude to extract meaningful progress updates.
   * stream-json format: one JSON object per line with type field.
   */
  _parseStreamEvent(chunk) {
    const lines = chunk.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        const event = JSON.parse(trimmed);

        // Tool use events — Claude is taking an action
        if (event.type === 'tool_use' || event.tool) {
          const toolName = event.tool || event.name || '';
          const input = typeof event.input === 'string' ? event.input : JSON.stringify(event.input || '');
          if (toolName.toLowerCase().includes('bash') || toolName.toLowerCase().includes('shell')) {
            return `Running: \`${input.slice(0, 80)}\``;
          }
          if (toolName.toLowerCase().includes('read') || toolName.toLowerCase().includes('file')) {
            const path = input.match(/["']?([^\s"']+\.\w+)["']?/)?.[1] || input.slice(0, 60);
            return `Reading: \`${path}\``;
          }
          if (toolName.toLowerCase().includes('write') || toolName.toLowerCase().includes('edit')) {
            const path = input.match(/["']?([^\s"']+\.\w+)["']?/)?.[1] || input.slice(0, 60);
            return `Editing: \`${path}\``;
          }
          if (toolName.toLowerCase().includes('glob') || toolName.toLowerCase().includes('grep') || toolName.toLowerCase().includes('search')) {
            return `Searching: ${input.slice(0, 60)}`;
          }
          return `Using ${toolName}: ${input.slice(0, 60)}`;
        }

        // Assistant message start — Claude is thinking
        if (event.type === 'assistant' && event.message) {
          const snippet = (typeof event.message === 'string' ? event.message : event.message.content || '').slice(0, 80);
          if (snippet) return `Thinking: "${snippet}${snippet.length >= 80 ? '...' : ''}"`;
        }

        // Content block — partial response
        if (event.type === 'content_block_delta' || event.type === 'content') {
          const text = event.delta?.text || event.text || '';
          if (text.length > 20) return `Writing response...`;
        }

      } catch {}
    }
    return null;
  }

  _parseJsonToolOutput(cleanOutput, cmd) {
    let text = '';
    let sessionId = null;
    const jsonMatch = cleanOutput.match(/\{"type"\s*:\s*"result"[^]*?"session_id"\s*:\s*"([^"]+)"[^]*?"result"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (jsonMatch) {
      sessionId = jsonMatch[1];
      text = jsonMatch[2].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    // Strategy 2: scan ALL JSON lines (stream-json produces many — result is last)
    if (!sessionId || !text) {
      for (const line of cleanOutput.split('\n')) {
        const idx = line.indexOf('{');
        if (idx >= 0) {
          try {
            const json = JSON.parse(line.slice(idx));
            if (json.session_id) sessionId = json.session_id;
            if (json.result) text = json.result;
            if (json.type === 'result' && json.result) text = json.result;
            // Don't break — keep scanning for later events that have the final result
          } catch {}
        }
      }
    }
    if (!text) text = this._extractToolResponse(cleanOutput, cmd);

    // Convert HTML tags to markdown (Claude sometimes outputs HTML)
    if (text) {
      text = text
        .replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**')
        .replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**')
        .replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*')
        .replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*')
        .replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<li>([\s\S]*?)<\/li>/gi, '- $1')
        .replace(/<\/?[uo]l>/gi, '')
        .replace(/<\/?p>/gi, '\n')
        .replace(/<h([1-6])>([\s\S]*?)<\/h\1>/gi, (_, l, c) => '#'.repeat(parseInt(l)) + ' ' + c);
    }

    return { text, sessionId };
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

    // Generate suggested follow-ups for capable LLMs (async, don't block)
    const provider = llmProvider.getSettings().provider;
    if (provider !== 'ollama') {
      this._generateSuggestions(content).then(suggestions => {
        if (suggestions?.length > 0) {
          const sugMsg = chatStore.addMessage({
            projectId, sessionId, role: 'system',
            content: '',
            metadata: { suggestions, hidden: true },
          });
          broadcastFn({ type: 'chat-message', message: sugMsg });
        }
      }).catch(() => {});
    }

    const msg = chatStore.addMessage({ projectId, sessionId, role: 'agent', content, metadata });
    broadcastFn({ type: 'chat-message', message: msg });
  }

  async _generateSuggestions(agentResponse) {
    try {
      const result = await llmProvider.generateResponse(
        `Based on this AI assistant response, suggest 2-3 short follow-up actions the user might want to take. Return ONLY a JSON array of strings, each under 6 words. No explanation.

Response: "${agentResponse.slice(0, 500)}"

Example output: ["Fix it now","Show the diff","Run tests first"]`,
        { maxTokens: 60, temperature: 0.3 }
      );

      const match = result.response.match(/\[.*\]/s);
      if (match) return JSON.parse(match[0]);
    } catch {}
    return null;
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
