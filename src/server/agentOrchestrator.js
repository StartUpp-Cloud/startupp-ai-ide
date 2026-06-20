import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { getDB } from './db.js';
import { sqliteStore } from './sqliteStore.js';
import { chatStore } from './chatStore.js';
import { agentGateway } from './agentGateway.js';
import { memoryStore } from './memoryStore.js';
import skillManager from './skillManager.js';
import { shouldOrchestrateRequest } from './orchestratorRouting.js';
import { batchTasks } from './orchestratorBatching.js';
import { ACTIVE_RUN_STALE_MS } from './sessionRecovery.js';
import {
  buildRunFailureEventMessage,
  buildRunFailureResponse,
  buildThinFinalResponse,
} from './orchestratorMessages.js';
import {
  INTERRUPTED_RUN_ERROR,
  buildLivenessHeartbeatMessage,
  buildProgressMessageId,
  shouldEmitLivenessHeartbeat,
  shouldPersistProgressMessage,
  shouldSuppressAgentProgress,
} from './orchestratorLiveness.js';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_RUN_RETRIES = 2; // Run-level auto-retries after all task attempts are exhausted
const RUN_RETRY_DELAY_MS = 8000; // Delay between run-level retries
const PROGRESS_DEDUP_WINDOW_MS = 5000; // Suppress identical progress within 5s
const LIVENESS_INTERVAL_MS = 5000;
const LIVENESS_STALE_MS = 4000;
const ACTIVE_RUN_STATUSES = ['running'];
const ACTIVE_RUN_STATUS_SQL = ACTIVE_RUN_STATUSES.map(() => '?').join(', ');
// Cross-restart recovery: a run whose in-memory state was lost (process restart)
// is resumed rather than declared interrupted, so it always drives through to an
// answer. Bounded so a poison run can't loop forever across repeated restarts.
const MAX_RECOVERY_ATTEMPTS = 5;
const RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000; // don't resurrect day-old runs on boot
const RECOVERABLE_RUN_STATUSES = ['failed', 'blocked'];

