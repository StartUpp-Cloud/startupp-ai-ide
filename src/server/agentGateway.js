// src/server/agentGateway.js
//
// Architecture: Smart routing based on local LLM capability.
//
// Ollama (weak): Everything goes to Claude/Copilot, local LLM only formats output.
//
// GitHub/OpenAI/DeepSeek (capable): Local LLM acts as orchestrator.
//   - Only very general questions → answers directly
//   - Anything needing repository/code verification → routes to Claude with --resume
//   - Shell commands → generates and executes them
//
// Each chat session gets its own shell PTY — multiple sessions run in parallel.
// Messages within the same session are queued (not aborted).

import { EventEmitter } from 'events';
import { llmProvider } from './llmProvider.js';
import { chatStore } from './chatStore.js';
import { agentShellPool } from './agentShellPool.js';
import { jobManager } from './jobManager.js';
import { skillManager } from './skillManager.js';
import { ollamaWorkspaceOrchestrator } from './ollamaWorkspaceOrchestrator.js';
import { getDB } from './db.js';
import { supportsSessionEffortSelection, supportsSessionModelSelection } from './sessionSettings.js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

class AgentGateway extends EventEmitter {
  constructor() {
    super();
    this._running = new Map();
    this._cliSessions = new Map();
    this._activeShellSessions = new Map();
  }

  resetSession(sessionId) {
    if (!sessionId) return;
    this._cliSessions.delete(sessionId);
  }

  // ── Entry point ──

  async handleTask({
    projectId,
    sessionId = null,
    content,
    attachments = [],
    mode,
    tool = 'claude',
    model = null,
    effort = null,
    broadcastFn,
    skipUnread = false,
  }) {
    const existing = this._running.get(sessionId);
    if (existing && existing.queue) {
      existing.queue = existing.queue.then(() => {
        if (existing.aborted) return null;
        return this._executeTask({ projectId, sessionId, content, attachments, mode, tool, model, effort, broadcastFn, skipUnread });
      });
      return existing.queue;
    }

    this._running.set(sessionId, { aborted: false, startedAt: Date.now(), queue: null });
    const promise = this._executeTask({ projectId, sessionId, content, attachments, mode, tool, model, effort, broadcastFn, skipUnread });
    const entry = this._running.get(sessionId);
    if (entry) entry.queue = promise;
    return promise;
  }

  async _executeTask({ projectId, sessionId, content, attachments = [], mode, tool, model, effort, broadcastFn, skipUnread = false }) {
    const ctx = this._running.get(sessionId) || { aborted: false, queue: null };
    ctx.startedAt = Date.now();
    this._running.set(sessionId, ctx);

    try {
      broadcastFn({ type: 'agent-status', projectId, sessionId, busy: true });

      // Auto-name session on first message (async, don't wait)
      this._autoNameSession(projectId, sessionId, content);

      // Build content with attachments context
      const fullContent = await this._buildContentWithAttachments(content, attachments, projectId);

      const provider = llmProvider.getSettings().provider;
      const isCapable = provider !== 'ollama';
      const assistantSettings = { model, effort };
      const isOllamaAssistant = ollamaWorkspaceOrchestrator.isOllamaAssistant(tool);

      let routedContent = fullContent;
      if (isOllamaAssistant) {
        this._addProgressMessage(projectId, sessionId, 'Ollama orchestrator: scanning workspace, building stack context, and planning...', broadcastFn, null, { transient: true });
        const prepared = await ollamaWorkspaceOrchestrator.prepareTaskContext({
          projectId,
          sessionId,
          prompt: fullContent,
          model,
        });
        routedContent = prepared.augmentedPrompt;
        this._addProgressMessage(
          projectId,
          sessionId,
          `Ollama orchestrator: job ${prepared.job.id} indexed ${prepared.index.stats.totalFiles} files, researched ${prepared.research.sources.length} sources, retrieved ${prepared.relevantFiles.length} files, and created ${prepared.evidenceLedger.claims.length} evidence claims.`,
          broadcastFn,
          null,
          { transient: true }
        );
      }

      if (mode === 'plan') {
        // Plan mode: multi-loop review (plan → critic → optional 3rd pass)
        await this._executePlanWithReview(projectId, sessionId, routedContent, tool, assistantSettings, broadcastFn, ctx, skipUnread);
      } else if (isOllamaAssistant) {
        // Ollama assistant always uses the IDE-side orchestrator + local Ollama CLI.
        // Do not smart-route Ollama-selected sessions through cloud/capable providers.
        this._addProgressMessage(projectId, sessionId, `Sending to ${tool}...`, broadcastFn, null, { transient: true });
        await this._sendToCliTool(projectId, sessionId, routedContent, tool, assistantSettings, broadcastFn, ctx, 'agent', skipUnread);
      } else if (isCapable) {
        // Agent mode + capable LLM: smart routing
        await this._smartRoute(projectId, sessionId, routedContent, mode, tool, assistantSettings, broadcastFn, ctx, skipUnread);
      } else {
        // Agent mode + Ollama: everything goes to the CLI tool
        this._addProgressMessage(projectId, sessionId, `Sending to ${tool}...`, broadcastFn, null, { transient: true });
        await this._sendToCliTool(projectId, sessionId, routedContent, tool, assistantSettings, broadcastFn, ctx, 'agent', skipUnread);
      }
    } catch (error) {
      this._addErrorMessage(projectId, sessionId, `Error: ${error.message}`, broadcastFn);
    } finally {
      this._activeShellSessions.delete(sessionId);
      this._running.delete(sessionId);
      broadcastFn({ type: 'agent-status', projectId, sessionId, busy: false });
    }
  }

  /**
   * Build content string with attachments context.
   * For containerized projects, copies binary files (images, PDFs) into the
   * container so Claude can read them at their container-internal path.
   */
  async _buildContentWithAttachments(content, attachments, projectId) {
    if (!attachments || attachments.length === 0) return content;

    const parts = [content];

    // Categorize attachments
    const imageAttachments = attachments.filter(a => a.type?.startsWith('image/'));
    const textAttachments = attachments.filter(a =>
      a.type?.startsWith('text/') ||
      a.type === 'application/json' ||
      ['txt', 'md', 'csv', 'json', 'js', 'ts', 'html', 'css', 'xml'].includes(a.name?.split('.').pop()?.toLowerCase())
    );
    const pdfAttachments = attachments.filter(a => a.type === 'application/pdf');
    const otherAttachments = attachments.filter(a =>
      !imageAttachments.includes(a) && !textAttachments.includes(a) && !pdfAttachments.includes(a)
    );

    // Resolve paths — for containerised projects copy files in and use container paths
    const resolvePath = await this._resolveAttachmentPaths(
      [...imageAttachments, ...pdfAttachments, ...otherAttachments],
      projectId
    );

    // Images: tell Claude to read them from their resolved path
    if (imageAttachments.length > 0) {
      const paths = imageAttachments.map(a => resolvePath.get(a.path) || a.path);
      parts.push('\n\n[Attached images: ' + paths.join(', ') + ']');
    }

    // Text files: read on the host (server always has access) and inline the content
    for (const att of textAttachments) {
      if (att.size < 50000 && att.path) {
        try {
          const fileContent = fs.readFileSync(att.path, 'utf-8');
          parts.push(`\n\n--- Content of ${att.name} ---\n${fileContent}\n--- End of ${att.name} ---`);
        } catch {
          parts.push(`\n\n[Attached file: ${att.path}]`);
        }
      } else {
        parts.push(`\n\n[Attached file (large): ${att.path}]`);
      }
    }

    // PDFs
    if (pdfAttachments.length > 0) {
      const paths = pdfAttachments.map(a => resolvePath.get(a.path) || a.path);
      parts.push('\n\n[Attached PDFs: ' + paths.join(', ') + ']');
    }

    // Other files
    if (otherAttachments.length > 0) {
      const paths = otherAttachments.map(a => resolvePath.get(a.path) || a.path);
      parts.push('\n\n[Other attachments: ' + paths.join(', ') + ']');
    }

    return parts.join('');
  }

  /**
   * For each attachment path, return the path Claude should use.
   * - Non-containerised project → original host path (unchanged).
   * - Containerised project → copy the file into /workspace/.uploads/ inside
   *   the container and return the container-internal path.
   *
   * Returns a Map<hostPath, resolvedPath>.
   */
  async _resolveAttachmentPaths(attachments, projectId) {
    const result = new Map();
    if (!attachments.length || !projectId) return result;

    let containerName = null;
    let workDir = '/workspace';

    try {
      const { default: Project } = await import('./models/Project.js');
      const project = Project.findById(projectId);
      containerName = project?.containerName || null;
      if (containerName) {
        const { containerManager } = await import('./containerManager.js');
        workDir = containerManager.getWorkDir(containerName) || '/workspace';
      }
    } catch {}

    if (!containerName) {
      // No container — host paths are directly accessible
      for (const att of attachments) {
        if (att.path) result.set(att.path, att.path);
      }
      return result;
    }

    // Ensure upload staging dir exists inside the container
    const uploadDir = `${workDir}/.uploads`;
    try {
      execSync(`docker exec ${containerName} mkdir -p ${uploadDir}`, { stdio: 'pipe' });
    } catch (err) {
      console.warn(`[agentGateway] Could not create container upload dir: ${err.message}`);
    }

    for (const att of attachments) {
      if (!att.path) continue;
      const filename = path.basename(att.path);
      const containerPath = `${uploadDir}/${filename}`;
      try {
        execSync(`docker cp '${att.path}' '${containerName}:${containerPath}'`, { stdio: 'pipe' });
        result.set(att.path, containerPath);
        console.log(`[agentGateway] Copied attachment into container: ${containerPath}`);
      } catch (err) {
        console.warn(`[agentGateway] Failed to copy ${filename} to container: ${err.message}`);
        result.set(att.path, att.path); // fall back to host path
      }
    }

    return result;
  }

  // ── Smart routing (capable local LLM) ──

