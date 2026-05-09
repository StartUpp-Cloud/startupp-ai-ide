import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { sqliteStore } from './sqliteStore.js';
import { chatStore } from './chatStore.js';
import { agentGateway } from './agentGateway.js';
import { llmProvider } from './llmProvider.js';
import { memoryStore } from './memoryStore.js';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_TASKS = 6;

const NON_RETRYABLE_PATTERNS = [
  /not configured|missing configuration|configuration required/i,
  /api key.*(missing|not configured|invalid)|token.*(missing|not configured|invalid)/i,
  /authentication failed|unauthorized|forbidden|login required|not logged in/i,
  /command not found|not installed|executable file not found/i,
  /model .*not found|provider.*not found|no such model/i,
  /container .*not found|no such container|docker.*not running/i,
  /repo(?:sitory)? .*not found|not a git repository/i,
  /rate limit|quota|too many requests|billing|insufficient credits/i,
  /unknown option|invalid option|unrecognized option|missing required (?:option|argument)/i,
];

const CONTEXT_LIMIT_PATTERNS = [
  /context.*(limit|length|overflow)|token.*(limit|length)|too many tokens|max_tokens/i,
];

const TRANSIENT_PATTERNS = [
  /overloaded|temporarily unavailable|service unavailable|timeout|timed out|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i,
  /stream.*interrupted|connection.*interrupted|no output received/i,
];

function nowIso() {
  return new Date().toISOString();
}