const NON_RETRYABLE_PATTERNS = [
  /not configured|missing configuration|configuration required/i,
  /api key.*(missing|not configured|invalid)|token.*(missing|not configured|invalid)/i,
  /authentication failed|unauthorized|forbidden|login required|not logged in/i,
  /command not found|not installed|executable file not found/i,
  /model .*not found|model .*not registered|could not find.*model|provider.*not found|no such model|not registered/i,
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

function trimPromptContext(value, maxLength = 2000) {
  const text = String(value || '').trim().replace(/\n{3,}/g, '\n\n');
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}\n...[truncated]` : text;
}

function extractXmlBlock(value, blockName, maxLength = 2000) {
  const source = String(value || '');
  const match = source.match(new RegExp(`<${blockName}>\\s*([\\s\\S]*?)\\s*</${blockName}>`, 'i'));
  return trimPromptContext(match?.[1] || '', maxLength);
}

export function isContinuationRequest(content = '') {
  const text = String(content || '').toLowerCase();
  if (!text.trim()) return false;
  return /\b(?:continue|resume|retry|try again|keep going|proceed)\b/.test(text)
    || /\bpush(?:ing)?\s+(?:the\s+)?(?:coding\s+)?agent\b/.test(text)
    || /\bfrom\s+(?:the\s+)?(?:latest|current)\s+state\b/.test(text)
    || /\buntil\s+(?:it(?:'s| is)?\s+)?(?:done|complete|completed)\b/.test(text);
}

export function buildRecoveredRunContextForPrompt({ currentRequest = '', previousRun = null, previousTask = null, events = [] } = {}) {
  if (!previousRun) return '';

  const parentConversation = extractXmlBlock(previousTask?.prompt, 'recent_parent_conversation', 2600);
  const assignedTask = extractXmlBlock(previousTask?.prompt, 'assigned_task', 1800);
  const progressLines = [];
  const seenProgress = new Set();
  for (const event of events || []) {
    if (!['agent-progress', 'task-stalled-retry', 'task-retrying', 'task-failed', 'failed'].includes(event?.eventType)) continue;
    const message = trimPromptContext(event.message, 300).replace(/\s+/g, ' ');
    if (!message || seenProgress.has(message)) continue;
    seenProgress.add(message);
    progressLines.push(`${event.createdAt || 'unknown time'} - ${message}`);
  }

  return [
    'The current user request asks to continue after a previous IDE coding-agent run did not finish. Resume the prior implementation objective; do not reduce this to a repository-cleanliness check unless the prior objective is verified complete.',
    `Current user request:\n${trimPromptContext(currentRequest, 1000) || '(none)'}`,
    [
      'Previous run:',
      `- id: ${previousRun.id || '(unknown)'}`,
      `- status: ${previousRun.status || '(unknown)'}`,
      `- previous task: ${previousTask?.title || '(unknown)'}`,
      `- error: ${trimPromptContext(previousRun.error, 500) || trimPromptContext(previousTask?.error, 500) || '(none recorded)'}`,
    ].join('\n'),
    `Previous original goal:\n${trimPromptContext(previousRun.goal, 2200) || '(none recorded)'}`,
    parentConversation ? `Relevant parent conversation from the previous handoff:\n${parentConversation}` : '',
    assignedTask ? `Previous assigned task:\n${assignedTask}` : '',
    progressLines.length > 0 ? `Previous progress and failure events:\n${progressLines.slice(-12).join('\n')}` : '',
    'Continuation instructions:\nInspect the current workspace, determine what the previous run already completed, finish the remaining implementation, then verify, push, and deploy if the original task requires it. If everything is already complete, prove that against the prior objective and the checks performed.',
  ].filter(Boolean).join('\n\n');
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
    // Recovery is intentionally NOT done here — at process init the broadcast
    // channel and container/agent infra may not be ready. The reliability sweep
    // (terminalServer) runs shortly after boot with a live broadcastFn and
    // drives resume/interrupt then. Runs simply remain in 'running' status until
    // that sweep picks them up.
    const pending = sqliteStore.db.prepare(
      `SELECT COUNT(*) AS n FROM orchestrator_runs WHERE status IN (${ACTIVE_RUN_STATUS_SQL})`,
    ).get(...ACTIVE_RUN_STATUSES);
    if (pending?.n > 0) {
      console.log(`[agentOrchestrator] ${pending.n} run(s) pending recovery; reliability sweep will resume them.`);
    }
  }

  shouldOrchestrate({ mode, content, executeReviewedPlan = false }) {
    return shouldOrchestrateRequest({ mode, content, executeReviewedPlan });
  }

  async startRun({ projectId, sessionId, content, attachments = [], mode = 'agent', tool = 'claude', model = null, effort = null, broadcastFn, skipUnread = false, executeReviewedPlan = false }) {
    const recoveredContinuation = this._findRecoverableContinuationContext(projectId, sessionId, content);
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
      data: {
        attachments,
        mode,
        executeReviewedPlan,
        ...(recoveredContinuation ? {
          continuationContext: recoveredContinuation.context,
          continuationFromRunId: recoveredContinuation.runId,
          continuationFromTaskId: recoveredContinuation.taskId,
        } : {}),
      },
    };

    this._saveRun(run);
    this.activeRuns.set(run.id, { aborted: false, broadcastFn, lastActivityAt: Date.now(), lastMeaningfulActivityAt: Date.now() });
    this._startLivenessMonitor(run, broadcastFn);
    this._emitRun(run, broadcastFn);
    await this._event(run, null, 'run-started', `Started autonomous run with ${tool}.`, { tool, model, effort }, broadcastFn);

    this._executeRun(run, { attachments, mode, tool, model, effort, broadcastFn, skipUnread })
      .catch((err) => this._handleRunCrash(run, err, { broadcastFn, tool, model }));

    return run;
  }

  /**
   * Terminal handler when _executeRun throws (not a graceful task failure —
   * those are handled inside _executeRun). Shared by initial runs and resumes.
   */
  async _handleRunCrash(run, err, { broadcastFn, tool, model }) {
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
      const profile = this._getProfile();
      const userMessage = buildRunFailureResponse({ status: run.status, error: err.message, tool, model, profile });
      const eventMessage = buildRunFailureEventMessage({ status: run.status, error: err.message, tool, model });
      await this._event(run, null, 'run-failed', eventMessage, { rawError: err.message }, broadcastFn, 'error');
      const msg = chatStore.addMessage({
        projectId: run.projectId,
        sessionId: run.sessionId,
        role: 'agent',
        content: userMessage,
        metadata: { orchestratorRunId: run.id, orchestratorFailure: true, rawError: err.message },
      });
      broadcastFn?.({ type: 'chat-message', message: msg });
    }
    this._emitRun(run, broadcastFn);
    this._deactivateRun(run.id);
  }

  /**
   * Decide how to recover a run whose in-memory state was lost (process
   * restart): resume it (default) so it drives through to an answer, or — as a
   * last resort — mark it interrupted. Returns the run only if it was marked
   * interrupted (so callers can surface/auto-retry it); null if resumed.
   */
  _recoverRun(run, broadcastFn) {
    if (!run || this.activeRuns.has(run.id)) {
      if (run) this._emitRun(run, broadcastFn);
      return null;
    }
    const overCap = (run.data?.recoveryAttempts || 0) >= MAX_RECOVERY_ATTEMPTS;
    const ageMs = Date.now() - (Date.parse(run.updatedAt || run.startedAt) || 0);
    const session = chatStore.getSession(run.projectId, run.sessionId);
    // Resume unless the parent session is gone or explicitly closed/archived.
    const sessionUsable = session && session.status !== 'closed' && session.status !== 'archived';
    const resumable = !overCap && ageMs <= RECOVERY_MAX_AGE_MS && sessionUsable;
    if (!resumable) return this._markRunInterrupted(run, broadcastFn);
    this.resumeRun(run, broadcastFn);
    return null;
  }

  /**
   * Resume a run after a restart. Reuses persisted tasks: completed ones feed
   * synthesis directly (recovering the answer without re-running the agent when
   * the crash happened during synthesis), and unfinished ones are re-driven with
   * a recovery prompt on a FRESH agent session (a new CLI thread — avoids
   * colliding with any still-detached agent process from before the restart).
   */
  resumeRun(run, broadcastFn) {
    // Reserve the slot synchronously so concurrent reconcilers don't double-drive.
    if (this.activeRuns.has(run.id)) return run;
    this.activeRuns.set(run.id, {
      aborted: false, broadcastFn, recovering: true,
      lastActivityAt: Date.now(), lastMeaningfulActivityAt: Date.now(),
    });

    const recoveryAttempts = (run.data?.recoveryAttempts || 0) + 1;
    const tasks = this.getTasks(run.id);

    for (const t of tasks) {
      if (t.status === 'completed' || t.status === 'blocked') continue;
      // Fresh continuation: new CLI thread + recovery-wrapped prompt.
      t.agentSessionId = null;
      t.attempt = 0;
      t.status = 'pending';
      t.error = null;
      t.startedAt = null;
      t.completedAt = null;
      // Persist the reset state, then wrap the prompt in-memory for this run.
      // (_saveTask doesn't persist `prompt`, so the DB keeps the original — which
      // means each resume wraps the original fresh and never nests wrappers.)
      this._saveTask(t);
      t.prompt = this._buildRecoveryPrompt(t);
    }

    run.status = 'running';
    run.phase = 'executing';
    run.error = null;
    run.completedAt = null;
    run.data = { ...(run.data || {}), recoveryAttempts };
    run.updatedAt = nowIso();
    this._saveRun(run);
    this._startLivenessMonitor(run, broadcastFn);
    this._emitRun(run, broadcastFn);

    // Non-terminal, informational — NOT the scary "interrupted" failure message.
    this._event(run, null, 'run-resumed',
      `Reconnected after a service restart — continuing this run where it left off (recovery ${recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS}).`,
      { recoveryAttempts }, broadcastFn, 'info').catch(() => {});

    const opts = {
      attachments: run.data?.attachments || [],
      mode: run.data?.mode || 'agent',
      tool: run.tool, model: run.model, effort: run.effort,
      broadcastFn: broadcastFn || (() => {}),
      skipUnread: false,
      // Only use resume mode if there are persisted tasks; otherwise let
      // _executeRun plan fresh from the original goal.
      resume: tasks.length > 0,
      resumeTasks: tasks,
    };
    this._executeRun(run, opts)
      .catch((err) => this._handleRunCrash(run, err, { broadcastFn: opts.broadcastFn, tool: run.tool, model: run.model }));
    return run;
  }

  _buildRecoveryPrompt(task) {
    return `[RECOVERY — the service restarted while this task was in progress; a previous attempt may have partially completed it]
Before doing anything else:
1. Inspect the CURRENT state to see what is already done (e.g. git status/diff, what is already deployed, existing test results).
2. Do NOT redo work that is already complete.
3. Continue and finish the remaining work, honoring all project rules.
4. Verify, then report.

--- ORIGINAL TASK ---
${task.prompt}`;
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
      // Resume by default; only collect runs we gave up on (marked interrupted).
      const interrupted = this._recoverRun(run, broadcastFn);
      if (interrupted) reconciled.push(interrupted);
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
      // Resume by default; only collect runs we gave up on (marked interrupted).
      const interrupted = this._recoverRun(run, broadcastFn);
      if (interrupted) reconciled.push(interrupted);
    }
    return reconciled;
  }

  getRecentSessionRuns(projectId, sessionId, limit = 5, { reconcile = true } = {}) {
    if (reconcile) this.reconcileSessionRuns(projectId, sessionId);
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

  _findRecoverableContinuationContext(projectId, sessionId, content) {
    if (!isContinuationRequest(content)) return null;
    const latest = sqliteStore.db.prepare(`SELECT * FROM orchestrator_runs
      WHERE project_id = ? AND session_id = ?
      ORDER BY started_at DESC LIMIT 1`).get(projectId, sessionId);
    const previousRun = rowToRun(latest);
    if (!previousRun || !RECOVERABLE_RUN_STATUSES.includes(previousRun.status)) return null;

    const previousTasks = this.getTasks(previousRun.id);
    const previousTask = [...previousTasks].reverse()
      .find(task => ['failed', 'blocked', 'retrying', 'running'].includes(task.status))
      || [...previousTasks].reverse()[0]
      || null;
    const context = buildRecoveredRunContextForPrompt({
      currentRequest: content,
      previousRun,
      previousTask,
      events: this.getEvents(previousRun.id, 120),
    });
    if (!context) return null;
    return { context, runId: previousRun.id, taskId: previousTask?.id || null };
  }

  async _executeRun(run, opts) {
    const active = this.activeRuns.get(run.id);
    const { attachments = [], mode, tool, model, effort, broadcastFn, skipUnread } = opts;
    const maxRunRetries = DEFAULT_MAX_RUN_RETRIES;

    let lastFailedResult = null;
    for (let runAttempt = 0; runAttempt <= maxRunRetries; runAttempt++) {
      if (active?.aborted) throw new Error('Run cancelled');

      // For run-level retries, build a retry-aware task prompt
      const retryOpts = runAttempt > 0
        ? { ...opts, runRetryContext: { attempt: runAttempt, maxRetries: maxRunRetries, previousError: lastFailedResult?.error } }
        : opts;

      // Resume mode (only on the first attempt of a recovered run): reuse the
      // persisted tasks instead of planning fresh. Already-completed tasks feed
      // synthesis directly so we recover the answer without re-running the agent.
      const resuming = opts.resume && runAttempt === 0;
      let tasks;
      const completed = [];
      if (resuming) {
        const persisted = opts.resumeTasks || [];
        for (const t of persisted.filter(t => t.status === 'completed')) {
          completed.push({ task: t, result: { success: true, content: t.result || '', changedFiles: [] } });
        }
        tasks = persisted.filter(t => t.status !== 'completed');
      } else {
        tasks = await this._planTasks(run, retryOpts);
        for (const task of tasks) this._saveTask(task);
      }

      run.phase = 'executing';
      run.updatedAt = nowIso();
      run.data = { ...(run.data || {}), taskCount: tasks.length + completed.length, runAttempt };
      this._saveRun(run);
      this._emitRun(run, broadcastFn);
      if (runAttempt === 0 && !resuming) {
        await this._event(run, null, 'tasks-created', `Created ${tasks.length} agent task${tasks.length === 1 ? '' : 's'}.`, { tasks: tasks.map(t => ({ id: t.id, title: t.title, type: t.taskType })) }, broadcastFn);
      }

      const batches = this._batchTasks(tasks);
      for (const batch of batches) {
        if (active?.aborted) throw new Error('Run cancelled');

        if (batch.parallel) {
          const promises = batch.tasks.map(task =>
            this._runTaskWithRetries(run, task, { attachments, mode, tool, model, effort, broadcastFn, skipUnread })
              .then(result => ({ task, result }))
          );
          const results = await Promise.all(promises);

          if (active?.aborted) throw new Error('Run cancelled');
          for (const item of results) {
            completed.push(item);
          }
          const failed = results.find(item => !item.result.success);
          if (failed) break;
        } else {
          const task = batch.tasks[0];
          // Pipeline tasks (consolidate/validate) build their prompt now, from
          // the results produced so far.
          this._prepareTaskPrompt(run, task, completed);
          const result = await this._runTaskWithRetries(run, task, { attachments, mode, tool, model, effort, broadcastFn, skipUnread });
          if (active?.aborted || result?.errorType === 'cancelled') throw new Error('Run cancelled');
          completed.push({ task, result });
          if (!result.success) break;
        }
      }

      const failed = completed.find(item => !item.result.success);
      if (failed) {
        // If retryable and we have run-level retries left, auto-retry instead of surfacing failure
        if (failed.result.retryable && runAttempt < maxRunRetries && !active?.aborted) {
          lastFailedResult = failed.result;
          const nextAttempt = runAttempt + 2; // 1-indexed for display
          const totalAttempts = maxRunRetries + 1;
          await this._event(run, failed.task, 'run-auto-retry',
            `Auto-retrying run (attempt ${nextAttempt}/${totalAttempts}). Previous: ${failed.result.errorType || 'transient failure'}.`,
            { runAttempt: runAttempt + 1, maxRunRetries, errorType: failed.result.errorType, rawError: failed.result.error },
            broadcastFn, 'warning');
          await new Promise(resolve => setTimeout(resolve, RUN_RETRY_DELAY_MS));
          continue;
        }

        const profile = this._getProfile();
        run.status = failed.result.retryable ? 'failed' : 'blocked';
        run.phase = run.status;
        run.error = failed.result.error || `Task failed: ${failed.task.title}`;
        run.completedAt = nowIso();
        run.updatedAt = run.completedAt;
        this._saveRun(run);
        const userMessage = buildRunFailureResponse({
          status: run.status,
          taskTitle: failed.task.title,
          error: run.error,
          tool,
          model,
          retryable: failed.result.retryable,
          errorType: failed.result.errorType,
          profile,
        });
        const eventMessage = buildRunFailureEventMessage({
          status: run.status,
          taskTitle: failed.task.title,
          error: run.error,
          tool,
          model,
          retryable: failed.result.retryable,
          errorType: failed.result.errorType,
        });
        await this._event(run, failed.task, run.status, eventMessage, { ...failed.result, rawError: run.error }, broadcastFn, 'error');
        const msg = chatStore.addMessage({
          projectId: run.projectId,
          sessionId: run.sessionId,
          role: 'agent',
          content: userMessage,
          metadata: {
            orchestratorRunId: run.id,
            orchestratorTaskId: failed.task.id,
            orchestratorFailure: true,
            rawError: run.error,
            ...(failed.result.changedFiles?.length > 0 ? { changedFiles: failed.result.changedFiles } : {}),
          },
        });
        broadcastFn({ type: 'chat-message', message: msg });
        this._emitRun(run, broadcastFn);
        this._deactivateRun(run.id);
        return;
      }

      // Success — synthesize and return
      run.phase = 'synthesizing';
      run.updatedAt = nowIso();
      this._saveRun(run);
      this._emitRun(run, broadcastFn);
      await this._event(run, null, 'synthesizing', 'Formatting the coding agent response.', null, broadcastFn);

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
      return;
    } // end run-level retry loop
  }

  async _planTasks(run, { executeReviewedPlan, runRetryContext } = {}) {
    const isRunRetry = runRetryContext?.attempt > 0;

    // Approved plans and run-level retries stay single-task (already structured).
    if (executeReviewedPlan || isRunRetry) {
      const prompt = isRunRetry
        ? this._buildRunRetryTaskPrompt(run, runRetryContext)
        : this._buildTaskPrompt(run, run.goal, []);
      return [this._createTask(run, {
        title: executeReviewedPlan ? 'Execute approved plan' : `Retry user request (attempt ${runRetryContext.attempt + 1})`,
        prompt,
        taskType: executeReviewedPlan ? 'implementation' : 'general',
      })];
    }

    // For explicitly multi-step goals, decompose into a multi-agent pipeline:
    //   sub-tasks → consolidate → validate → (synthesize reply).
    // Decomposition is DETERMINISTIC (no LLM in the orchestrator — all content
    // generation stays in the CLI agents). Single-step goals fall back to one
    // task; the CLI agent is already instructed to spin its own sub-agents.
    const subtasks = this._heuristicDecompose(run);
    if (!subtasks || subtasks.length <= 1) {
      return [this._createTask(run, {
        title: 'Complete user request',
        prompt: this._buildTaskPrompt(run, run.goal, []),
        taskType: 'general',
      })];
    }

    const tasks = subtasks.map((st) =>
      this._createTask(run, {
        title: st.title,
        prompt: this._buildTaskPrompt(run, st.prompt, []),
        taskType: st.parallelSafe ? 'research' : 'implementation',
        parallelSafe: !!st.parallelSafe,
      }),
    );

    // One consolidator integrates the sub-agent work; one validator tests it.
    // Their prompts are (re)built at execution time with the prior results.
    const consolidate = this._createTask(run, { title: 'Consolidate sub-agent work', prompt: '(built at run time)', taskType: 'consolidation' });
    consolidate.data = { ...consolidate.data, phase: 'consolidate', usePriorResults: true };
    const validate = this._createTask(run, { title: 'Validate & test', prompt: '(built at run time)', taskType: 'validation' });
    validate.data = { ...validate.data, phase: 'validate', usePriorResults: true };

    return [...tasks, consolidate, validate];
  }

  /**
   * Deterministically split a goal into sub-tasks from the user's OWN explicit
   * structure (numbered or bulleted steps). No LLM — content generation stays in
   * the CLI agents. Returns null for non-enumerated goals (→ single task).
   * Sub-tasks run sequentially by default (they share one workspace); the
   * consolidate phase reconciles them.
   */
  _heuristicDecompose(run) {
    const goal = String(run.goal || '');
    const itemStart = /^\s*(?:\d+[.)]|[-*•])\s+(.+)$/;
    const items = [];
    let current = null;
    for (const line of goal.split('\n')) {
      const m = line.match(itemStart);
      if (m) {
        if (current) items.push(current);
        current = m[1].trim();
      } else if (current && line.trim()) {
        current += ' ' + line.trim();
      }
    }
    if (current) items.push(current);

    const cleaned = items.map((s) => s.trim()).filter((s) => s.length > 3);
    if (cleaned.length < 2) return null;

    return cleaned.slice(0, 5).map((item, i, arr) => ({
      title: item.slice(0, 70),
      parallelSafe: false,
      prompt: `This is part ${i + 1} of ${arr.length} of the user's overall request. Focus ONLY on your part; later phases consolidate and validate all parts together.\n\nOVERALL REQUEST:\n${goal}\n\nYOUR PART:\n${item}`,
    }));
  }

  /** (Re)build a pipeline task's prompt at run time with the prior results. */
  _prepareTaskPrompt(run, task, completed) {
    if (task.data?.phase === 'consolidate') {
      const inner = `CONSOLIDATION PHASE — integrate the sub-agent results above into ONE coherent solution for the original request. Reconcile overlapping or conflicting changes, remove duplication, ensure consistency across files, and make any edits needed so the combined result fully satisfies:\n\n${run.goal}\n\nThen briefly report what you reconciled.`;
      task.prompt = this._buildTaskPrompt(run, inner, completed);
    } else if (task.data?.phase === 'validate') {
      const inner = `VALIDATION & FINAL REPORT PHASE — this is the LAST step; your output becomes the reply to the user.\n\nFor the original request:\n\n${run.goal}\n\n1. Run the project's tests / build / typecheck (and exercise the running app via the configured test users if relevant). Report REAL pass/fail output. Fix quick failures you find; do NOT add new features. If a check cannot be run, say exactly why.\n2. Then write the user-facing summary of the COMPLETE work across all parts above (what changed, how it was verified, anything outstanding), using the standard ## Summary / ## Changes / ## Verification / ## Next report.`;
      task.prompt = this._buildTaskPrompt(run, inner, completed);
    }
    return task.prompt;
  }

  _buildRunRetryTaskPrompt(run, retryContext) {
    const errorSlice = String(retryContext.previousError || '').slice(0, 1500);
    const retryGoal = `The previous attempt to complete this request failed after exhausting retries. This is an automatic run-level retry (attempt ${retryContext.attempt + 1}/${retryContext.maxRetries + 1}).

Previous failure:
${errorSlice}

Inspect the current repository state, identify what was already done (if anything), and complete the remaining work. Adjust your approach to avoid the same failure.

Original request:
${run.goal}`;
    return this._buildTaskPrompt(run, retryGoal, []);
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

  _xmlBlock(name, content) {
    const text = String(content || '').trim();
    if (!text) return `<${name}>(none)</${name}>`;
    const safe = text.replace(new RegExp(`</${name}>`, 'gi'), `<\\/${name}>`);
    return `<${name}>\n${safe}\n</${name}>`;
  }

  _getProfile() {
    try {
      const profile = getDB().data?.profile;
      return profile?.setupComplete ? profile : null;
    } catch {
      return null;
    }
  }

  _profileContext(profile = null) {
    if (!profile) return '';
    const parts = [];
    if (profile.name) parts.push(`Name: ${profile.name}`);
    if (profile.role) parts.push(`Role: ${profile.role}`);
    if (profile.languages) parts.push(`Languages and frameworks: ${profile.languages}`);
    if (profile.codeStyle) parts.push(`Code style: ${profile.codeStyle}`);
    if (profile.tone) parts.push(`Preferred tone: ${profile.tone}`);
    if (profile.preferences) parts.push(`Preferences: ${profile.preferences}`);
    return parts.join('\n');
  }

  _responseGuidance(profile = null) {
    const tone = String(profile?.tone || 'concise').toLowerCase();
    const lines = [
      'Speak as the IDE assistant working with the user, not as a separate hidden session.',
      'If this is a new CLI session, continue naturally and do not mention that the session is new.',
      'Use the user name naturally when it helps, but do not force it into every sentence.',
      'Prefer a useful final answer with what changed, verification, and any blockers.',
    ];
    if (tone === 'concise') lines.push('Keep the final response concise and direct.');
    else if (tone === 'detailed') lines.push('Include enough detail for the user to understand decisions and verification.');
    else if (tone === 'casual') lines.push('Use a warm, natural tone while staying precise.');
    else if (tone === 'formal') lines.push('Use a professional, structured tone.');
    if (profile?.preferences) lines.push(`Respect user preferences: ${profile.preferences}`);
    return lines.join('\n');
  }

  _attachmentContext(run) {
    const attachments = Array.isArray(run.data?.attachments) ? run.data.attachments : [];
    if (attachments.length === 0) return '';
    return attachments.map((attachment, index) => {
      const fields = [
        `${index + 1}. ${attachment.name || attachment.path || attachment.id || 'attachment'}`,
        attachment.type ? `type=${attachment.type}` : null,
        Number.isFinite(attachment.size) ? `size=${attachment.size}` : null,
        attachment.path ? `path=${attachment.path}` : null,
      ].filter(Boolean);
      return fields.join(' | ');
    }).join('\n');
  }

  _recentConversationContext(run) {
    try {
      const messages = chatStore.getMessages(run.projectId, { sessionId: run.sessionId, limit: 40 }) || [];
      return [...messages]
        .filter(message => ['user', 'agent', 'error'].includes(message.role))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .slice(-8)
        .map(message => `${message.role}: ${String(message.content || '').replace(/\s+/g, ' ').slice(0, 600)}`)
        .join('\n');
    } catch {
      return '';
    }
  }

  _buildTaskPrompt(run, prompt, priorResults = []) {
    const memory = memoryStore.buildContextForLLM(run.projectId, { query: `${run.goal}\n${prompt}`, maxTokens: 1400 });
    const workContext = this._runWorkContext(run);
    const profile = this._getProfile();
    const profileContext = this._profileContext(profile);
    const attachments = this._attachmentContext(run);
    const recentConversation = this._recentConversationContext(run);
    const recoveredContinuation = run.data?.continuationContext || '';
    const prior = priorResults.length
      ? priorResults.map((r, i) => `${i + 1}. ${r.task.title}: ${String(r.result.content || '').slice(0, 1200)}`).join('\n')
      : '';
    return [
      '<ide_orchestrator_handoff version="1">',
      this._xmlBlock('control_loop_role', 'You are the coding agent being driven by an IDE control loop. Do the repository reasoning, edits, commands, tests, and final reporting. The IDE orchestrator tracks progress, formats responses, and decides whether another push is needed.'),
      this._xmlBlock('session_continuity', 'Treat this as the same user conversation even if the CLI session is fresh — use the context below for continuity only. CRITICAL: the <assigned_task> below is the ONLY thing to work on right now. Earlier messages, previous tasks, and prior context are BACKGROUND, not instructions. Do NOT resume, repeat, re-polish, reorder, or extend earlier work unless <assigned_task> explicitly says so. If the assigned task is unrelated to what was discussed before, fully switch focus to it. Do not tell the user a new agent session started unless it is relevant to a blocker.'),
      this._xmlBlock('user_profile_and_preferences', profileContext),
      this._xmlBlock('response_guidance', this._responseGuidance(profile)),
      this._xmlBlock('recovered_previous_run_context', recoveredContinuation),
      this._xmlBlock('recent_parent_conversation', recentConversation),
      this._xmlBlock('original_user_goal', run.goal),
      this._xmlBlock('ide_selected_workspace', workContext),
      this._xmlBlock('attached_files', attachments),
      this._xmlBlock('durable_project_memory', memory || '(none)'),
      this._xmlBlock('skill_context', this._buildSkillContextForTask(run, prompt) || '(none)'),
      this._xmlBlock('prior_completed_task_results', prior),
      this._xmlBlock('assigned_task', prompt),
      this._xmlBlock('execution_contract', 'Work ONLY on <assigned_task>; earlier conversation and previous tasks are background context, not new instructions — do not redo or extend them. Complete the assigned task end-to-end. Treat attached files as authoritative; if an attached file is present, do not substitute a similarly named workspace file unless the attachment is unavailable and you say so. Spin up as many focused sub-agents as needed to complete the task efficiently, promptly, and correctly; give each sub-agent proper, rich context. Do not wait for user input unless truly blocked. If you need user input, include the exact questions, options, and recommended safe default in your final answer. Report files changed, commands run, verification results, and blockers. Keep unresolved assumptions explicit.'),
      '</ide_orchestrator_handoff>',
    ].join('\n\n');
  }

  _buildSkillContextForTask(run, taskPrompt) {
    try {
      const text = String(taskPrompt || '').toLowerCase();
      const taskTags = [];

      const tagMap = [
        [['react', 'component', 'jsx', 'tsx', 'ui', 'frontend', 'css', 'tailwind'], ['frontend', 'react', 'ui']],
        [['test', 'testing', 'spec', 'coverage', 'jest', 'vitest'], ['testing']],
        [['deploy', 'docker', 'container', 'kubernetes', 'ci/cd'], ['deployment', 'devops']],
        [['database', 'migration', 'schema', 'sql', 'prisma'], ['database']],
        [['security', 'auth', 'authentication', 'vulnerability', 'owasp'], ['security']],
        [['api', 'endpoint', 'route', 'rest', 'graphql'], ['api']],
        [['git', 'commit', 'branch', 'merge', 'pr'], ['git']],
        [['typescript', 'types', 'interface'], ['typescript']],
      ];

      for (const [keywords, tags] of tagMap) {
        if (keywords.some((kw) => text.includes(kw))) {
          for (const tag of tags) {
            if (!taskTags.includes(tag)) taskTags.push(tag);
          }
        }
      }

      if (!taskTags.length) return '';

      return skillManager.buildSkillContextForTask(run.projectId, { taskTags, filePaths: [] }) || '';
    } catch (err) {
      console.error('[AgentOrchestrator] skill context error:', err.message);
      return '';
    }
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
        attachments: opts.attachments || [],
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
        await this._event(run, task, 'task-blocked', buildRunFailureEventMessage({
          status: 'blocked',
          taskTitle: task.title,
          error: task.error,
          tool: opts.tool,
          model: opts.model,
          retryable: false,
          errorType: lastResult.errorType,
        }), { ...lastResult, rawError: task.error }, opts.broadcastFn, 'error');
        return lastResult;
      }

      if (attempt < task.maxAttempts) {
        task.status = 'retrying';
        this._saveTask(task);
        await this._event(run, task, 'task-retrying', buildRunFailureEventMessage({
          status: 'retrying',
          taskTitle: task.title,
          error: task.error,
          tool: opts.tool,
          model: opts.model,
          retryable: true,
          errorType: lastResult.errorType,
        }), { attempt, maxAttempts: task.maxAttempts, reason: lastResult.errorType, rawError: task.error }, opts.broadcastFn, 'warning');
        await new Promise(resolve => setTimeout(resolve, this._retryDelayMs(attempt, lastResult)));
      }
    }

    task.status = 'failed';
    task.completedAt = nowIso();
    task.updatedAt = task.completedAt;
    this._saveTask(task);
    await this._event(run, task, 'task-failed', buildRunFailureEventMessage({
      status: 'failed',
      taskTitle: task.title,
      error: task.error,
      tool: opts.tool,
      model: opts.model,
      retryable: true,
      errorType: lastResult?.errorType,
    }), { ...(lastResult || {}), rawError: task.error }, opts.broadcastFn, 'error');
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

    // Forward the per-task live checklist (chat-checks) to the PARENT session so
    // the user sees engaging step-by-step status during orchestrated runs — the
    // child agent session it was emitted under isn't the one the client watches.
    if (data?.type === 'chat-checks') {
      broadcastFn({ ...data, sessionId: run.sessionId, runId: run.id, taskId: task?.id });
      return;
    }

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
    if (result?.requiresUserInput || result?.errorType === 'needs-user' || result?.retryType === 'needs-user') {
      return { success: false, retryable: false, errorType: 'needs-user', error };
    }
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
    // For a decomposed pipeline the validate phase wrote the comprehensive,
    // user-facing summary of all parts — use it as the single final reply.
    const validate = [...completed].reverse().find(
      (c) => c?.task?.data?.phase === 'validate' && c?.result?.success !== false && String(c?.result?.content || '').trim(),
    );
    const chosen = validate ? [validate] : completed;
    return buildThinFinalResponse({ completed: chosen, profile: this._getProfile() });
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
        role: 'agent',
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
