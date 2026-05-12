import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { sqliteStore } from './sqliteStore.js';
import { chatStore } from './chatStore.js';
import { agentGateway } from './agentGateway.js';
import { llmProvider } from './llmProvider.js';
import { memoryStore } from './memoryStore.js';
import { shouldOrchestrateRequest } from './orchestratorRouting.js';
import { batchTasks } from './orchestratorBatching.js';
import { ACTIVE_RUN_STALE_MS, LLM_STEP_TIMEOUT_MS } from './sessionRecovery.js';
import {
  INTERRUPTED_RUN_ERROR,
  buildLivenessHeartbeatMessage,
  buildProgressMessageId,
  shouldEmitLivenessHeartbeat,
  shouldPersistProgressMessage,
  shouldSuppressAgentProgress,
} from './orchestratorLiveness.js';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_TASKS = 6;
const PROGRESS_DEDUP_WINDOW_MS = 5000; // Suppress identical progress within 5s
const LIVENESS_INTERVAL_MS = 5000;
const LIVENESS_STALE_MS = 4000;
const ACTIVE_RUN_STATUSES = ['running'];
const ACTIVE_RUN_STATUS_SQL = ACTIVE_RUN_STATUSES.map(() => '?').join(', ');

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
  const data = parseJson(row.data, {});
  return {
    ...data,
    data,
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
    // Dedup: track last emitted progress per run to suppress identical repeats
    this._lastProgress = new Map(); // runId -> { content, ts }
  }

  async init() {
    const reconciled = this.reconcileInterruptedRuns();
    if (reconciled.length > 0) {
      console.log(`[agentOrchestrator] Reconciled ${reconciled.length} interrupted run(s) from persisted state`);
    }
  }

  shouldOrchestrate({ mode, content, executeReviewedPlan = false }) {
    return shouldOrchestrateRequest({ mode, content, executeReviewedPlan });
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
    this.activeRuns.set(run.id, { aborted: false, broadcastFn, lastActivityAt: Date.now(), lastMeaningfulActivityAt: Date.now() });
    this._startLivenessMonitor(run, broadcastFn);
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
      this._deactivateRun(run.id);
    });

    return run;
  }

  abortRun(runId) {
    const active = this.activeRuns.get(runId);
    if (!active) return false;
    active.aborted = true;
    for (const agentSessionId of active.agentSessionIds || []) {
      agentGateway.abort(agentSessionId);
    }
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
    this._deactivateRun(runId);
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

  hasActiveSession(projectId, sessionId) {
    for (const [runId] of this.activeRuns) {
      const run = this.getRun(runId);
      if (run?.projectId === projectId && run?.sessionId === sessionId && ACTIVE_RUN_STATUSES.includes(run.status)) return true;
    }
    return false;
  }

  recoverStaleActiveRuns({ staleMs = ACTIVE_RUN_STALE_MS, broadcastFn = null } = {}) {
    const now = Date.now();
    const recovered = [];
    for (const [runId, active] of this.activeRuns) {
      if (!active || active.aborted) continue;
      const silenceMs = now - (active.lastMeaningfulActivityAt || active.lastActivityAt || now);
      if (silenceMs < staleMs) continue;
      if (active.lastStaleRecoveryAt && now - active.lastStaleRecoveryAt < staleMs) continue;

      const run = this.getRun(runId);
      if (!run || !ACTIVE_RUN_STATUSES.includes(run.status)) continue;

      active.lastStaleRecoveryAt = now;
      active.lastMeaningfulActivityAt = now;
      const task = this._currentActiveTask(runId);
      if (active.currentAgentSessionId) agentGateway.abort(active.currentAgentSessionId);

      const seconds = Math.max(1, Math.round(silenceMs / 1000));
      this._event(
        run,
        task,
        'task-stalled-retry',
        `No useful agent progress for ${seconds}s. Retrying automatically.`,
        { silenceSeconds: seconds, autoRetry: true },
        active.broadcastFn || broadcastFn,
        'warning'
      ).catch(() => {});
      recovered.push({ run, task, silenceMs });
    }
    return recovered;
  }

  getRun(runId) {
    const row = sqliteStore.db.prepare('SELECT * FROM orchestrator_runs WHERE id = ?').get(runId);
    return rowToRun(row);
  }

  getRunsForSession(projectId, sessionId, limit = 20) {
    this.reconcileSessionRuns(projectId, sessionId);
    return sqliteStore.db.prepare(`SELECT * FROM orchestrator_runs WHERE project_id = ? AND session_id = ? ORDER BY started_at DESC LIMIT ?`)
      .all(projectId, sessionId, limit)
      .map(rowToRun);
  }

  reconcileInterruptedRuns(broadcastFn = null) {
    const rows = sqliteStore.db.prepare(`SELECT * FROM orchestrator_runs
      WHERE status IN (${ACTIVE_RUN_STATUS_SQL})
      ORDER BY updated_at DESC`).all(...ACTIVE_RUN_STATUSES);

    const reconciled = [];
    for (const row of rows) {
      const run = rowToRun(row);
      if (!run || this.activeRuns.has(run.id)) continue;
      reconciled.push(this._markRunInterrupted(run, broadcastFn));
    }
    return reconciled.filter(Boolean);
  }

  reconcileSessionRuns(projectId, sessionId, broadcastFn = null) {
    const rows = sqliteStore.db.prepare(`SELECT * FROM orchestrator_runs
      WHERE project_id = ? AND session_id = ? AND status IN (${ACTIVE_RUN_STATUS_SQL})
      ORDER BY updated_at DESC`).all(projectId, sessionId, ...ACTIVE_RUN_STATUSES);

    const reconciled = [];
    for (const row of rows) {
      const run = rowToRun(row);
      if (!run || this.activeRuns.has(run.id)) {
        if (run) this._emitRun(run, broadcastFn);
        continue;
      }

      const interrupted = this._markRunInterrupted(run, broadcastFn);
      if (interrupted) reconciled.push(interrupted);
    }
    return reconciled;
  }

  getRecentSessionRuns(projectId, sessionId, limit = 5) {
    this.reconcileSessionRuns(projectId, sessionId);
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
    const { mode, tool, model, effort, broadcastFn, skipUnread } = opts;

    const tasks = await this._planTasks(run, opts);
    for (const task of tasks) this._saveTask(task);

    run.phase = 'executing';
    run.updatedAt = nowIso();
    run.data = { ...(run.data || {}), taskCount: tasks.length };
    this._saveRun(run);
    this._emitRun(run, broadcastFn);
    await this._event(run, null, 'tasks-created', `Created ${tasks.length} agent task${tasks.length === 1 ? '' : 's'}.`, { tasks: tasks.map(t => ({ id: t.id, title: t.title, type: t.taskType })) }, broadcastFn);

    const completed = [];
    const batches = this._batchTasks(tasks);
    for (const batch of batches) {
      if (active?.aborted) throw new Error('Run cancelled');

      if (batch.parallel) {
        // Run all parallelSafe tasks in the batch concurrently
        const promises = batch.tasks.map(task =>
          this._runTaskWithRetries(run, task, { mode, tool, model, effort, broadcastFn, skipUnread })
            .then(result => ({ task, result }))
        );
        const results = await Promise.all(promises);

        if (active?.aborted) throw new Error('Run cancelled');
        for (const item of results) {
          completed.push(item);
        }
        // If any parallel task failed, stop execution
        const failed = results.find(item => !item.result.success);
        if (failed) break;
      } else {
        // Serial task — single item batch
        const task = batch.tasks[0];
        const result = await this._runTaskWithRetries(run, task, { mode, tool, model, effort, broadcastFn, skipUnread });
        if (active?.aborted || result?.errorType === 'cancelled') throw new Error('Run cancelled');
        completed.push({ task, result });
        if (!result.success) break;
      }
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
      this._deactivateRun(run.id);
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
    this._deactivateRun(run.id);
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
      const result = await this._withTimeout(llmProvider.generateResponse(
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
      ), LLM_STEP_TIMEOUT_MS, 'Task planning timed out');
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
    const workContext = this._runWorkContext(run);
    const workContextBlock = workContext
      ? `\n\nIDE-selected workspace context:\n${workContext}`
      : '';
    const prior = priorResults.length
      ? `\n\nPrior completed task results:\n${priorResults.map((r, i) => `${i + 1}. ${r.task.title}: ${String(r.result.content || '').slice(0, 1200)}`).join('\n')}`
      : '';
    return `You are a coding agent working under an IDE orchestrator. Complete ONLY the task below. The orchestrator will coordinate other tasks and final synthesis. Spin up as many focused sub-agents as needed to complete the task efficiently, promptly, and correctly; give each sub-agent proper, rich context.

Original user goal:
${run.goal}
${workContextBlock}

Durable project memory:
${memory || '(none)'}${prior}

Assigned task:
${prompt}

Report clearly what you did, files changed, commands run, verification results, and blockers. Do not wait for user input unless truly blocked.`;
  }

  _runWorkContext(run) {
    const session = chatStore.getSession(run.projectId, run.sessionId);
    if (!session) return '';

    const repoPath = session.repoPath?.trim() || null;
    const branch = session.branch?.trim() || null;
    const worktreePath = session.worktreePath?.trim()
      || (branch ? `/workspace/.worktrees/${branch.replace(/[^a-zA-Z0-9._-]/g, '-')}` : null);
    const workDir = session.workDir?.trim() || session.cwd?.trim() || worktreePath || repoPath || '/workspace';

    const lines = [];
    lines.push(`- Branch: ${branch || '(none selected)'}`);
    lines.push(`- repoPath: ${repoPath || '(none selected)'}`);
    lines.push(`- worktreePath: ${worktreePath || '(none selected)'}`);
    lines.push(`- Working directory: ${workDir}`);
    if (branch && worktreePath) lines.push(`- All file reads, edits, commands, tests, commits, deploys, and PR operations must target ${workDir}.`);
    else if (repoPath) lines.push(`- All file reads, edits, commands, tests, commits, deploys, and PR operations must target ${workDir}.`);
    else lines.push('- Do not infer a repository branch from another folder unless the user explicitly selects or names it.');
    return lines.join('\n');
  }

  /**
   * Partition tasks into sequential batches: contiguous research/investigation
   * tasks explicitly marked parallelSafe are grouped into a single parallel
   * batch; all other tasks each become their own serial batch.
   */
  _batchTasks(tasks) {
    return batchTasks(tasks);
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
      if (active) {
        active.agentSessionIds = active.agentSessionIds || new Set();
        active.agentSessionIds.add(agentSession.id);
      }

      const prompt = attempt === 1
        ? task.prompt
        : await this._buildRetryPrompt(run, task, lastResult);

      const result = await agentGateway.handleTask({
        projectId: run.projectId,
        sessionId: agentSession.id,
        content: prompt,
        attachments: [],
        tool: opts.tool,
        model: opts.model,
        effort: opts.effort,
        skipUnread: true,
        orchestrated: true,
        mode: opts.mode || 'agent',
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
    const parentSession = chatStore.getSession(run.projectId, run.sessionId);
    const inheritedContext = {};
    for (const field of ['branch', 'repoPath', 'worktreePath', 'workDir', 'cwd']) {
      if (parentSession?.[field]) inheritedContext[field] = parentSession[field];
    }
    const sessionWorkDir = inheritedContext.workDir || inheritedContext.cwd || this._sessionWorkDirFromMeta(inheritedContext);

    chatStore.updateSessionMeta(run.projectId, session.id, {
      archived: true,
      orchestratorChild: true,
      orchestratorRunId: run.id,
      orchestratorTaskId: task.id,
      parentSessionId: run.sessionId,
      ...inheritedContext,
      ...(sessionWorkDir ? { workDir: sessionWorkDir } : {}),
    });
    return chatStore.getSession(run.projectId, session.id) || session;
  }

  _sessionWorkDirFromMeta(meta = {}) {
    const worktreePath = meta.worktreePath?.trim();
    if (worktreePath) return worktreePath;
    const repoPath = meta.repoPath?.trim();
    if (repoPath) return repoPath;
    return '/workspace';
  }

  _handleAgentBroadcast(run, task, data, broadcastFn) {
    if (!broadcastFn) return;

    // Unified progress dedup: both chat-progress and job-progress feed
    // through the same dedup gate so the same content is never emitted twice.
    let progressContent = null;
    let progressMeta = null;

    if (data?.type === 'chat-progress' && data.message?.content) {
      progressContent = data.message.content;
      progressMeta = data.message.metadata || null;
    } else if (data?.type === 'job-progress' && data.progress?.summary) {
      progressContent = data.progress.summary;
      progressMeta = data.progress;
    }

    if (progressContent) {
      // Suppress generic filler messages that carry no meaningful detail
      if (shouldSuppressAgentProgress(progressContent)) {
        return;
      }

      const now = Date.now();
      const key = run.id;
      const last = this._lastProgress.get(key);
      // Skip if identical content was emitted within dedup window
      if (last && last.content === progressContent && (now - last.ts) < PROGRESS_DEDUP_WINDOW_MS) {
        return;
      }
      this._lastProgress.set(key, { content: progressContent, ts: now });
      this._event(run, task, 'agent-progress', `${task.title}: ${progressContent}`, progressMeta, broadcastFn).catch(() => {});
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
      const result = await this._withTimeout(llmProvider.generateResponse(
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
      ), LLM_STEP_TIMEOUT_MS, 'Final synthesis timed out');
      return result.response?.trim() || `Autonomous run completed.\n\n${summary}`;
    } catch {
      return `Autonomous run completed.\n\n${summary}`;
    }
  }

  _withTimeout(promise, ms, label) {
    let timeout;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(label)), ms);
        timeout.unref?.();
      }),
    ]).finally(() => clearTimeout(timeout));
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
    this._touchRunActivity(run.id, eventType !== 'run-heartbeat');
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

    const transient = !shouldPersistProgressMessage(eventType);
    const progressMessage = {
      projectId: run.projectId,
      sessionId: run.sessionId,
      role: 'progress',
      content: message,
      metadata: { orchestratorRunId: run.id, orchestratorTaskId: task?.id || null, eventType, level, transient, live: true },
    };
    const msg = transient
      ? {
          ...progressMessage,
          id: buildProgressMessageId({ eventType, runId: run.id, messageId: event.id }),
          createdAt: event.createdAt,
        }
      : chatStore.addMessage(progressMessage);
    broadcastFn?.({ type: 'chat-progress', projectId: run.projectId, message: msg });
    broadcastFn?.({ type: 'orchestrator-event', event });
    this.emit('event', event);
    return event;
  }

  _emitRun(run, broadcastFn) {
    this._touchRunActivity(run.id, true);
    const payload = { ...run, tasks: this.getTasks(run.id) };
    broadcastFn?.({ type: 'orchestrator-run', projectId: run.projectId, sessionId: run.sessionId, run: payload });
    this.emit('run', payload);
  }

  _markRunInterrupted(run, broadcastFn = null) {
    const data = { ...(run.data || {}) };
    const error = INTERRUPTED_RUN_ERROR;
    run.status = 'failed';
    run.phase = 'failed';
    run.error = error;
    run.completedAt = nowIso();
    run.updatedAt = run.completedAt;
    run.data = { ...data, interrupted: true };
    this._saveRun(run);

    if (!data.reliabilityNoticeCreated) {
      const msg = chatStore.addMessage({
        projectId: run.projectId,
        sessionId: run.sessionId,
        role: 'error',
        content: error,
        metadata: { orchestratorRunId: run.id, interrupted: true, recoveryPending: true },
      });
      broadcastFn?.({ type: 'chat-message', message: msg });
      run.data = { ...run.data, reliabilityNoticeCreated: true };
      this._saveRun(run);
      this._event(run, null, 'run-interrupted', error, { interrupted: true }, broadcastFn, 'error').catch(() => {});
    }

    this._emitRun(run, broadcastFn);
    return run;
  }

  _startLivenessMonitor(run, broadcastFn) {
    const active = this.activeRuns.get(run.id);
    if (!active || active.livenessTimer) return;

    active.livenessTimer = setInterval(() => {
      this._emitLivenessHeartbeat(run.id, broadcastFn).catch(err => {
        console.warn('[agentOrchestrator] Liveness heartbeat failed:', err.message);
      });
    }, LIVENESS_INTERVAL_MS);
    active.livenessTimer.unref?.();
  }

  async _emitLivenessHeartbeat(runId, broadcastFn) {
    const active = this.activeRuns.get(runId);
    if (!active || active.aborted) return;

    const now = Date.now();
    if (!shouldEmitLivenessHeartbeat({ now, lastActivityAt: active.lastActivityAt, staleMs: LIVENESS_STALE_MS })) return;

    const run = this.getRun(runId);
    if (!run || !ACTIVE_RUN_STATUSES.includes(run.status)) return;

    const session = chatStore.getSession(run.projectId, run.sessionId);
    if (session?.status !== 'open') return;

    const task = this._currentActiveTask(runId);
    const silenceMs = now - (active.lastMeaningfulActivityAt || active.lastActivityAt || now);
    const seconds = Math.max(1, Math.round(silenceMs / 1000));
    const message = buildLivenessHeartbeatMessage({ taskTitle: task?.title || null, phase: run.phase, silenceMs });

    await this._event(
      run,
      task,
      'run-heartbeat',
      message,
      { heartbeat: true, phase: run.phase, silenceSeconds: seconds },
      broadcastFn
    );
  }

  _currentActiveTask(runId) {
    const row = sqliteStore.db.prepare(`SELECT * FROM orchestrator_tasks
      WHERE run_id = ? AND status IN ('running', 'retrying')
      ORDER BY updated_at DESC LIMIT 1`).get(runId);
    return rowToTask(row);
  }

  _touchRunActivity(runId, meaningful = true) {
    const active = this.activeRuns.get(runId);
    if (!active) return;
    const now = Date.now();
    active.lastActivityAt = now;
    if (meaningful) active.lastMeaningfulActivityAt = now;
  }

  _deactivateRun(runId) {
    const active = this.activeRuns.get(runId);
    if (active?.livenessTimer) clearInterval(active.livenessTimer);
    this.activeRuns.delete(runId);
    this._lastProgress.delete(runId);
  }
}

export const agentOrchestrator = new AgentOrchestrator();
export default agentOrchestrator;