  async _smartRoute(projectId, sessionId, content, mode, tool, assistantSettings, broadcastFn, ctx, skipUnread = false) {
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
(Use this ONLY for very general, codebase-independent knowledge or conversation)

COMMAND:
<shell command to run>
(Use this for: when the user wants to run something, check something in the terminal, install packages)

DELEGATE:
<message to send to ${tool}>
(Use this for: code changes, file edits, architecture work, debugging, complex analysis that needs codebase access, planning features)

RULES:
- ANSWER directly ONLY for broad general knowledge, conversational replies, or generic conceptual explanations that do not depend on this repository, runtime state, logs, configuration, dependencies, files, or prior implementation details.
- NEVER answer directly if the user asks about this app/project/codebase, existing behavior, a bug, an error, a warning, a stack trace, terminal output, tests, build results, implementation details, architecture in this repo, files, settings, config, dependencies, commits, branches, Docker/container state, or whether something is possible in the current code. DELEGATE those.
- If an answer would require reading code, checking files, running commands, verifying behavior, inspecting logs/output, or making changes, DELEGATE.
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
        if (this._canAnswerDirectly(content)) {
          this._addProgressMessage(projectId, sessionId, `Analyzing your question — I can answer this directly.`, broadcastFn, null, { transient: true });
          this._addAgentMessage(projectId, sessionId, body || response, broadcastFn, { tool: 'local' }, skipUnread);
        } else {
          this._addProgressMessage(projectId, sessionId, `This needs ${tool}'s codebase access — delegating...`, broadcastFn, null, { transient: true });
          await this._sendToCliTool(projectId, sessionId, content, tool, assistantSettings, broadcastFn, ctx, mode, skipUnread);
        }

      } else if (firstLine.startsWith('COMMAND')) {
        const cmd = body;
        const looksValid = cmd && !cmd.includes('[') && !cmd.includes('NEEDS') && cmd.length < 200;
        if (looksValid) {
          this._addProgressMessage(projectId, sessionId, `Running shell command: \`${cmd}\``, broadcastFn, null, { transient: true });
          await this._runShellCommand(projectId, sessionId, cmd, content, broadcastFn, ctx, skipUnread);
        } else {
          this._addProgressMessage(projectId, sessionId, `This needs ${tool} — delegating your request...`, broadcastFn, null, { transient: true });
          await this._sendToCliTool(projectId, sessionId, content, tool, assistantSettings, broadcastFn, ctx, mode, skipUnread);
        }

      } else if (firstLine.startsWith('DELEGATE')) {
        this._addProgressMessage(projectId, sessionId, `This needs ${tool}'s codebase access — delegating...`, broadcastFn, null, { transient: true });
        await this._sendToCliTool(projectId, sessionId, content, tool, assistantSettings, broadcastFn, ctx, mode, skipUnread);

      } else {
        const isGarbage = response.includes('NEEDS_USER') || response.includes('[') || response.length < 10;
        if (!isGarbage && this._canAnswerDirectly(content) && response.length < 500 && !response.includes('```')) {
          this._addAgentMessage(projectId, sessionId, response, broadcastFn, { tool: 'local' }, skipUnread);
        } else {
          this._addProgressMessage(projectId, sessionId, `Routing to ${tool}...`, broadcastFn, null, { transient: true });
          await this._sendToCliTool(projectId, sessionId, content, tool, assistantSettings, broadcastFn, ctx, mode, skipUnread);
        }
      }
    } catch (err) {
      this._addProgressMessage(projectId, sessionId, `Routing to ${tool}...`, broadcastFn, null, { transient: true });
      await this._sendToCliTool(projectId, sessionId, content, tool, assistantSettings, broadcastFn, ctx, mode, skipUnread);
    }
  }

  _canAnswerDirectly(content) {
    const text = String(content || '').toLowerCase();
    if (!text.trim()) return false;

    const requiresVerification = [
      /\b(this|the|our|my)\s+(app|project|repo|repository|codebase|code|implementation|feature|component|page|api|endpoint|route|server|client|ui|database|container|docker|settings?)\b/,
      /\b(error|bug|warning|failed|failure|broken|not working|doesn't work|stack trace|console|terminal|log|output)\b/,
      /\b(test|build|lint|typecheck|run|execute|verify|check|inspect|debug|fix|change|update|implement|add|remove|refactor|review)\b/,
      /\b(file|folder|directory|path|config|package|dependency|branch|commit|diff|pr|pull request)\b/,
      /\b(can we|could we|should we|is there|do we|does it|why is|how is|where is|what is wrong)\b/,
      /[`/][\w./-]+\b/,
    ];

    if (requiresVerification.some(pattern => pattern.test(text))) return false;

    const generalKnowledge = [
      /^(hi|hello|hey|thanks|thank you)\b/,
      /\b(what is|explain|how does|how do i|what are|difference between|best practices for)\b/,
    ];

    return generalKnowledge.some(pattern => pattern.test(text));
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

  async _runShellCommand(projectId, sessionId, cmd, originalQuestion, broadcastFn, ctx, skipUnread = false) {
    let shellSessionId;
    try {
      const sess = await agentShellPool.getSession(projectId, sessionId || 'shell');
      shellSessionId = sess.sessionId;
      if (sess.isNew) await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      this._addErrorMessage(projectId, sessionId, `Failed to start shell: ${err.message}`, broadcastFn);
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
      this._addAgentMessage(projectId, sessionId, result.response, broadcastFn, { tool: 'shell', rawOutput: cleanOutput.slice(-8000) }, skipUnread);
    } catch {
      this._addAgentMessage(projectId, sessionId, `\`\`\`\n${display}\n\`\`\``, broadcastFn, { tool: 'shell', rawOutput: cleanOutput.slice(-8000) }, skipUnread);
    }
  }

  // ── Send to CLI tool (Claude/Copilot/Aider) ──

  /**
   * Send to CLI tool with autonomous agent loop:
   * - Auto-retry on failure (up to 3 attempts with compaction)
   * - Activity-based timeout (10 min silence, 60 min hard limit)
   * - Event-driven completion from stream-json
   * - Live status reactions (thinking/reading/editing/running/done/error)
   * - Context recovery on "lost context" responses
   * - JOB PERSISTENCE: Full operation tracked via JobManager for reliability
   * - STREAMING PERSISTENCE: Saves response chunks to disk as they arrive
   */
  async _sendToCliTool(projectId, chatSessionId, message, tool, assistantSettings, broadcastFn, ctx, mode = 'agent', skipUnread = false) {
    const MAX_ATTEMPTS = 3;

    // Create a streaming message placeholder BEFORE starting
    // This ensures the response is persisted even if connection drops mid-stream
    const streamingMsg = chatStore.createStreamingMessage({
      projectId,
      sessionId: chatSessionId,
      role: 'agent',
      initialContent: `Waiting for ${tool}...`,
      metadata: { tool, streaming: true },
    });

    // Create a job for reliable tracking
    const job = jobManager.createJob({
      projectId,
      sessionId: chatSessionId,
      messageId: streamingMsg.id,
      tool,
      prompt: message,
    });

    // Set up job event handlers for this operation
    const jobProgressHandler = ({ job: j, progress }) => {
      if (j.id !== job.id) return;
      // Broadcast progress to client
      broadcastFn({
        type: 'job-progress',
        projectId,
        sessionId: chatSessionId,
        jobId: job.id,
        progress,
      });
      // Also send as a progress message for the chat
      if (progress.summary) {
        this._addProgressMessage(projectId, chatSessionId, progress.summary, broadcastFn);
      }
    };
    jobManager.on('job-progress', jobProgressHandler);

    // Notify client that streaming has started
    broadcastFn({
      type: 'chat-message-stream-start',
      projectId,
      sessionId: chatSessionId,
      messageId: streamingMsg.id,
      jobId: job.id,
    });

    let chunkIndex = 0;

    // ── Context distillation: enrich follow-up messages with key context ──
    // Computed once before the attempt loop so retries reuse the same brief.
    let distilledContext = null;
    try {
      distilledContext = await this._distillContext(projectId, chatSessionId, message);
      if (distilledContext) {
        console.log(`[agentGateway] Context distilled for session ${chatSessionId} (${distilledContext.length} chars)`);
      }
    } catch (err) {
      console.warn(`[agentGateway] Context distillation failed (non-blocking):`, err.message);
    }

    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ctx.aborted; attempt++) {
        const result = await this._attemptCliTool(projectId, chatSessionId, message, tool, assistantSettings, broadcastFn, ctx, attempt, mode, {
          job, // Pass job for output recording
          distilledContext, // Pre-computed context brief for follow-up enrichment
          // Callback to persist chunks as they arrive (for recovery)
          // NOTE: Raw chunks are saved to disk but NOT broadcast to client
          // Client only sees progress messages and the final cleaned response
          onChunk: (chunk) => {
            chatStore.appendStreamChunk({
              projectId,
              sessionId: chatSessionId,
              messageId: streamingMsg.id,
              chunk,
              chunkIndex: chunkIndex++,
            });
            // Record output to job (handles timeout tracking, progress parsing)
            jobManager.recordOutput(job.id, chunk);
          },
        });

        if (result.success) {
          // ── Success: format and finalize ──
          const finalContent = await this._cleanContent(result.displayOutput);
          const reviewMeta = await this._analyzeResponseForReview({
            projectId,
            userMessage: message,
            assistantContent: finalContent,
            mode,
          });
          const logContext = this._detectLogRequest(finalContent);
          const rawForDisplay = this._cleanRawOutput(result.cleanOutput);

          // Complete the job
          jobManager.completeJob(job.id, finalContent);

          // Finalize the streaming message with complete content
          chatStore.finalizeStreamingMessage({
            projectId,
            sessionId: chatSessionId,
            messageId: streamingMsg.id,
            finalContent,
            metadata: {
              tool,
              jobId: job.id,
              rawOutput: rawForDisplay.slice(-8000),
              attempts: attempt,
              ...(reviewMeta ? { review: reviewMeta } : {}),
              ...(logContext ? { logContext } : {}),
            },
          });

          // Broadcast completion
          broadcastFn({
            type: 'chat-message-stream-complete',
            projectId,
            sessionId: chatSessionId,
            messageId: streamingMsg.id,
            jobId: job.id,
            message: {
              ...streamingMsg,
              content: finalContent,
              metadata: {
                tool,
                jobId: job.id,
                rawOutput: rawForDisplay.slice(-8000),
                attempts: attempt,
                ...(reviewMeta ? { review: reviewMeta } : {}),
                ...(logContext ? { logContext } : {}),
              },
            },
          });

          // Mark session as unread and broadcast (only for user-initiated tasks)
          if (!skipUnread) {
            const changed = chatStore.markSessionUnread(projectId, chatSessionId);
            if (changed) {
              broadcastFn({
                type: 'session-unread',
                projectId,
                sessionId: chatSessionId,
                hasUnread: true,
              });
            }
          }

          this._persistContext(projectId, chatSessionId, message, finalContent);
          return;
        }

        if (result.retry && attempt < MAX_ATTEMPTS) {
          // ── Retry: compaction, context recovery, or transient provider error ──
          const retryLabel = result.retryType === 'codex-transient'
            ? `🔁 Re-evaluating response with latest instructions...`
            : result.retryType === 'codex-rate-limit'
              ? `⏳ Rate limited — waiting before retry (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`
              : `⚠ ${result.retryReason} — retrying (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`;
          this._addProgressMessage(projectId, chatSessionId, retryLabel, broadcastFn);

          if (result.retryType === 'context-lost') {
            this._cliSessions.delete(chatSessionId);
            const contextSummary = await this._getContextSummary(projectId, chatSessionId);
            message = `Context from our conversation:\n${contextSummary}\n\nUser's request: ${message}`;
          }

          // Use longer backoff for rate limits, shorter for transient errors
          const backoffMs = result.retryType === 'codex-rate-limit' ? 5000
            : result.retryType === 'codex-transient' ? 3000
            : 2000;
          const shouldContinue = await this._waitForRetryBackoff(ctx, backoffMs);
          if (!shouldContinue) return;
          continue;
        }

        // ── Final failure: still finalize with whatever we got ──
        // Use the error message directly if it's already formatted (auth, rate limit, etc.)
        const failureContent = result.error
          ? (result.error.startsWith('🔐') || result.error.startsWith('⏳') || result.error.startsWith('🔄')
              ? result.error
              : `Error: ${result.error}`)
          : result.displayOutput || `No response from ${tool}. Check Internal Console.`;

        // Fail the job
        jobManager.failJob(job.id, failureContent);

        chatStore.finalizeStreamingMessage({
          projectId,
          sessionId: chatSessionId,
          messageId: streamingMsg.id,
          finalContent: failureContent,
          metadata: { tool, jobId: job.id, error: true, attempts: attempt },
        });

        broadcastFn({
          type: 'chat-message-stream-complete',
          projectId,
          sessionId: chatSessionId,
          messageId: streamingMsg.id,
          jobId: job.id,
          message: {
            ...streamingMsg,
            content: failureContent,
            metadata: { tool, jobId: job.id, error: true },
          },
        });

        // Mark session as unread even for failures (user needs to see error)
        if (!skipUnread) {
          const changed = chatStore.markSessionUnread(projectId, chatSessionId);
          if (changed) {
            broadcastFn({
              type: 'session-unread',
              projectId,
              sessionId: chatSessionId,
              hasUnread: true,
            });
          }
        }
        return;
      }
    } finally {
      // Clean up event handler
      jobManager.removeListener('job-progress', jobProgressHandler);
    }
  }

  /**
   * Single attempt to run a CLI tool command.
   * Returns: { success, displayOutput, cleanOutput, retry, retryReason, retryType, error }
   * @param {Object} streamOpts - Optional streaming options
   * @param {Object} streamOpts.job - Job for tracking (managed by JobManager)
   * @param {Function} streamOpts.onChunk - Callback for each output chunk (for persistence)
   */
  async _attemptCliTool(projectId, chatSessionId, message, tool, assistantSettings, broadcastFn, ctx, attempt, mode = 'agent', streamOpts = {}) {
    const { job, onChunk, distilledContext } = streamOpts;

    // Get or create shell session
    let shellSessionId;
    try {
      const sess = await agentShellPool.getSession(projectId, chatSessionId || 'shell');
      shellSessionId = sess.sessionId;
      if (chatSessionId) this._activeShellSessions.set(chatSessionId, shellSessionId);
      if (sess.isNew) await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      return { success: false, error: `Failed to start shell: ${err.message}` };
    }

    // Start the job if provided
    if (job) {
      jobManager.startJob(job.id, shellSessionId);
    }

    const cliState = this._cliSessions.get(chatSessionId);
    const cmd = this._buildToolCommand(tool, message, chatSessionId, projectId, mode, assistantSettings, distilledContext);
    const isFollowUp = !!(cliState?.cliSessionId);

    this._addProgressMessage(projectId, chatSessionId,
      isFollowUp ? `↻ Continuing conversation with ${tool}...` : `→ Asking ${tool}...`,
      broadcastFn, null, { transient: true });

    agentShellPool.write(shellSessionId, cmd + '\n');

    // ── Collect output with activity-based timeout ──
    // JobManager handles timeout detection (10 min silence, 60 min hard limit)
    // We just need to detect completion via result event or shell prompt
    let totalOutput = '';
    let idleRounds = 0;
    let lastOutputTime = Date.now();
    let lastProgressTime = 0;
    let resultEventSeen = false;

    // ── Background task tracking ──
    // When Claude launches agents with run_in_background:true, it may return
    // intermediate results while waiting. We need to track these tasks and
    // continue waiting until they all complete.
    const pendingBackgroundTasks = new Map(); // task_id -> { description, startedAt }
    let lastResultText = null; // Store intermediate result text
    let allTasksCompleted = false;

    // Support operations up to 60 minutes (1800 rounds × 2s = 60 min)
    // Actual timeout is managed by JobManager based on activity
    const MAX_IDLE = 1800;
    const PROGRESS_INTERVAL_MS = 30000; // Show progress every 30s

    while (!ctx.aborted && idleRounds < MAX_IDLE) {
      const chunk = await this._waitForOutput(shellSessionId, ctx, 2000);
      if (ctx.aborted) return { success: false, error: 'Aborted' };

      const now = Date.now();

      if (chunk.length === 0) {
        idleRounds++;
        const silenceMs = now - lastOutputTime;

        // Show periodic progress for long-running operations
        if (silenceMs > PROGRESS_INTERVAL_MS && totalOutput.length > 0 && now - lastProgressTime > PROGRESS_INTERVAL_MS) {
          lastProgressTime = now;
          const mins = Math.floor(silenceMs / 60000);
          const secs = Math.floor((silenceMs % 60000) / 1000);
          const duration = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

          // Show background agent status if waiting for them
          if (pendingBackgroundTasks.size > 0) {
            const taskNames = Array.from(pendingBackgroundTasks.values())
              .map(t => t.description)
              .join(', ');
            this._addProgressMessage(projectId, chatSessionId,
              `⏳ Waiting for ${pendingBackgroundTasks.size} agent(s): ${taskNames} (${duration})`,
              broadcastFn);
          } else {
            this._addProgressMessage(projectId, chatSessionId, `⏳ ${tool} is still working... (${duration} since last activity)`, broadcastFn);
          }
        }

        // Check for completion via shell prompt or result event
        if (idleRounds >= 2 && totalOutput.length > 0) {
          const clean = this._stripAnsi(totalOutput);
          if (resultEventSeen || this._shellPromptReturned(clean)) break;
        }

        // Check if job was failed by JobManager (activity timeout)
        if (job) {
          const currentJob = jobManager.getJob(job.id);
          if (currentJob && (currentJob.status === 'failed' || currentJob.status === 'timeout')) {
            return { success: false, error: currentJob.error || 'Operation timed out due to inactivity' };
          }
        }

        continue;
      }

      idleRounds = 0;
      lastOutputTime = now;
      totalOutput += chunk;

      // Persist chunk if callback provided (streaming persistence + job tracking)
      if (onChunk) {
        onChunk(chunk);
      }

      const cleanChunk = this._stripAnsi(chunk);
      const cleanTotal = this._stripAnsi(totalOutput);

      // ── Parse background task events ──
      const taskEvents = this._parseTaskEvents(cleanChunk);
      for (const event of taskEvents) {
        if (event.type === 'task_started') {
          console.log(`[agentGateway] Background task STARTED: ${event.taskId} - ${event.description}`);
          pendingBackgroundTasks.set(event.taskId, {
            description: event.description,
            startedAt: Date.now(),
          });
          this._addProgressMessage(projectId, chatSessionId,
            `🚀 Background agent started: ${event.description}`,
            broadcastFn);
        } else if (event.type === 'task_completed') {
          console.log(`[agentGateway] Background task COMPLETED: ${event.taskId} - ${event.summary || 'done'}`);
          const task = pendingBackgroundTasks.get(event.taskId);
          pendingBackgroundTasks.delete(event.taskId);
          if (task) {
            const elapsed = Math.round((Date.now() - task.startedAt) / 1000);
            this._addProgressMessage(projectId, chatSessionId,
              `✅ Agent completed: ${event.summary || task.description} (${elapsed}s)`,
              broadcastFn);
          }
          // Check if all background tasks are now done
          if (pendingBackgroundTasks.size === 0 && resultEventSeen) {
            allTasksCompleted = true;
            // All background tasks are done - send follow-up to get final summary
            this._addProgressMessage(projectId, chatSessionId,
              `🔄 All background agents completed. Getting final summary...`,
              broadcastFn);
            // Send a follow-up prompt to Claude to process the results
            const followUpCmd = this._buildToolCommand(
              tool,
              'All background agents have completed. Please summarize the results and let me know what was done.',
              chatSessionId,
              projectId,
              mode,
              assistantSettings,
            );
            agentShellPool.write(shellSessionId, followUpCmd + '\n');
            resultEventSeen = false; // Reset to wait for the new result
          }
        }
      }

      // ── Event-driven completion: look for {"type":"result"} or Codex {"type":"turn.completed"} ──
      if (cleanChunk.includes('"type":"result"') || cleanChunk.includes('"type": "result"')
        || cleanChunk.includes('"type":"turn.completed"') || cleanChunk.includes('"type": "turn.completed"')) {
        resultEventSeen = true;
        // Extract the result text for checking
        const resultMatch = cleanChunk.match(/"result"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (resultMatch) {
          lastResultText = resultMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
        }

        // If there are pending background tasks, DON'T break - keep waiting
        if (pendingBackgroundTasks.size > 0) {
          this._addProgressMessage(projectId, chatSessionId,
            `⏳ Waiting for ${pendingBackgroundTasks.size} background agent(s) to complete...`,
            broadcastFn);
          // Log which tasks are still pending
          for (const [taskId, task] of pendingBackgroundTasks) {
            console.log(`[agentGateway] Still waiting for task ${taskId}: ${task.description}`);
          }
          // Continue waiting - don't break
          continue;
        }

        // No pending tasks - wait briefly for trailing output (shell prompt)
        const trailing = await this._waitForOutput(shellSessionId, ctx, 1500);
        if (trailing) {
          totalOutput += trailing;
          if (onChunk) onChunk(trailing);
        }
        break;
      }

      // Shell prompt fallback
      if (this._shellPromptReturned(cleanTotal)) {
        const trailing = await this._waitForOutput(shellSessionId, ctx, 1000);
        if (trailing) {
          totalOutput += trailing;
          if (onChunk) onChunk(trailing);
        }
        break;
      }

      // ── Live status reactions (throttled to every 2s) ──
      if (now - lastProgressTime > 2000) {
        const event = this._parseStreamEvent(cleanChunk);
        if (event) {
          lastProgressTime = now;
          this._addProgressMessage(projectId, chatSessionId, event, broadcastFn);
        }
      }

      // ── Auto-approve prompts (Agent mode only) ──
      // In Plan mode, Claude should only analyze — no prompts expected
      if (mode === 'agent') {
        const fastResponse = this._fastPromptDetect(cleanChunk);
        if (fastResponse !== null) {
          agentShellPool.write(shellSessionId, fastResponse + '\n');
          this._addProgressMessage(projectId, chatSessionId, `✓ Auto-confirmed`, broadcastFn);
        } else {
          const provider = llmProvider.getSettings().provider;
          if (provider !== 'ollama' && this._looksLikePrompt(cleanChunk)) {
            const autoResponse = await this._smartAutoConfirm(cleanChunk, projectId, chatSessionId, broadcastFn);
            if (autoResponse !== null) {
              agentShellPool.write(shellSessionId, autoResponse + '\n');
              this._addProgressMessage(projectId, chatSessionId, `✓ Auto-confirmed: "${autoResponse}"`, broadcastFn);
            }
          }
        }
      }
    }

    // ── Process output ──
    const cleanOutput = this._stripAnsi(totalOutput).trim();
    if (!cleanOutput) {
      return { success: false, retry: true, retryReason: 'No output received', retryType: 'timeout' };
    }

    // Extract result and session_id
    let displayOutput = cleanOutput;
    if (tool === 'claude' || tool === 'copilot') {
      const parsed = this._parseJsonToolOutput(cleanOutput, cmd);
      displayOutput = parsed.text;
      if (parsed.sessionId) {
        // Preserve lastSkillHash so skill-change detection works across messages
        const prevState = this._cliSessions.get(chatSessionId);
        const newState = { ...(prevState || {}), cliSessionId: parsed.sessionId, messageCount: (cliState?.messageCount || 0) + 1 };
        this._cliSessions.set(chatSessionId, newState);
        chatStore.updateSessionMeta(projectId, chatSessionId, { cliSessionId: parsed.sessionId });
      }
      // Check for error in the result
      if (parsed.isError) {
        // Don't retry on auth errors - user needs to re-login
        if (parsed.errorType === 'auth') {
          return { success: false, retry: false, displayOutput, error: displayOutput };
        }
        // Don't retry on rate limits - just show the message
        if (parsed.errorType === 'rate_limit') {
          return { success: false, retry: false, displayOutput, error: displayOutput };
        }
        // Retry on context overflow with compaction
        const isOverflow = /context.*overflow|token.*limit|too many tokens/i.test(displayOutput);
        if (isOverflow) {
          return { success: false, retry: true, retryReason: 'Context overflow', retryType: 'compaction' };
        }
        // Other errors can be retried
        return { success: false, retry: true, retryReason: displayOutput.slice(0, 100), retryType: 'error' };
      }
    } else if (tool === 'opencode') {
      const parsed = this._parseOpencodeJsonOutput(cleanOutput, cmd);
      displayOutput = parsed.text;
      if (parsed.sessionId) {
        // Preserve lastSkillHash so skill-change detection works across messages
        const prevState = this._cliSessions.get(chatSessionId);
        const newState = { ...(prevState || {}), cliSessionId: parsed.sessionId, messageCount: (cliState?.messageCount || 0) + 1 };
        this._cliSessions.set(chatSessionId, newState);
        chatStore.updateSessionMeta(projectId, chatSessionId, { cliSessionId: parsed.sessionId });
      }
      if (parsed.isError) {
        // Permanent errors (model not found, bad config) must not be retried
        if (parsed.isPermanentError) {
          return { success: false, retry: false, error: displayOutput, displayOutput };
        }
        return { success: false, retry: true, retryReason: displayOutput.slice(0, 100), retryType: 'error', displayOutput };
      }
    } else if (tool === 'codex') {
      const parsed = this._parseCodexJsonOutput(cleanOutput, cmd);
      displayOutput = parsed.text;
      if (parsed.sessionId) {
        const prevState = this._cliSessions.get(chatSessionId);
        const newState = { ...(prevState || {}), cliSessionId: parsed.sessionId, messageCount: (cliState?.messageCount || 0) + 1 };
        this._cliSessions.set(chatSessionId, newState);
        chatStore.updateSessionMeta(projectId, chatSessionId, { cliSessionId: parsed.sessionId });
      }
      if (parsed.isError) {
        // Codex auth/rate-limit errors are often transient (retry usually works),
        // so treat them as retryable instead of terminal failures.
        if (parsed.errorType === 'auth') {
          return { success: false, retry: true, retryReason: 'Codex transient auth error', retryType: 'codex-transient' };
        }
        if (parsed.errorType === 'rate_limit') {
          return { success: false, retry: true, retryReason: 'Codex rate limit', retryType: 'codex-rate-limit' };
        }
        return { success: false, retry: true, retryReason: displayOutput.slice(0, 100), retryType: 'error' };
      }
    } else if (tool === 'ollama') {
      const parsed = this._parseOllamaOutput(cleanOutput, cmd);
      displayOutput = parsed.text;
      if (parsed.isError) {
        return { success: false, retry: true, retryReason: displayOutput.slice(0, 100), retryType: 'error' };
      }
    } else {
      displayOutput = this._extractToolResponse(cleanOutput, cmd);
    }

    // Check for lost context
    if (/don't have context|no context|start of.*conversation|clarify what/i.test(displayOutput)) {
      return { success: false, retry: true, retryReason: `${tool} lost context`, retryType: 'context-lost' };
    }

    return { success: true, displayOutput, cleanOutput };
  }

  // ── Output cleaning helpers ──

  async _cleanContent(displayOutput) {
    let content;
    // Only use LLM cleanup if there are actual escape sequences to clean
    // Clean JSON-parsed content should NOT be sent to LLM (it mangles long responses)
    const hasEscapeSequences = displayOutput.includes('\x1b') || displayOutput.includes('\u001b');

    if (!hasEscapeSequences) {
      // Content is already clean - use as-is regardless of length
      content = displayOutput;
    } else {
      // Has terminal escape sequences - try to clean with LLM
      try {
        const result = await llmProvider.generateResponse(
          `Clean up this terminal output for a chat UI. Keep ALL content. Use markdown. NEVER use HTML tags.\n\nOutput:\n${displayOutput.slice(-5000)}`,
          { maxTokens: 4000, temperature: 0.1 }
        );
        content = result.response;
      } catch {
        // Fallback: strip escape sequences manually
        content = displayOutput.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
      }
    }
    // HTML safety net
    return content
      .replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**')
      .replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**')
      .replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*')
      .replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*')
      .replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`');
  }

  async _analyzeResponseForReview({ projectId, userMessage, assistantContent, mode }) {
    if (!assistantContent) return null;

    const hasPlanSignals = mode === 'plan' || /\b(PRD|plan|tasks added|phases?)\b/i.test(assistantContent);
    if (!hasPlanSignals) return null;

    const mdMatches = Array.from(assistantContent.matchAll(/\b([\w./-]+\.md)\b/gi));
    if (mdMatches.length === 0) return null;

    const { default: Project } = await import('./models/Project.js');
    const project = Project.findById(projectId);
    if (!project?.folderPath) {
      const firstPath = this._pickReviewDocPath(mdMatches);
      if (!firstPath) return null;
      const summary = await this._summarizeReviewFromAssistant(userMessage, assistantContent);
      return {
        type: 'prd-review',
        docPath: firstPath,
        docPreview: null,
        summary,
        originalPrompt: userMessage,
        source: 'assistant-response',
      };
    }

    for (const m of mdMatches) {
      const relPath = m[1];
      if (!relPath) continue;

      if (!this._isReviewDocPath(relPath)) continue;

      const projectRoot = path.resolve(project.folderPath);
      const absPath = this._resolveReviewDocPath(projectRoot, relPath);
      if (!absPath) continue;

      try {
        const md = fs.readFileSync(absPath, 'utf-8');
        if (!md || md.trim().length === 0) continue;

        const summary = await this._summarizeReviewDoc(userMessage, md);
        return {
          type: 'prd-review',
          docPath: relPath,
          docPreview: md.length > 12000 ? `${md.slice(0, 12000)}\n\n... (truncated)` : md,
          summary,
          originalPrompt: userMessage,
        };
      } catch {}
    }

    const fallbackPath = this._pickReviewDocPath(mdMatches);
    if (!fallbackPath) return null;
    const summary = await this._summarizeReviewFromAssistant(userMessage, assistantContent);
    return {
      type: 'prd-review',
      docPath: fallbackPath,
      docPreview: null,
      summary,
      originalPrompt: userMessage,
      source: 'assistant-response',
    };
  }

  /**
   * Detect if the agent's response indicates it wants to see logs or output.
   * Returns a logContext object with hints, or null.
   */
  _detectLogRequest(content) {
    if (!content) return null;

    const patterns = [
      { regex: /\b(?:check|inspect|view|see|look at|examine|review|read)\b.{0,30}\b(?:logs?|output|console|terminal|stderr|stdout)\b/i, type: 'generic' },
      { regex: /\btail\s+-[fFn]/i, type: 'tail' },
      { regex: /\b(?:error|stack\s*trace|traceback|exception)\b.{0,20}\b(?:log|output|console)\b/i, type: 'error-log' },
      { regex: /\bI\s+(?:would need|need|want)\s+to\s+(?:see|check|view|inspect)\b.{0,30}\b(?:log|output|terminal)/i, type: 'need-logs' },
      { regex: /\b(?:can you|could you|please)\s+(?:share|show|provide|paste)\b.{0,30}\b(?:log|output|terminal|console)/i, type: 'ask-logs' },
      { regex: /\b(?:docker\s+logs|journalctl|pm2\s+logs|npm\s+run.*logs)\b/i, type: 'command' },
    ];

    // Extract file paths mentioned with log-related context
    const fileHints = [];
    const fileMatch = content.match(/(?:log|output)\s+(?:file|at|in|from)\s+[`"]?([/\w.-]+)[`"]?/i);
    if (fileMatch) fileHints.push(fileMatch[1]);

    for (const { regex, type } of patterns) {
      if (regex.test(content)) {
        return { detected: true, type, fileHints };
      }
    }

    return null;
  }

  _isReviewDocPath(relPath) {
    const fileName = path.basename(relPath || '');
    return /^prd.*\.md$/i.test(fileName) || /^plan.*\.md$/i.test(fileName);
  }

  _pickReviewDocPath(matches) {
    for (const m of matches || []) {
      const p = m?.[1];
      if (p && this._isReviewDocPath(p)) return p;
    }
    return null;
  }

  _resolveReviewDocPath(projectRoot, relPath) {
    const normalized = (relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized) return null;

    const segments = normalized.split('/').filter(Boolean);
    if (segments.length === 0) return null;

    for (let i = 0; i < segments.length; i++) {
      const candidateRel = segments.slice(i).join('/');
      const candidateAbs = path.resolve(projectRoot, candidateRel);
      const relative = path.relative(projectRoot, candidateAbs);
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
      if (fs.existsSync(candidateAbs)) return candidateAbs;
    }

    return null;
  }

  async _summarizeReviewFromAssistant(userMessage, assistantContent) {
    return this._summarizeReviewDoc(
      userMessage,
      `Assistant response summary:\n${assistantContent.slice(0, 12000)}`
    );
  }

  async _summarizeReviewDoc(userMessage, markdownDoc) {
    try {
      const prompt = `You are reviewing a product/planning document for a coding agent workflow.\n\nUser request:\n${(userMessage || '').slice(0, 1000)}\n\nDocument:\n${markdownDoc.slice(0, 12000)}\n\nReturn JSON only with this exact shape:\n{\n  "title": "short title",\n  "highlights": ["bullet", "bullet", "bullet"],\n  "risks": ["risk", "risk"],\n  "readyToExecute": true\n}`;
      const res = await llmProvider.generateResponse(prompt, { maxTokens: 600, temperature: 0.1 });
      const text = (res?.response || '').trim();
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return null;
      const parsed = JSON.parse(match[0]);
      return {
        title: parsed.title || 'Plan Review',
        highlights: Array.isArray(parsed.highlights) ? parsed.highlights.slice(0, 5) : [],
        risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 5) : [],
        readyToExecute: !!parsed.readyToExecute,
      };
    } catch {
      return null;
    }
  }

  _cleanRawOutput(cleanOutput) {
    return cleanOutput.split('\n')
      .filter(l => {
        const t = l.trim();
        if (t.startsWith('{"type"')) return false;
        if (t.startsWith('claude -p')) return false;
        if (t.startsWith('copilot -p')) return false;
        if (t.startsWith('opencode run')) return false;
        if (t.startsWith('aider ')) return false;
        // Filter out preamble content that gets echoed
        if (t.startsWith('> MODE:')) return false;
        if (t.startsWith('> ABOUT THE USER:')) return false;
        if (t.startsWith('> PROJECT RULES:')) return false;
        if (t.startsWith('> GLOBAL RULES')) return false;
        if (t.startsWith('> IMPORTANT:')) return false;
        if (t.startsWith('> ---')) return false;
        if (/^>\s*(Name|Role|Languages|Code style|Preferred tone|Preferences):/.test(t)) return false;
        if (/^>\s*\d+\./.test(t)) return false; // Numbered rules
        // Filter out command-line arguments that get echoed
        if (t.includes('--output-format stream-json')) return false;
        if (t.includes('--dangerously-skip-permissions')) return false;
        if (t.includes('--yolo')) return false;
        if (t.includes('--verbose')) return false;
        if (t.includes("--resume '")) return false;
        // Filter out shell prompts
        if (/^[>#$]\s*$/.test(t)) return false;
        if (/^\w+@[\w.-]+:.*[$#]\s*$/.test(t)) return false; // user@host:path$
        return t.length > 0;
      })
      .join('\n').trim() || cleanOutput.slice(-3000);
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
   * Distill context from chat history using the local LLM.
   * Produces a concise brief of key decisions, files, errors, and constraints
   * that should be injected into follow-up messages to prevent context loss.
   *
   * Returns null if distillation is unnecessary (first message, too few messages,
   * weak LLM, or fresh session).
   */
  async _distillContext(projectId, chatSessionId, userMessage) {
    const provider = llmProvider.getSettings().provider;
    if (provider === 'ollama') return null; // Skip for weak models

    // Check if we have enough history to warrant distillation
    let messages;
    try {
      messages = chatStore.getMessages(projectId, { sessionId: chatSessionId, limit: 30 }).reverse();
    } catch { return null; }

    // Need at least 2 user+agent exchanges to distill
    const substantive = messages.filter(m => m.role === 'user' || m.role === 'agent');
    if (substantive.length < 3) return null;

    // Skip distillation if the last agent response was very recent (< 2 min)
    // and the CLI session is still alive — the tool likely has full context
    const cliState = this._cliSessions.get(chatSessionId);
    if (cliState?.cliSessionId) {
      const lastAgent = messages.find(m => m.role === 'agent');
      if (lastAgent?.timestamp) {
        const ageSec = (Date.now() - new Date(lastAgent.timestamp).getTime()) / 1000;
        if (ageSec < 120) return null;
      }
    }

    // Build the conversation transcript for the LLM to analyze
    const transcript = substantive
      .slice(-20) // Last 20 substantive messages
      .map(m => {
        const content = m.content.slice(0, 600);
        return `[${m.role}]: ${content}`;
      })
      .join('\n');

    // Include project rules so the LLM can flag relevant ones
    const rules = this._getProjectRules(projectId);

    const prompt = `You are a context distiller for an AI coding assistant orchestrator. Analyze the conversation history below and produce a concise context brief that will be injected into the next message to the coding assistant.

CONVERSATION HISTORY:
${transcript}

NEXT USER MESSAGE:
${userMessage.slice(0, 400)}

${rules ? `PROJECT RULES:\n${rules}\n` : ''}INSTRUCTIONS:
Extract ONLY what the coding assistant needs to handle the next message correctly. Include:
1. Key decisions made (what was agreed, what approach was chosen)
2. Files modified or discussed (with paths if mentioned)
3. Errors encountered and their resolutions
4. Constraints or requirements established by the user
5. Any unfinished work or pending items
${rules ? '6. Which project rules are relevant to the current request (quote the rule number and text)' : ''}

Format as a brief bullet list. Be concise — max 8 bullets. Omit anything the coding assistant can derive from the codebase itself. If the conversation is straightforward and the next message is self-contained, respond with just "SKIP".`;

    try {
      const result = await llmProvider.generateResponse(prompt, { maxTokens: 400, temperature: 0.1 });
      const response = result.response?.trim();
      if (!response || response === 'SKIP' || response.length < 20) return null;
      return response;
    } catch {
      return null; // Distillation is best-effort — never block on failure
    }
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

  // ── Context builders ──

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

  /**
   * Get project rules (from IDE's globalRules + project-specific rules).
   * These are injected into the first message to ensure Claude/Copilot always follows them.
   */
  _getProjectRules(projectId) {
    try {
      const db = getDB();
      const parts = [];

      // Global rules
      const globalRules = (db.data.globalRules || []).filter(r => r.enabled !== false);
      if (globalRules.length > 0) {
        parts.push('GLOBAL RULES (always follow):');
        globalRules.forEach((r, i) => parts.push(`${i + 1}. ${r.text}`));
      }

      // Project-specific rules
      const project = (db.data.projects || []).find(p => p.id === projectId);
      if (project?.rules?.length > 0) {
        const disabledIndices = new Set(project.promptSettings?.disabledRuleIndices || []);
        const activeRules = project.rules.filter((_, i) => !disabledIndices.has(i));
        if (activeRules.length > 0) {
          parts.push('\nPROJECT RULES:');
          activeRules.forEach((r, i) => parts.push(`${i + 1}. ${r}`));
        }
      }

      return parts.join('\n');
    } catch { return ''; }
  }

  /**
   * Build the first-message preamble that includes:
   * - CLAUDE.md instruction
   * - Profile context
   * - Project rules
   * - Mode instruction (agent vs plan)
   */
  _buildFirstMessagePreamble(tool, projectId, mode, assistantSettings = {}) {
    const parts = [];

    // Skip skills for Ollama models and Aider — Ollama models output raw JSON instead of
    // using tools; Aider doesn't understand Claude Code tool-use skill format at all.
    const isOllamaModel = assistantSettings?.model?.startsWith('ollama/') || tool === 'ollama';

    // Tool-specific CLAUDE.md instruction
    if (tool === 'claude') {
      parts.push('IMPORTANT: Read CLAUDE.md and always follow all rules established there.');
    } else if (tool === 'copilot') {
      parts.push('IMPORTANT: Follow all project conventions and rules established in the repository.');
    } else if (tool === 'opencode') {
      parts.push('IMPORTANT: Read CLAUDE.md (if present) and always follow all project conventions and rules established there.');
    } else if (tool === 'codex') {
      parts.push('IMPORTANT: Follow all project conventions and rules. Read any CLAUDE.md, AGENTS.md, or .codex/ rules files if present.');
    }

    // Mode instruction — skip for Aider: it edits files directly and doesn't follow
    // agent/plan mode personas. Injecting them confuses the underlying model.
    if (tool !== 'aider') {
      if (mode === 'plan') {
        parts.push('\nMODE: PLAN — You are in planning mode. Do NOT make any changes to files or run any commands that modify the codebase.\n\nYou are acting as a Chief Technology Officer. Your job is to identify the best solution given the full context of this project.\n- Present only the most viable options — omit approaches that are unlikely to work given the current stack, constraints, or scale.\n- Prioritize scalability, performance, and maintainability in every recommendation.\n- Use the full context available from this project (codebase, architecture, conventions, dependencies) to present an informed solution.\n- Follow the user\'s instructions precisely.\n- Do not execute anything. Present your analysis and recommendation clearly, then wait for explicit approval before any changes are made.');
      } else if (mode === 'plan-review') {
        parts.push('\nDo NOT make any changes to files or run any commands. Only produce written analysis and recommendations.');
      } else {
        parts.push('\nMODE: AGENT — You are in autonomous agent mode. Execute tasks directly:\n- Make file changes as needed\n- Run commands and tests\n- Auto-approve safe operations\n- Commit and push when asked\n- Report results when done\n- IMPORTANT: Never tail logs, watch files, or wait for external events. Do not use commands that block indefinitely (e.g. tail -f, watch, sleep loops). Complete your task with the information available in a single pass and report results immediately.');
      }
    }

    // Profile
    const profile = this._getProfileContext();
    if (profile) parts.push(`\nABOUT THE USER:\n${profile}`);

    // Project rules
    const rules = this._getProjectRules(projectId);
    if (rules) parts.push(`\n${rules}`);

    // Active skills (skip for Ollama models and Aider — incompatible tool-use format)
    if (!isOllamaModel && tool !== 'aider') {
      const skillContext = skillManager.buildSkillContext(projectId);
      if (skillContext) parts.push(`\n${skillContext}`);
    }

    return parts.join('\n');
  }

  // ── Command building ──

  _quoteCliArg(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
  }

  _buildToolOptionArgs(tool, assistantSettings = {}) {
    let args = '';

    if (supportsSessionModelSelection(tool) && assistantSettings?.model) {
      args += ` --model ${this._quoteCliArg(assistantSettings.model)}`;
    }

    if (supportsSessionEffortSelection(tool) && assistantSettings?.effort) {
      if (tool === 'copilot') {
        args += ` --reasoning-effort ${this._quoteCliArg(assistantSettings.effort)}`;
      } else if (tool === 'claude') {
        args += ` --effort ${this._quoteCliArg(assistantSettings.effort)}`;
      } else if (tool === 'opencode') {
        args += ` --variant ${this._quoteCliArg(assistantSettings.effort)}`;
      }
    }

    return args;
  }

  _buildToolCommand(tool, message, chatSessionId, projectId, mode = 'agent', assistantSettings = {}, distilledContext = null) {
    let cliState = this._cliSessions.get(chatSessionId);
    if (!cliState?.cliSessionId && chatSessionId && projectId) {
      const stored = chatStore.getSession(projectId, chatSessionId);
      if (stored?.cliSessionId) {
        cliState = { cliSessionId: stored.cliSessionId, messageCount: stored.messageCount || 1 };
        this._cliSessions.set(chatSessionId, cliState);
        console.log(`[agentGateway] Restored CLI session from disk: ${stored.cliSessionId}`);
      }
    }

    const isFirstMessage = !cliState?.cliSessionId;

    // Skip skills for Ollama models and Aider — incompatible tool-use format
    const isOllamaModel = assistantSettings?.model?.startsWith('ollama/') || tool === 'ollama';

    // Compute a lightweight skill hash to detect mid-session changes
    const skillContext = (isOllamaModel || tool === 'aider') ? null : skillManager.buildSkillContext(projectId);
    const skillHash = skillContext
      ? String(skillContext.length) + '|' + skillContext.slice(0, 64)
      : '';

    let fullMessage;
    if (tool === 'aider') {
      // Aider: always use a clean structured message. Rules are embedded with XML tags
      // so the model can distinguish instructions from the task (--system-prompt not
      // available until Aider v0.87+).
      const aiderRulesPreamble = (() => {
        const rules = this._getProjectRules(projectId);
        if (!rules) return '';
        return `<project_rules>\n${rules}\n</project_rules>\n\n`;
      })();
      fullMessage = `${aiderRulesPreamble}<task>\nThink carefully and thoroughly. Before making any changes, read all relevant project files to fully understand the existing code, patterns, and context.\n\n${message}\n</task>`;
    } else if (isFirstMessage) {
      const preamble = this._buildFirstMessagePreamble(tool, projectId, mode, assistantSettings);
      fullMessage = preamble + '\n\n---\n\n' + message;
      // Record the skill hash so we can detect changes on future messages
      this._cliSessions.set(chatSessionId, { ...(cliState || {}), lastSkillHash: skillHash });
    } else if (skillContext && cliState?.lastSkillHash !== skillHash) {
      // Skills changed since the session started — re-inject them before the user's message
      fullMessage = `[Note: Your active skills have been updated. Apply the following going forward:]\n${skillContext}\n\n---\n\n${message}`;
      this._cliSessions.set(chatSessionId, { ...cliState, lastSkillHash: skillHash });
    } else {
      fullMessage = message;
    }

    // Inject distilled context for follow-up messages
    // This ensures the coding assistant retains key decisions, files, and constraints
    // even if its own session memory was lost, compacted, or drifted.
    if (!isFirstMessage && distilledContext) {
      fullMessage = `[Session Context — do not repeat this back, use it to inform your response]\n${distilledContext}\n\n[User Request]\n${fullMessage}`;
    }
    const encoded = Buffer.from(fullMessage, 'utf8').toString('base64');
    const promptArg = `\"$(printf %s '${encoded}' | base64 -d)\"`;

    switch (tool) {
      case 'claude': {
        let cmd = `claude -p ${promptArg} --output-format stream-json --verbose --dangerously-skip-permissions`;
        cmd += this._buildToolOptionArgs(tool, assistantSettings);
        if (cliState?.cliSessionId) cmd += ` --resume '${cliState.cliSessionId}'`;
        return cmd;
      }
      case 'copilot': {
        let cmd = `copilot -p ${promptArg} --output-format json --yolo`;
        cmd += this._buildToolOptionArgs(tool, assistantSettings);
        if (cliState?.cliSessionId) cmd += ` --resume '${cliState.cliSessionId}'`;
        return cmd;
      }
      case 'opencode': {
        let cmd = `opencode run ${promptArg} --format json --dangerously-skip-permissions`;
        cmd += this._buildToolOptionArgs(tool, assistantSettings);
        if (cliState?.cliSessionId) cmd += ` --session '${cliState.cliSessionId}'`;
        return cmd;
      }
      case 'codex': {
        if (cliState?.cliSessionId) {
          // Resume an existing session with a follow-up prompt
          let cmd = `codex exec resume '${cliState.cliSessionId}' --json --dangerously-bypass-approvals-and-sandbox ${promptArg}`;
          cmd += this._buildToolOptionArgs(tool, assistantSettings);
          return cmd;
        }
        let cmd = `codex exec --json --dangerously-bypass-approvals-and-sandbox ${promptArg}`;
        cmd += this._buildToolOptionArgs(tool, assistantSettings);
        return cmd;
      }
      case 'ollama': {
        // ollama run <model> in non-interactive mode — exits after one response.
        // Model is required; fall back to the configured LLM provider model or llama3.2.
        const ollamaModel = assistantSettings?.model
          || (() => { try { return llmProvider.getSettings().model || 'llama3.2'; } catch { return 'llama3.2'; } })();
        return `ollama run ${this._quoteCliArg(ollamaModel)} ${promptArg}`;
      }
      case 'aider': {
        // --no-pretty disables the spinner/backspace chars that appear as garbage in xterm.js
        let cmd = `aider --message ${promptArg} --yes --no-pretty`;
        if (assistantSettings?.model) {
          cmd += ` --model ${this._quoteCliArg(assistantSettings.model)}`;
        }
        return cmd;
      }
      case 'gemini':
        return `gemini -p ${promptArg}`;
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
    const sessionMeta = chatStore.getSession(projectId, chatSessionId);
    if (sessionMeta?.manualName) return;
    try {
      const result = await llmProvider.generateResponse(
        `Generate a short title (3-6 words) for a chat session starting with this message. Just the title, no quotes.\n\nMessage: "${userMessage.slice(0, 200)}"`,
        { maxTokens: 20, temperature: 0.3 }
      );
      const name = result.response.trim().slice(0, 50);
      if (name) chatStore.renameSession(projectId, chatSessionId, name);
    } catch {}
  }

  // ── Multi-loop plan execution ──

  /**
   * Run one internal plan loop silently (no streaming to user).
   *
   * When `pinnedSessionId` is provided the real chat session ID is used so the
   * Claude CLI session is preserved for Agent mode to resume later.
   * When omitted an ephemeral session is created and cleaned up on exit.
   */
  async _runPlanPhase(projectId, message, tool, assistantSettings, ctx, mode = 'plan', pinnedSessionId = null) {
    const isEphemeral = !pinnedSessionId;
    const sessionId = pinnedSessionId || `_plan-internal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const noop = () => {};
    try {
      const result = await this._attemptCliTool(
        projectId, sessionId, message, tool, assistantSettings, noop, ctx, 1, mode, {}
      );
      if (result.success) {
        return await this._cleanContent(result.displayOutput);
      }
      console.warn(`[agentGateway] Plan phase (${mode}) failed: ${result.error}`);
      return null;
    } finally {
      if (isEphemeral) {
        // Clean up ephemeral shell + CLI session state
        const shellId = this._activeShellSessions.get(sessionId);
        if (shellId) {
          try { agentShellPool.killSession(shellId); } catch {}
        }
        this._activeShellSessions.delete(sessionId);
        this._cliSessions.delete(sessionId);
      }
      // For pinned (real) sessions, leave _cliSessions intact so Agent mode can --resume
    }
  }

  /**
   * Ask the local LLM whether a third plan review pass is warranted.
   * Returns true if yes, false otherwise.
   */
  async _shouldRunThirdPlanLoop(planText, critiqueText) {
    try {
      const result = await llmProvider.generateResponse(
        `You are evaluating a technical plan that has gone through two iterations.

FIRST ITERATION (original plan):
${planText.slice(0, 1500)}

SECOND ITERATION (reviewed & improved plan):
${critiqueText.slice(0, 1500)}

Does the second iteration still have significant gaps in any of these areas:
correctness, code quality, best practices, security, scalability, error handling, or testing strategy?

Reply with exactly one word: YES or NO.`,
        { maxTokens: 10, temperature: 0.1 }
      );
      return result.response.trim().toUpperCase().startsWith('YES');
    } catch {
      return false;
    }
  }

  /**
   * Multi-loop plan orchestration:
   *   Loop 1 — CTO creates the plan
   *   Loop 2 — Independent critic reviews it and rewrites gaps
   *   Gate   — Local LLM decides if a third pass is needed
   *   Loop 3 — Senior architect finalises with reinforced quality prompts (optional)
   *
   * Progress messages keep the user informed throughout. Only the final
   * synthesised plan is shown as the agent response.
   */
  async _executePlanWithReview(projectId, sessionId, userMessage, tool, assistantSettings, broadcastFn, ctx, skipUnread = false) {
    // Create a streaming placeholder visible to the user from the start
    const streamingMsg = chatStore.createStreamingMessage({
      projectId,
      sessionId,
      role: 'agent',
      initialContent: `Planning with ${tool}...`,
      metadata: { tool, streaming: true, planMode: true },
    });
    broadcastFn({
      type: 'chat-message-stream-start',
      projectId,
      sessionId,
      messageId: streamingMsg.id,
    });

    let finalText = null;
    let loopsCompleted = 0;

    try {
      // ── Loop 1: CTO plan ──
      // Use the real sessionId so the Claude CLI session is shared with Agent mode.
      this._addProgressMessage(projectId, sessionId,
        `Analyzing your request and creating a plan...`,
        broadcastFn, null, { transient: true });

      const planText = await this._runPlanPhase(projectId, userMessage, tool, assistantSettings, ctx, 'plan', sessionId);
      if (ctx.aborted) throw new Error('Aborted');
      if (!planText) throw new Error('Plan loop returned no output');

      finalText = planText;
      loopsCompleted = 1;

      // Show the plan to the user immediately after loop 1
      this._addProgressMessage(projectId, sessionId, planText, broadcastFn, null, { transient: true });

      // ── Loop 2: Independent critic ──
      this._addProgressMessage(projectId, sessionId,
        `Reviewing the plan for gaps, edge cases, and improvements...`,
        broadcastFn, null, { transient: true });

      const critiqueMessage =
        `You are an independent technical reviewer — a different system from the one that created this plan.\n` +
        `Your job is to:\n` +
        `- Identify every gap, incorrect assumption, missing edge case, security concern, and scalability issue\n` +
        `- Check for best practice violations specific to this tech stack\n` +
        `- Rewrite it as a complete, production-ready plan that addresses every issue found\n` +
        `- Do NOT make any file changes — only produce a written plan\n\n` +
        `Plan to review:\n---\n${planText}\n---`;

      const critiqueText = await this._runPlanPhase(projectId, critiqueMessage, tool, assistantSettings, ctx, 'plan-review');
      if (ctx.aborted) throw new Error('Aborted');

      if (critiqueText) {
        finalText = critiqueText;
        loopsCompleted = 2;
        // Show the reviewed plan immediately after loop 2
        this._addProgressMessage(projectId, sessionId, critiqueText, broadcastFn, null, { transient: true });
      }

      // ── Gate: should we run a third pass? ──
      // (ephemeral loop — independent additional critic, no codebase access needed)
      let latestCritique = critiqueText;
      if (critiqueText) {
        this._addProgressMessage(projectId, sessionId,
          `Evaluating plan quality...`,
          broadcastFn, null, { transient: true });

        const needsLoop3 = await this._shouldRunThirdPlanLoop(planText, critiqueText);

        if (needsLoop3 && !ctx.aborted) {
          this._addProgressMessage(projectId, sessionId,
            `Running additional quality review for best practices, correctness, and security...`,
            broadcastFn, null, { transient: true });

          const loop3Message =
            `You are a senior technical architect performing an additional quality pass on a plan that has already been through one review cycle.\n` +
            `Focus specifically on: correctness, best practices for this stack, security, error handling, testing strategy, performance, and deployment concerns.\n` +
            `Identify any remaining gaps or issues and list them clearly.\n` +
            `Do NOT produce a final plan — only output a concise list of remaining issues and recommended corrections.\n\n` +
            `Plan to review:\n---\n${critiqueText}\n---`;

          const loop3Text = await this._runPlanPhase(projectId, loop3Message, tool, assistantSettings, ctx, 'plan-review');
          if (loop3Text && !ctx.aborted) {
            latestCritique = `${critiqueText}\n\n--- Additional review pass ---\n${loop3Text}`;
            loopsCompleted = 3;
            this._addProgressMessage(projectId, sessionId,
              `Additional issues found — synthesizing into final plan...`,
              broadcastFn, null, { transient: true });
          }
        }
      }

      // ── Synthesis: produce the final coherent plan in the pinned session ──
      // Runs with --resume so Claude has full codebase context from Loop 1.
      // It verifies critique findings against actual code, then produces ONE
      // self-contained, definitive plan as the final deliverable.
      if (latestCritique && !ctx.aborted) {
        this._addProgressMessage(projectId, sessionId,
          `Synthesizing all findings into the final plan...`,
          broadcastFn, null, { transient: true });

        const synthesisMessage =
          `An independent technical review of your plan has been completed. Here are the findings:\n\n` +
          `--- INDEPENDENT REVIEW ---\n${latestCritique}\n---\n\n` +
          `Using your full knowledge of this codebase:\n` +
          `1. For each critique point, verify it against the actual code — call out any that are factually incorrect\n` +
          `2. Incorporate every valid finding into the plan\n` +
          `3. Produce the FINAL, DEFINITIVE, COMPLETE plan as a standalone document\n` +
          `   - Do NOT reference "the original plan" or "the review" — write the plan as if it were the only document\n` +
          `   - Include all context, phases, schemas, endpoints, migration scripts, and code patterns needed\n` +
          `   - A developer must be able to start implementing directly from this document alone\n` +
          `4. Do NOT make any file changes`;

        const synthesisText = await this._runPlanPhase(
          projectId, synthesisMessage, tool, assistantSettings, ctx, 'plan', sessionId
        );
        if (synthesisText && !ctx.aborted) {
          finalText = synthesisText;
          loopsCompleted += 1; // count synthesis as an extra pass
          this._addProgressMessage(projectId, sessionId, synthesisText, broadcastFn, null, { transient: true });
        }
      }

      // ── Finalise ──
      const reviewMeta = await this._analyzeResponseForReview({
        projectId,
        userMessage,
        assistantContent: finalText,
        mode: 'plan',
      });

      chatStore.finalizeStreamingMessage({
        projectId,
        sessionId,
        messageId: streamingMsg.id,
        finalContent: finalText,
        metadata: {
          tool,
          planLoops: loopsCompleted,
          ...(reviewMeta ? { review: reviewMeta } : {}),
        },
      });

      broadcastFn({
        type: 'chat-message-stream-complete',
        projectId,
        sessionId,
        messageId: streamingMsg.id,
        message: {
          ...streamingMsg,
          content: finalText,
          metadata: {
            tool,
            planLoops: loopsCompleted,
            ...(reviewMeta ? { review: reviewMeta } : {}),
          },
        },
      });

      if (!skipUnread) {
        const changed = chatStore.markSessionUnread(projectId, sessionId);
        if (changed) {
          broadcastFn({ type: 'session-unread', projectId, sessionId, hasUnread: true });
        }
      }

      this._persistContext(projectId, sessionId, userMessage, finalText);

    } catch (err) {
      if (err.message !== 'Aborted') {
        console.error('[agentGateway] Plan review loop failed:', err.message);
      }

      const errorContent = finalText || `Planning failed: ${err.message}`;

      chatStore.finalizeStreamingMessage({
        projectId,
        sessionId,
        messageId: streamingMsg.id,
        finalContent: errorContent,
        metadata: { tool, planLoops: loopsCompleted, error: !finalText },
      });

      broadcastFn({
        type: 'chat-message-stream-complete',
        projectId,
        sessionId,
        messageId: streamingMsg.id,
        message: {
          ...streamingMsg,
          content: errorContent,
          metadata: { tool, planLoops: loopsCompleted },
        },
      });
    }
  }

  // ── Plan execution ──

  async executePlan({ projectId, sessionId = null, steps, tool = 'claude', model = null, effort = null, broadcastFn }) {
    const ctx = { aborted: false, startedAt: Date.now() };
    this._running.set(sessionId, { ...ctx, queue: null });

    try {
      broadcastFn({ type: 'agent-status', projectId, sessionId, busy: true });
      for (let i = 0; i < steps.length && !ctx.aborted; i++) {
        const tasks = steps.map((s, j) => ({
          title: s.title,
          status: j < i ? 'done' : j === i ? 'running' : 'pending',
        }));
        this._addProgressMessage(projectId, sessionId, `Step ${i + 1}/${steps.length}: ${steps[i].title}`, broadcastFn, tasks);
        await this._sendToCliTool(projectId, sessionId, steps[i].prompt, tool, { model, effort }, broadcastFn, ctx);
        if (ctx.aborted) break;
      }
      if (!ctx.aborted) {
        this._addAgentMessage(projectId, sessionId, 'Plan completed.', broadcastFn, {
          tasks: steps.map(s => ({ title: s.title, status: 'done' }))
        });
      }
    } catch (error) {
      this._addErrorMessage(projectId, sessionId, `Plan failed: ${error.message}`, broadcastFn);
    } finally {
      this._running.delete(sessionId);
      broadcastFn({ type: 'agent-status', projectId, sessionId, busy: false });
    }
  }

  // ── Helpers ──

  abort(sessionId) {
    const entry = this._running.get(sessionId);
    if (entry) entry.aborted = true;

    const shellSessionId = this._activeShellSessions.get(sessionId);
    if (shellSessionId) {
      try { agentShellPool.write(shellSessionId, '\u0003'); } catch {}
      // Sometimes tools ignore the first interrupt while flushing output.
      setTimeout(() => {
        try { agentShellPool.write(shellSessionId, '\u0003'); } catch {}
      }, 150);
    }
  }

  _waitForRetryBackoff(ctx, ms) {
    return new Promise((resolve) => {
      if (ctx.aborted) {
        resolve(false);
        return;
      }

      const startedAt = Date.now();
      const timer = setTimeout(() => {
        clearInterval(interval);
        resolve(!ctx.aborted);
      }, ms);
      const interval = setInterval(() => {
        if (ctx.aborted) {
          clearTimeout(timer);
          clearInterval(interval);
          resolve(false);
        } else if (Date.now() - startedAt >= ms) {
          clearInterval(interval);
        }
      }, 100);
    });
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
    if (lastLine.startsWith('{') && lastLine.includes('"type"') && (lastLine.includes('"result"') || lastLine.includes('"turn.completed"'))) {
      try { const j = JSON.parse(lastLine); if (j.type === 'result' || j.type === 'turn.completed') return true; } catch {}
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
  async _smartAutoConfirm(text, projectId, sessionId, broadcastFn) {
    const lastBit = text.slice(-500);
    const rules = this._getProjectRules(projectId);
    const profile = this._getProfileContext();
    try {
      const result = await llmProvider.generateResponse(
        `A coding AI tool is asking for input during an end-to-end implementation. Decide what to respond.

Goal: keep the implementation moving end-to-end when the answer is safely derivable from project rules, user profile, or the user's current request.

${profile ? `USER PROFILE:
${profile}

` : ''}${rules ? `PROJECT RULES:
${rules}

` : ''}Prompt: "${lastBit}"

Decision rules:
- If it's asking for approval/confirmation of a safe operation (file edit, command, install): respond YES
- If it's asking for approval of something destructive (delete, force push, drop table): respond NEEDS_USER
- If it's asking an implementation follow-up whose answer is clearly implied by the project rules, user profile, or current request: respond YES with the answer to type
- If it's asking a question that needs the user's subjective choice or missing product decision (which feature name, exact copy, which option to choose): respond NEEDS_USER
- If answering would require inspecting code, logs, runtime state, credentials, external systems, or making assumptions not present in the rules/context: respond NEEDS_USER
- If it's asking to continue/proceed: respond YES
- Prefer end-to-end implementation: do not interrupt the user for questions already answered by rules/context.

Respond with EXACTLY one line:
YES: <response to type> (e.g., "YES: y", "YES: use TypeScript", or "YES: " for enter)
NEEDS_USER`,
        { maxTokens: 80, temperature: 0.1 }
      );

      const response = result.response.trim();
      if (response.startsWith('YES:')) {
        const answer = response.slice(4).trim();
        this._addProgressMessage(projectId, sessionId, `Answered coding-agent prompt from project context: "${answer || '(enter)'}"`, broadcastFn);
        return answer;
      }
      return null; // Needs user input
    } catch {
      return null;
    }
  }

  /**
   * Parse task lifecycle events from stream-json output.
   * Tracks background agents launched with run_in_background:true.
   *
   * Events:
   * - task_started: {"type":"system","subtype":"task_started","task_id":"xxx","description":"..."}
   * - task_notification (completed): {"type":"system","subtype":"task_notification","task_id":"xxx","status":"completed","summary":"..."}
   */
  _parseTaskEvents(chunk) {
    const events = [];
    const lines = chunk.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;

      try {
        const json = JSON.parse(trimmed);

        // Background task started
        if (json.type === 'system' && json.subtype === 'task_started') {
          events.push({
            type: 'task_started',
            taskId: json.task_id,
            description: json.description || 'Background agent',
            toolUseId: json.tool_use_id,
          });
        }

        // Background task completed
        if (json.type === 'system' && json.subtype === 'task_notification' && json.status === 'completed') {
          events.push({
            type: 'task_completed',
            taskId: json.task_id,
            summary: json.summary,
            toolUseId: json.tool_use_id,
          });
        }
      } catch {}
    }

    return events;
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
          if (!toolName && (!input || input === '{}')) {
            return 'Working: coding assistant is using a tool...';
          }
          if (toolName.toLowerCase().includes('bash') || toolName.toLowerCase().includes('shell')) {
            return input ? `Running: \`${input.slice(0, 80)}\`` : 'Running shell command...';
          }
          if (toolName.toLowerCase().includes('read') || toolName.toLowerCase().includes('file')) {
            const path = input.match(/["']?([^\s"']+\.\w+)["']?/)?.[1] || input.slice(0, 60);
            return path ? `Reading: \`${path}\`` : 'Reading project files...';
          }
          if (toolName.toLowerCase().includes('write') || toolName.toLowerCase().includes('edit')) {
            const path = input.match(/["']?([^\s"']+\.\w+)["']?/)?.[1] || input.slice(0, 60);
            return path ? `Editing: \`${path}\`` : 'Editing project files...';
          }
          if (toolName.toLowerCase().includes('glob') || toolName.toLowerCase().includes('grep') || toolName.toLowerCase().includes('search')) {
            return input ? `Searching: ${input.slice(0, 60)}` : 'Searching the codebase...';
          }
          if (toolName && input && input !== '{}') return `Using ${toolName}: ${input.slice(0, 60)}`;
          if (toolName) return `Using ${toolName}...`;
          return 'Working: coding assistant is using a tool...';
        }

        // Assistant message — extract thinking or text content
        if (event.type === 'assistant' && event.message) {
          const content = event.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'thinking' && block.thinking) {
                const t = block.thinking.slice(0, 80);
                return `Thinking: "${t}${t.length >= 80 ? '...' : ''}"`;
              }
              if (block.type === 'text' && block.text) {
                return `Writing response...`;
              }
            }
          } else if (typeof content === 'string' && content) {
            return `Thinking: "${content.slice(0, 80)}"`;
          }
        }

        // Content block — partial response
        if (event.type === 'content_block_delta' || event.type === 'content') {
          const text = event.delta?.text || event.text || '';
          if (text.length > 20) return `Writing response...`;
        }

        // Codex events
        if (event.type === 'item.completed' && event.item) {
          if (event.item.type === 'agent_message') return `Writing response...`;
          if (event.item.type === 'tool_call') {
            const name = event.item.name || event.item.tool || '';
            return `Running: \`${name}\``;
          }
        }
        if (event.type === 'turn.started') return `Thinking...`;

      } catch {}
    }
    return null;
  }

  _parseJsonToolOutput(cleanOutput, cmd) {
    let text = '';
    let sessionId = null;

    // Strategy 1a: Claude format — {"type":"result", "session_id":"...", "result":"..."}
    const jsonMatch = cleanOutput.match(/\{"type"\s*:\s*"result"[^]*?"session_id"\s*:\s*"([^"]+)"[^]*?"result"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (jsonMatch) {
      sessionId = jsonMatch[1];
      text = jsonMatch[2].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }

    // Strategy 1b: Copilot format — {"type":"result", "sessionId":"...", "exitCode":0}
    // Session ID uses camelCase; response text is in separate assistant.message events
    if (!sessionId) {
      const copilotResultMatch = cleanOutput.match(/\{"type"\s*:\s*"result"[^]*?"sessionId"\s*:\s*"([^"]+)"/);
      if (copilotResultMatch) {
        sessionId = copilotResultMatch[1];
      }
    }

    // Strategy 2: scan ALL JSON lines (stream-json produces many — result is last)
    if (!sessionId || !text) {
      let lastAssistantMessage = null;
      for (const line of cleanOutput.split('\n')) {
        const idx = line.indexOf('{');
        if (idx >= 0) {
          try {
            const json = JSON.parse(line.slice(idx));
            // Claude format: session_id / result fields at top level
            if (json.session_id) sessionId = json.session_id;
            if (json.result) text = json.result;
            if (json.type === 'result' && json.result) text = json.result;
            // Copilot format: sessionId (camelCase) in result events
            if (json.type === 'result' && json.sessionId) sessionId = json.sessionId;
            // Copilot format: response text in assistant.message events (data.content)
            if (json.type === 'assistant.message' && json.data?.content) {
              lastAssistantMessage = json.data.content;
            }
            // Don't break — keep scanning for later events that have the final result
          } catch {}
        }
      }
      // Use assistant.message content if no result text was found (Copilot format)
      if (!text && lastAssistantMessage) {
        text = lastAssistantMessage;
      }
    }
    if (!text) {
      text = this._extractToolResponse(cleanOutput, cmd);
    }

    // If extraction failed (got command echo or nothing), provide helpful message
    if (!text || text.length < 10) {
      // Check if there was at least a session_id (Claude responded but parsing failed)
      if (sessionId) {
        text = '⚠️ Response received but could not be parsed. Claude may still be processing or there was an issue with the output format.';
      } else {
        text = '⚠️ No response received. Please try again.';
      }
    }

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

    // Detect error results and specific error types
    let isError = false;
    let errorType = null;

    // IMPORTANT: If we successfully extracted a result from JSON (sessionId means valid response),
    // only check the result text itself for errors, not the entire output.
    // This prevents post-response errors (rate limits after completion) from overwriting success.
    const hasValidJsonResult = !!sessionId && text && text.length > 20 && !text.startsWith('⚠️');
    const textToCheckForErrors = hasValidJsonResult ? text : cleanOutput;

    // Check for authentication errors
    if (/authentication_error|401.*Invalid authentication|Invalid authentication credentials/i.test(textToCheckForErrors)) {
      isError = true;
      errorType = 'auth';
      text = '🔐 **Authentication failed** — Your API key is invalid or expired.\n\nRun `/login` to re-authenticate.';
    }

    // Check for rate limit errors - only if we don't have a valid result
    // IMPORTANT: Claude Code emits "rate_limit_event" with status:"allowed" as informational messages
    // Only treat as error if it's an actual rejection, not an informational event
    if (!hasValidJsonResult) {
      // Check for actual rate limit errors (not just informational events)
      const hasRateLimitError = /429|too many requests/i.test(cleanOutput) ||
        /"status"\s*:\s*"(rejected|rate_limited|limited)"/i.test(cleanOutput) ||
        (/"rate_limit/i.test(cleanOutput) && /"error"/i.test(cleanOutput));

      if (hasRateLimitError) {
        isError = true;
        errorType = 'rate_limit';
        text = '⏳ **Rate limit reached** — Too many requests.\n\nPlease wait a moment and try again.';
      }
    }

    // Check for overloaded errors - only if we don't have a valid result
    if (!hasValidJsonResult && /overloaded|503|service unavailable/i.test(cleanOutput)) {
      isError = true;
      errorType = 'overloaded';
      text = '🔄 **Service temporarily unavailable** — Claude is overloaded.\n\nPlease try again in a few minutes.';
    }

    // Check stream-json result event for is_error flag
    for (const line of cleanOutput.split('\n')) {
      if (line.includes('"type":"result"') || line.includes('"type": "result"')) {
        try {
          const idx = line.indexOf('{');
          const json = JSON.parse(line.slice(idx));
          if (json.is_error) isError = true;
        } catch {}
      }
    }

    return { text, sessionId, isError, errorType };
  }

  /**
   * Parse opencode --format json output.
   * Events are newline-delimited JSON objects. Each carries a `sessionID` field.
   * Text content arrives in events with `type === "text"` via `part.text`.
   */
  /**
   * Parse plain-text output from `ollama run <model> <prompt>`.
   * Strips the echoed command line, ANSI codes, and any trailing shell prompt.
   */
  _parseOllamaOutput(cleanOutput, cmd) {
    let isError = false;

    // Strip the command echo (first line that starts with "ollama run")
    let lines = cleanOutput.split('\n');
    const cmdStartIdx = lines.findIndex(l => /^ollama\s+run\s+/i.test(l.trim()));
    if (cmdStartIdx >= 0) lines = lines.slice(cmdStartIdx + 1);

    // Drop trailing shell prompt line
    while (lines.length > 0 && /[$#❯>]\s*$/.test(lines[lines.length - 1].trim())) {
      lines.pop();
    }

    const text = lines.join('\n').trim();

    if (!text) {
      isError = true;
      return { text: '⚠️ No response from Ollama. Is the service running and the model installed?', isError };
    }

    // Detect common Ollama error output
    if (/Error:|model.*not found|connection refused|failed to|error loading/i.test(text)) {
      isError = true;
    }

    return { text, isError };
  }

  _parseOpencodeJsonOutput(cleanOutput, cmd) {
    let text = '';
    let sessionId = null;
    let isError = false;
    let isPermanentError = false;
    const textParts = [];

    for (const line of cleanOutput.split('\n')) {
      const idx = line.indexOf('{');
      if (idx < 0) continue;
      try {
        const json = JSON.parse(line.slice(idx));
        if (json.sessionID && !sessionId) sessionId = json.sessionID;
        if (json.type === 'text' && json.part?.text) {
          textParts.push(json.part.text);
        }
        if (json.type === 'error' || json.part?.type === 'error') {
          isError = true;
          // OpenCode nests the message at json.error.data.message
          const errMsg = json.error?.data?.message
            || json.error?.message
            || (typeof json.error === 'string' ? json.error : '')
            || json.part?.message
            || json.message
            || '';
          if (errMsg) textParts.push(`\n\n**Error:** ${errMsg}`);
          if (/model.*not found|provider.*not found|ProviderModelNotFound/i.test(errMsg)) {
            isPermanentError = true;
          }
        }
      } catch {}
    }

    // Detect ProviderModelNotFoundError in raw stderr (appears before the JSON line)
    if (/ProviderModelNotFoundError|Model not found:/i.test(cleanOutput) && !textParts.some(p => p.includes('Error:'))) {
      isError = true;
      isPermanentError = true;
      const modelMatch = cleanOutput.match(/modelID:\s*["']?([^\s"',}\n]+)/);
      const hint = modelMatch ? ` Model "${modelMatch[1].trim()}" is not registered.` : '';
      textParts.push(`\n\n**Error:** OpenCode could not find this Ollama model in its provider config.${hint} Restart the project container to refresh the model list, then try again.`);
    }

    text = textParts.join('');

    if (!text) {
      text = this._extractToolResponse(cleanOutput, cmd);
    }

    if (!text || text.length < 10) {
      text = sessionId
        ? '⚠️ Response received but could not be parsed. OpenCode may still be processing.'
        : '⚠️ No response received from OpenCode. Please try again.';
    }

    return { text, sessionId, isError, isPermanentError };
  }

  /**
   * Parse Codex CLI --json output (JSONL events).
   *
   * Key event types:
   *   {"type":"thread.started","thread_id":"..."}
   *   {"type":"turn.started"}
   *   {"type":"item.completed","item":{"id":"...","type":"agent_message","text":"..."}}
   *   {"type":"item.completed","item":{"id":"...","type":"tool_call",...}}
   *   {"type":"turn.completed","usage":{...}}
   */
  _parseCodexJsonOutput(cleanOutput, cmd) {
    let sessionId = null;
    let isError = false;
    let errorType = null;
    const messageParts = [];

    for (const line of cleanOutput.split('\n')) {
      const idx = line.indexOf('{');
      if (idx < 0) continue;
      try {
        const json = JSON.parse(line.slice(idx));

        // Extract thread_id as session identifier (used for resume)
        if (json.type === 'thread.started' && json.thread_id) {
          sessionId = json.thread_id;
        }

        // Collect agent message text
        if (json.type === 'item.completed' && json.item?.type === 'agent_message' && json.item?.text) {
          messageParts.push(json.item.text);
        }

        // Detect errors
        if (json.type === 'error') {
          isError = true;
          const errMsg = json.message || json.error || '';
          if (/auth|401|unauthorized/i.test(errMsg)) errorType = 'auth';
          else if (/429|rate.?limit|too many/i.test(errMsg)) errorType = 'rate_limit';
          if (errMsg) messageParts.push(`\n\n**Error:** ${errMsg}`);
        }
      } catch {}
    }

    let text = messageParts.join('\n\n');

    if (!text) {
      text = this._extractToolResponse(cleanOutput, cmd);
    }

    if (!text || text.length < 10) {
      text = sessionId
        ? '⚠️ Response received but could not be parsed. Codex may still be processing.'
        : '⚠️ No response received from Codex. Please try again.';
    }

    // Check for auth/rate errors in raw output if not already detected via JSON events.
    // Only match if no valid message content was parsed — this avoids false positives
    // when the assistant's response text happens to mention "401", "rate limit", etc.
    if (!isError && messageParts.length === 0) {
      if (/authentication.*error|401.*invalid|unauthorized/i.test(cleanOutput)) {
        isError = true;
        errorType = 'auth';
        text = '🔐 **Authentication failed** — Transient OpenAI error. Retrying automatically...';
      } else if (/429|too many requests|rate.?limit/i.test(cleanOutput)) {
        isError = true;
        errorType = 'rate_limit';
        text = '⏳ **Rate limit reached** — Too many requests. Retrying automatically...';
      }
    }

    return { text, sessionId, isError, errorType };
  }

  _extractToolResponse(cleanOutput, cmd) {
    let lines = cleanOutput.split('\n');

    // Strategy 1: Find where JSON output starts (skip command echo entirely)
    // The command echo ends when we see the first JSON event from stream-json
    const firstJsonIdx = lines.findIndex(l => {
      const t = l.trim();
      return t.startsWith('{') && (t.includes('"type"') || t.includes('"session_id"') || t.includes('"sessionId"'));
    });

    if (firstJsonIdx > 0) {
      // Everything before first JSON is command echo - skip it
      lines = lines.slice(firstJsonIdx);
    } else if (firstJsonIdx === -1) {
      // No JSON found - try old method as fallback
      const cmdBase = cmd.split("'")[0].trim();
      const startIdx = lines.findIndex(l => l.includes(cmdBase));
      if (startIdx >= 0) lines = lines.slice(startIdx + 1);
    }

    // Remove trailing shell prompts
    while (lines.length > 0) {
      const last = lines[lines.length - 1].trim();
      if (/[$#>]\s*$/.test(last) && last.length > 1) lines.pop();
      else if (!last) lines.pop();
      else if (/^\w+@[\w.-]+:.*[$#]/.test(last)) lines.pop(); // user@host:path$
      else break;
    }

    // Filter out JSON events (we want the text response, not events)
    // Also filter any remaining echoed content
    lines = lines.filter(l => {
      const t = l.trim();
      if (t.startsWith('{"type"')) return false;
      if (t.startsWith('{') && (t.includes('"session_id"') || t.includes('"sessionId"'))) return false;
      // Skip lines that look like command echo (start with > or contain command args)
      if (t.startsWith('> ')) return false; // All echoed preamble lines start with >
      if (t.includes('--output-format')) return false;
      if (t.includes('--dangerously-skip-permissions')) return false;
      if (t.includes('--yolo')) return false;
      if (t.includes("claude -p '")) return false;
      if (t.includes("copilot -p '")) return false;
      if (t.includes("opencode run '")) return false;
      return true;
    });

    const result = lines.join('\n').trim();

    // If we filtered out everything and have nothing useful, return empty
    // (caller should handle this as a failed extraction)
    if (!result || result.length < 5) {
      return '';
    }

    return result;
  }

  _stripAnsi(text) {
    return text
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b[()][A-Z0-9]/g, '')
      .replace(/\r/g, '');
  }

  _addAgentMessage(projectId, sessionId, content, broadcastFn, metadata = null, skipUnread = false) {
    // sessionId is now passed explicitly to avoid concurrency issues

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

    // Mark session as unread and broadcast (only for user-initiated tasks)
    if (!skipUnread) {
      const changed = chatStore.markSessionUnread(projectId, sessionId);
      if (changed) {
        broadcastFn({
          type: 'session-unread',
          projectId,
          sessionId,
          hasUnread: true,
        });
      }
    }
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

  _addProgressMessage(projectId, sessionId, content, broadcastFn, tasks = null, { transient = false } = {}) {
    // sessionId is now passed explicitly to avoid concurrency issues
    if (transient) {
      // Broadcast only — do not persist to disk so the message never appears in history.
      // The client already renders these via the transient streamingMessage overlay.
      const msg = {
        id: `progress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sessionId,
        role: 'progress',
        content,
        createdAt: new Date().toISOString(),
        metadata: { tasks, live: true },
      };
      broadcastFn({ type: 'chat-progress', projectId, message: msg });
      return;
    }
    const msg = chatStore.addMessage({ projectId, sessionId, role: 'progress', content, metadata: { tasks, live: true } });
    broadcastFn({ type: 'chat-progress', projectId, message: msg });
  }

  _addErrorMessage(projectId, sessionId, content, broadcastFn) {
    // sessionId is now passed explicitly to avoid concurrency issues
    const msg = chatStore.addMessage({ projectId, sessionId, role: 'error', content });
    broadcastFn({ type: 'chat-message', message: msg });
  }
}

export const agentGateway = new AgentGateway();
export default agentGateway;