function safeJson(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function rowToRun(row) {
  if (!row) return null;
  return {
    ...parseJson(row.data, {}),
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    parentMessageId: row.parent_message_id,
    status: row.status,
    phase: row.phase,
    goal: row.goal,
    tool: row.tool,
    model: row.model,
    effort: row.effort,
    maxAttempts: row.max_attempts,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    finalResponse: row.final_response,
    error: row.error,
  };
}

function rowToTask(row) {
  if (!row) return null;
  return {
    ...parseJson(row.data, {}),
    id: row.id,
    runId: row.run_id,
    projectId: row.project_id,
    sessionId: row.session_id,
    agentSessionId: row.agent_session_id,
    title: row.title,
    prompt: row.prompt,
    taskType: row.task_type,
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    result: row.result,
    error: row.error,
    retryable: row.retryable === 1,
  };
}

class AgentOrchestrator extends EventEmitter {
  constructor() {
    super();
    this.activeRuns = new Map();
  }

  shouldOrchestrate({ mode, content, executeReviewedPlan = false }) {
    if (executeReviewedPlan) return true;
    if (mode === 'plan') return false;
    const text = String(content || '').trim();
    if (text.length > 180) return true;
    return /\b(implement|fix|debug|build|refactor|migrate|deploy|test|review|investigate|add|update|optimi[sz]e|integrate|rewrite|plan approved|execute the plan)\b/i.test(text);
  }

  async startRun({ projectId, sessionId, content, attachments = [], mode = 'agent', tool = 'claude', model = null, effort = null, broadcastFn, skipUnread = false, executeReviewedPlan = false }) {
    const run = {
      id: uuidv4(),
      projectId,
      sessionId,
      status: 'running',
      phase: 'planning',
      goal: content,
      tool,
      model,
      effort,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      startedAt: nowIso(),
      updatedAt: nowIso(),
      data: { attachments, mode, executeReviewedPlan },
    };

    this._saveRun(run);
    this.activeRuns.set(run.id, { aborted: false, broadcastFn });
    this._emitRun(run, broadcastFn);
    await this._event(run, null, 'run-started', `Started autonomous run with ${tool}.`, { tool, model, effort }, broadcastFn);

    this._executeRun(run, { attachments, mode, tool, model, effort, broadcastFn, skipUnread }).catch(async (err) => {
      const active = this.activeRuns.get(run.id);
      const cancelled = active?.aborted || /cancelled|aborted/i.test(err.message || '');
      run.status = cancelled ? 'cancelled' : 'failed';
      run.phase = run.status;
      run.error = cancelled ? null : err.message;
      run.completedAt = nowIso();
      run.updatedAt = run.completedAt;
      this._saveRun(run);
      if (cancelled) {
        if (!active?.cancelEventEmitted) {
          await this._event(run, null, 'run-cancelled', 'Autonomous run cancelled.', null, broadcastFn, 'warning');
        }
      } else {
        await this._event(run, null, 'run-failed', `Autonomous run failed: ${err.message}`, null, broadcastFn, 'error');
        const msg = chatStore.addMessage({
          projectId: run.projectId,
          sessionId: run.sessionId,
          role: 'error',
          content: `Autonomous run failed: ${err.message}`,
          metadata: { orchestratorRunId: run.id },
        });
        broadcastFn({ type: 'chat-message', message: msg });
      }
      this._emitRun(run, broadcastFn);
      this.activeRuns.delete(run.id);
    });

    return run;
  }

  abortRun(runId) {
    const active = this.activeRuns.get(runId);
    if (!active) return false;
    active.aborted = true;
    if (active.currentAgentSessionId) agentGateway.abort(active.currentAgentSessionId);
    const run = this.getRun(runId);
    if (run) {
      run.status = 'cancelled';
      run.phase = 'cancelled';
      run.error = null;
      run.completedAt = nowIso();
      run.updatedAt = run.completedAt;
      this._saveRun(run);
      active.cancelEventEmitted = true;
      this._event(run, null, 'run-cancelled', 'Autonomous run cancelled.', null, active.broadcastFn, 'warning').catch(() => {});
      this._emitRun(run, active.broadcastFn);
    }
    return true;
  }

  abortSession(sessionId) {
    let aborted = 0;
    for (const [runId] of this.activeRuns) {
      const run = this.getRun(runId);
      if (run?.sessionId === sessionId && this.abortRun(runId)) aborted++;
    }
    return aborted;
  }

  getRun(runId) {
    const row = sqliteStore.db.prepare('SELECT * FROM orchestrator_runs WHERE id = ?').get(runId);
    return rowToRun(row);
  }

  getRunsForSession(projectId, sessionId, limit = 20) {
    return sqliteStore.db.prepare(`SELECT * FROM orchestrator_runs WHERE project_id = ? AND session_id = ? ORDER BY started_at DESC LIMIT ?`)
      .all(projectId, sessionId, limit)
      .map(rowToRun);
  }

  getTasks(runId) {
    return sqliteStore.db.prepare('SELECT * FROM orchestrator_tasks WHERE run_id = ? ORDER BY updated_at ASC').all(runId).map(rowToTask);
  }

  getEvents(runId, limit = 200) {
    return sqliteStore.db.prepare('SELECT * FROM orchestrator_events WHERE run_id = ? ORDER BY created_at ASC LIMIT ?')
      .all(runId, limit)
      .map(row => ({
        id: row.id,
        runId: row.run_id,
        taskId: row.task_id,
        projectId: row.project_id,
        sessionId: row.session_id,
        eventType: row.event_type,
        level: row.level,
        message: row.message,
        metadata: parseJson(row.metadata, null),
        createdAt: row.created_at,
      }));
  }

  async _executeRun(run, opts) {
    const active = this.activeRuns.get(run.id);
    const { tool, model, effort, broadcastFn, skipUnread } = opts;

    const tasks = await this._planTasks(run, opts);
    for (const task of tasks) this._saveTask(task);

    run.phase = 'executing';
    run.updatedAt = nowIso();
    run.data = { ...(run.data || {}), taskCount: tasks.length };
    this._saveRun(run);
    this._emitRun(run, broadcastFn);
    await this._event(run, null, 'tasks-created', `Created ${tasks.length} agent task${tasks.length === 1 ? '' : 's'}.`, { tasks: tasks.map(t => ({ id: t.id, title: t.title, type: t.taskType })) }, broadcastFn);

    const completed = [];
    for (const task of tasks) {
      if (active?.aborted) throw new Error('Run cancelled');
      const result = await this._runTaskWithRetries(run, task, { tool, model, effort, broadcastFn, skipUnread });
      if (active?.aborted || result?.errorType === 'cancelled') throw new Error('Run cancelled');
      completed.push({ task, result });
      if (!result.success && !result.retryable) break;
      if (!result.success) break;
    }

    const failed = completed.find(item => !item.result.success);
    if (failed) {
      run.status = failed.result.retryable ? 'failed' : 'blocked';
      run.phase = run.status;
      run.error = failed.result.error || `Task failed: ${failed.task.title}`;
      run.completedAt = nowIso();
      run.updatedAt = run.completedAt;
      this._saveRun(run);
      await this._event(run, failed.task, run.status, `${run.status === 'blocked' ? 'Blocked' : 'Failed'}: ${run.error}`, failed.result, broadcastFn, 'error');
      const msg = chatStore.addMessage({
        projectId: run.projectId,
        sessionId: run.sessionId,
        role: 'error',
        content: `${run.status === 'blocked' ? 'Autonomous run blocked' : 'Autonomous run failed'}: ${run.error}`,
        metadata: {
          orchestratorRunId: run.id,
          orchestratorTaskId: failed.task.id,
          ...(failed.result.changedFiles?.length > 0 ? { changedFiles: failed.result.changedFiles } : {}),
        },
      });
      broadcastFn({ type: 'chat-message', message: msg });
      this._emitRun(run, broadcastFn);
      this.activeRuns.delete(run.id);
      return;
    }

    run.phase = 'synthesizing';
    run.updatedAt = nowIso();
    this._saveRun(run);
    this._emitRun(run, broadcastFn);
    await this._event(run, null, 'synthesizing', 'Synthesizing final response from agent task results.', null, broadcastFn);

    const finalResponse = await this._synthesizeFinal(run, completed);
    const changedFiles = this._mergeChangedFiles(completed.flatMap(({ result }) => result.changedFiles || []));
    const msg = chatStore.addMessage({
      projectId: run.projectId,
      sessionId: run.sessionId,
      role: 'agent',
      content: finalResponse,
      metadata: {
        orchestratorRunId: run.id,
        tool,
        tasks: completed.map(({ task }) => ({ id: task.id, title: task.title, status: task.status })),
        ...(changedFiles.length > 0 ? { changedFiles } : {}),
      },
    });
    broadcastFn({ type: 'chat-message', message: msg });
    if (!skipUnread) {
      const changed = chatStore.markSessionUnread(run.projectId, run.sessionId);
      if (changed) broadcastFn({ type: 'session-unread', projectId: run.projectId, sessionId: run.sessionId, hasUnread: true });
    }

    run.status = 'completed';
    run.phase = 'completed';
    run.finalResponse = finalResponse;
    run.completedAt = nowIso();
    run.updatedAt = run.completedAt;
    this._saveRun(run);
    await this._event(run, null, 'run-completed', 'Autonomous run completed.', null, broadcastFn, 'success');
    this._emitRun(run, broadcastFn);
    this.activeRuns.delete(run.id);
  }

  async _planTasks(run, { tool, model, effort, mode, executeReviewedPlan }) {
    const fallback = [this._createTask(run, {
      title: executeReviewedPlan ? 'Execute approved plan' : 'Complete user request',
      prompt: this._buildTaskPrompt(run, run.goal, []),
      taskType: executeReviewedPlan ? 'implementation' : 'general',
    })];

    const settings = llmProvider.getSettings();
    if (!settings.enabled || !llmProvider.available) return fallback;

    try {
      const memory = memoryStore.buildContextForLLM(run.projectId, { query: run.goal, maxTokens: 1200 });
      const result = await llmProvider.generateResponse(
        `Create a safe task breakdown for an autonomous coding-agent orchestrator.

The orchestrator will assign tasks to ${tool}. The orchestrator itself will not edit files.

Rules:
- Return JSON only.
- Use 1 task for simple focused requests.
- Use 2-6 tasks for complex requests.
- Prefer serial implementation tasks unless tasks are clearly research-only.
- Every task prompt must include enough context to stand alone.
- Include a final verification task when implementation is requested.

Project memory:
${memory || '(none)'}

User request:
${run.goal.slice(0, 5000)}

Return this exact shape:
{"tasks":[{"title":"short title","type":"research|implementation|verification|review|general","prompt":"standalone prompt for coding agent","parallelSafe":false}]}`,
        { maxTokens: 2400, temperature: 0.1, model, effort }
      );
      const match = result.response.match(/\{[\s\S]*\}/);
      if (!match) return fallback;
      const parsed = JSON.parse(match[0]);
      const tasks = Array.isArray(parsed.tasks) ? parsed.tasks.slice(0, DEFAULT_MAX_TASKS) : [];
      const normalized = tasks
        .filter(t => t?.title && t?.prompt)
        .map(t => this._createTask(run, {
          title: String(t.title).slice(0, 120),
          prompt: this._buildTaskPrompt(run, String(t.prompt), []),
          taskType: ['research', 'implementation', 'verification', 'review', 'general'].includes(t.type) ? t.type : 'general',
          parallelSafe: !!t.parallelSafe,
        }));
      return normalized.length > 0 ? normalized : fallback;
    } catch (err) {
      console.warn('[agentOrchestrator] Task planning failed, using fallback:', err.message);
      return fallback;
    }
  }

  _createTask(run, { title, prompt, taskType = 'general', parallelSafe = false }) {
    const id = uuidv4();
    const now = nowIso();
    return {
      id,
      runId: run.id,
      projectId: run.projectId,
      sessionId: run.sessionId,
      title,
      prompt,
      taskType,
      parallelSafe,
      status: 'pending',
      attempt: 0,
      maxAttempts: run.maxAttempts || DEFAULT_MAX_ATTEMPTS,
      updatedAt: now,
      data: { parallelSafe },
    };
  }

  _buildTaskPrompt(run, prompt, priorResults = []) {
    const memory = memoryStore.buildContextForLLM(run.projectId, { query: `${run.goal}\n${prompt}`, maxTokens: 1400 });
    const prior = priorResults.length
      ? `\n\nPrior completed task results:\n${priorResults.map((r, i) => `${i + 1}. ${r.task.title}: ${String(r.result.content || '').slice(0, 1200)}`).join('\n')}`
      : '';
    return `You are a coding agent working under an IDE orchestrator. Complete ONLY the task below. The orchestrator will coordinate other tasks and final synthesis.

Original user goal:
${run.goal}

Durable project memory:
${memory || '(none)'}${prior}

Assigned task:
${prompt}

Report clearly what you did, files changed, commands run, verification results, and blockers. Do not wait for user input unless truly blocked.`;
  }

  async _runTaskWithRetries(run, task, opts) {
    let lastResult = null;
    for (let attempt = 1; attempt <= task.maxAttempts; attempt++) {
      task.attempt = attempt;
      task.status = 'running';
      task.startedAt = task.startedAt || nowIso();
      task.updatedAt = nowIso();
      this._saveTask(task);
      await this._event(run, task, 'task-started', `Task ${attempt > 1 ? `retry ${attempt}/${task.maxAttempts}` : `started`}: ${task.title}`, null, opts.broadcastFn);

      const agentSession = this._ensureAgentSession(run, task, opts);
      task.agentSessionId = agentSession.id;
      this._saveTask(task);
      const active = this.activeRuns.get(run.id);
      if (active) active.currentAgentSessionId = agentSession.id;

      const prompt = attempt === 1
        ? task.prompt
        : await this._buildRetryPrompt(run, task, lastResult);

      const result = await agentGateway.handleTask({
        projectId: run.projectId,
        sessionId: agentSession.id,
        content: prompt,
        attachments: [],
        mode: 'agent',
        tool: opts.tool,
        model: opts.model,
        effort: opts.effort,
        skipUnread: true,
        broadcastFn: (data) => this._handleAgentBroadcast(run, task, data, opts.broadcastFn),
      });

      const classified = this._classifyResult(result);
      if (active?.aborted) {
        task.status = 'cancelled';
        task.error = 'Run cancelled';
        task.retryable = false;
        task.completedAt = nowIso();
        task.updatedAt = task.completedAt;
        this._saveTask(task);
        await this._event(run, task, 'task-cancelled', `Cancelled: ${task.title}`, null, opts.broadcastFn, 'warning');
        return { success: false, retryable: false, errorType: 'cancelled', error: 'Run cancelled' };
      }
      lastResult = { ...(result || {}), ...classified };

      if (lastResult.success) {
        task.status = 'completed';
        task.result = lastResult.content || '';
        task.error = null;
        task.completedAt = nowIso();
        task.updatedAt = task.completedAt;
        this._saveTask(task);
        await this._event(run, task, 'task-completed', `Completed: ${task.title}`, { attempts: attempt }, opts.broadcastFn, 'success');
        return lastResult;
      }

      task.error = lastResult.error || 'Agent task failed';
      task.retryable = lastResult.retryable;
      task.updatedAt = nowIso();
      this._saveTask(task);

      if (!lastResult.retryable) {
        task.status = 'blocked';
        task.completedAt = nowIso();
        this._saveTask(task);
        await this._event(run, task, 'task-blocked', `Blocked: ${task.error}`, lastResult, opts.broadcastFn, 'error');
        return lastResult;
      }

      if (attempt < task.maxAttempts) {
        task.status = 'retrying';
        this._saveTask(task);
        await this._event(run, task, 'task-retrying', `Retrying ${task.title}: ${task.error}`, { attempt, maxAttempts: task.maxAttempts, reason: lastResult.errorType }, opts.broadcastFn, 'warning');
        await new Promise(resolve => setTimeout(resolve, this._retryDelayMs(attempt, lastResult)));
      }
    }

    task.status = 'failed';
    task.completedAt = nowIso();
    task.updatedAt = task.completedAt;
    this._saveTask(task);
    await this._event(run, task, 'task-failed', `Failed after ${task.maxAttempts} attempts: ${task.error}`, lastResult, opts.broadcastFn, 'error');
    return { ...(lastResult || {}), success: false, retryable: true, error: task.error };
  }

  _ensureAgentSession(run, task, { tool, model, effort }) {
    if (task.agentSessionId) {
      const existing = chatStore.getSession(run.projectId, task.agentSessionId);
      if (existing) return existing;
    }
    const session = chatStore.createSession(run.projectId, `[Agent] ${task.title}`, { tool, model, effort });
    chatStore.updateSessionMeta(run.projectId, session.id, {
      archived: true,
      orchestratorChild: true,
      orchestratorRunId: run.id,
      orchestratorTaskId: task.id,
    });
    return chatStore.getSession(run.projectId, session.id) || session;
  }

  _handleAgentBroadcast(run, task, data, broadcastFn) {
    if (!broadcastFn) return;
    if (data?.type === 'chat-progress' && data.message?.content) {
      this._event(run, task, 'agent-progress', `${task.title}: ${data.message.content}`, data.message.metadata || null, broadcastFn).catch(() => {});
    }
    if (data?.type === 'job-progress' && data.progress?.summary) {
      this._event(run, task, 'agent-progress', `${task.title}: ${data.progress.summary}`, data.progress, broadcastFn).catch(() => {});
    }
    if (data?.type === 'agent-status') {
      broadcastFn({ type: 'orchestrator-task-status', projectId: run.projectId, sessionId: run.sessionId, runId: run.id, taskId: task.id, busy: data.busy });
    }
    if (data?.type === 'session-file-changes' && Array.isArray(data.files)) {
      broadcastFn({
        type: 'session-file-changes',
        projectId: run.projectId,
        sessionId: run.sessionId,
        runId: run.id,
        taskId: task.id,
        files: data.files,
      });
    }
  }

  _mergeChangedFiles(files = []) {
    const byPath = new Map();
    for (const file of files) {
      if (!file?.path) continue;
      byPath.set(file.path, { path: file.path, status: file.status || 'M' });
    }
    return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)).slice(0, 200);
  }

  _classifyResult(result) {
    if (result?.success) return { success: true, retryable: false, errorType: null };
    const error = String(result?.error || result?.content || 'Unknown agent failure');
    if (CONTEXT_LIMIT_PATTERNS.some(pattern => pattern.test(error))) {
      return { success: false, retryable: true, errorType: 'context-limit', error };
    }
    if (NON_RETRYABLE_PATTERNS.some(pattern => pattern.test(error))) {
      return { success: false, retryable: false, errorType: 'non-retryable', error };
    }
    if (TRANSIENT_PATTERNS.some(pattern => pattern.test(error))) {
      return { success: false, retryable: true, errorType: 'transient', error };
    }
    return { success: false, retryable: true, errorType: 'unknown', error };
  }

  async _buildRetryPrompt(run, task, lastResult) {
    if (lastResult?.errorType === 'context-limit') {
      return `The previous agent attempt hit a context limit while working on this task. Continue from the available state without repeating completed work.

Original goal:
${run.goal}

Task:
${task.prompt}

Previous failure/context:
${String(lastResult.error || '').slice(0, 2000)}

Inspect the repository state, summarize what is already done, and complete the remaining work.`;
    }
    return `Retry this task after a recoverable failure.

Original goal:
${run.goal}

Task:
${task.prompt}

Previous error:
${String(lastResult?.error || '').slice(0, 2000)}

Adjust your approach, avoid repeating the same failing action, and report clearly if blocked.`;
  }

  _retryDelayMs(attempt, result) {
    if (result?.errorType === 'context-limit') return 1000;
    return [5000, 20000, 60000][Math.max(0, attempt - 1)] || 60000;
  }

  async _synthesizeFinal(run, completed) {
    const summary = completed.map(({ task, result }, i) => (
      `Task ${i + 1}: ${task.title}\nStatus: ${task.status}\nResult:\n${String(result.content || task.result || '').slice(0, 2500)}`
    )).join('\n\n---\n\n');

    const settings = llmProvider.getSettings();
    if (!settings.enabled || !llmProvider.available) {
      return `Autonomous run completed.\n\n${completed.map(({ task }) => `- ${task.title}: ${task.status}`).join('\n')}`;
    }

    try {
      const result = await llmProvider.generateResponse(
        `Write the final user-facing response for this autonomous coding run.

Original user goal:
${run.goal}

Task results:
${summary}

Instructions:
- Be concise but complete.
- Explain what was done, verification performed, and any remaining blockers/risks.
- Do not mention internal orchestration mechanics unless relevant.`,
        { maxTokens: 1600, temperature: 0.1 }
      );
      return result.response?.trim() || `Autonomous run completed.\n\n${summary}`;
    } catch {
      return `Autonomous run completed.\n\n${summary}`;
    }
  }

  _saveRun(run) {
    sqliteStore.db.prepare(`INSERT INTO orchestrator_runs (
      id, project_id, session_id, parent_message_id, status, phase, goal, tool, model, effort,
      max_attempts, started_at, updated_at, completed_at, final_response, error, data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      phase = excluded.phase,
      updated_at = excluded.updated_at,
      completed_at = excluded.completed_at,
      final_response = excluded.final_response,
      error = excluded.error,
      data = excluded.data`).run(
      run.id, run.projectId, run.sessionId, run.parentMessageId || null, run.status, run.phase || null,
      run.goal, run.tool || null, run.model || null, run.effort || null, run.maxAttempts || DEFAULT_MAX_ATTEMPTS,
      run.startedAt, run.updatedAt || nowIso(), run.completedAt || null, run.finalResponse || null, run.error || null, safeJson(run.data || {})
    );
  }

  _saveTask(task) {
    sqliteStore.db.prepare(`INSERT INTO orchestrator_tasks (
      id, run_id, project_id, session_id, agent_session_id, title, prompt, task_type, status,
      attempt, max_attempts, started_at, updated_at, completed_at, result, error, retryable, data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      agent_session_id = excluded.agent_session_id,
      status = excluded.status,
      attempt = excluded.attempt,
      started_at = excluded.started_at,
      updated_at = excluded.updated_at,
      completed_at = excluded.completed_at,
      result = excluded.result,
      error = excluded.error,
      retryable = excluded.retryable,
      data = excluded.data`).run(
      task.id, task.runId, task.projectId, task.sessionId, task.agentSessionId || null, task.title,
      task.prompt, task.taskType, task.status, task.attempt || 0, task.maxAttempts || DEFAULT_MAX_ATTEMPTS,
      task.startedAt || null, task.updatedAt || nowIso(), task.completedAt || null, task.result || null,
      task.error || null, task.retryable === false ? 0 : 1, safeJson(task.data || {})
    );
  }

  async _event(run, task, eventType, message, metadata = null, broadcastFn = null, level = 'info') {
    const event = {
      id: uuidv4(),
      runId: run.id,
      taskId: task?.id || null,
      projectId: run.projectId,
      sessionId: run.sessionId,
      eventType,
      level,
      message,
      metadata,
      createdAt: nowIso(),
    };
    sqliteStore.db.prepare(`INSERT INTO orchestrator_events (id, run_id, task_id, project_id, session_id, event_type, level, message, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      event.id, event.runId, event.taskId, event.projectId, event.sessionId, event.eventType,
      event.level, event.message, metadata ? safeJson(metadata) : null, event.createdAt
    );

    const msg = chatStore.addMessage({
      projectId: run.projectId,
      sessionId: run.sessionId,
      role: 'progress',
      content: message,
      metadata: { orchestratorRunId: run.id, orchestratorTaskId: task?.id || null, eventType, level, transient: false, live: true },
    });
    broadcastFn?.({ type: 'chat-progress', projectId: run.projectId, message: msg });
    broadcastFn?.({ type: 'orchestrator-event', event });
    this.emit('event', event);
    return event;
  }

  _emitRun(run, broadcastFn) {
    const payload = { ...run, tasks: this.getTasks(run.id) };
    broadcastFn?.({ type: 'orchestrator-run', projectId: run.projectId, sessionId: run.sessionId, run: payload });
    this.emit('run', payload);
  }
}

export const agentOrchestrator = new AgentOrchestrator();
export default agentOrchestrator;
