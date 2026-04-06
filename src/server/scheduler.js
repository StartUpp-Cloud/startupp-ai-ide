/**
 * Scheduler
 * A cron-like scheduler that runs tasks on configurable intervals.
 * Tasks can be shell commands, test runs, or orchestrator plan triggers.
 *
 * Data is persisted in db.data.schedules (LowDB). Timers are restored
 * on init() so schedules survive server restarts.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { getDB } from './db.js';
import { exec, execSync } from 'child_process';
import { activityFeed } from './activityFeed.js';
import { testGate } from './testGate.js';

/** Minimum allowed interval to prevent abuse (1 minute) */
const MIN_INTERVAL_MS = 60_000;

/** Default timeout for shell command execution (30 seconds) */
const DEFAULT_EXEC_TIMEOUT_MS = 30_000;

/** Maximum output length stored in lastResult to avoid bloating the DB */
const MAX_OUTPUT_LENGTH = 10_000;

/** Valid schedule types */
const VALID_TYPES = new Set(['command', 'test', 'plan', 'webhook']);

/**
 * @typedef {Object} ScheduleLastResult
 * @property {boolean} success - Whether the last run succeeded
 * @property {string} output - Captured stdout/stderr (truncated)
 * @property {number} duration - Execution duration in milliseconds
 */

/**
 * @typedef {Object} Schedule
 * @property {string} id - UUID v4
 * @property {string} projectId - Associated project ID
 * @property {string} name - Human-readable name
 * @property {'command'|'test'|'plan'} type - Task type
 * @property {string|null} command - Shell command (for type='command')
 * @property {string|null} testCommand - Override test command (for type='test')
 * @property {Array|null} planSteps - Plan steps to execute (for type='plan')
 * @property {string|null} projectPath - Working directory for commands
 * @property {number} intervalMs - Interval in milliseconds (minimum 60000)
 * @property {boolean} enabled - Whether the schedule is active
 * @property {boolean} notifyOnFailure - Log activity on failure
 * @property {boolean} notifyOnSuccess - Log activity on success
 * @property {string|null} lastRunAt - ISO 8601 timestamp of last run
 * @property {ScheduleLastResult|null} lastResult - Result of last run
 * @property {number} runCount - Total number of runs
 * @property {number} failCount - Total number of failed runs
 * @property {string} createdAt - ISO 8601 creation timestamp
 * @property {string} updatedAt - ISO 8601 last-updated timestamp
 */

/**
 * Cron-like scheduler that runs tasks on configurable intervals.
 *
 * Emits:
 * - `'task-complete'` with `{ scheduleId, schedule, result }` after each execution
 * - `'plan-trigger'` with `{ scheduleId, schedule, planSteps }` for type='plan'
 *
 * @extends EventEmitter
 */
class Scheduler extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, ReturnType<typeof setInterval>>} scheduleId -> intervalId */
    this.timers = new Map();
    /** @type {Map<string, boolean>} scheduleId -> currently executing */
    this.running = new Map();
  }

  /**
   * Initialize the scheduler by loading saved schedules from the database
   * and starting timers for all enabled schedules.
   * Must be called after initDB().
   * @returns {Promise<void>}
   */
  async init() {
    const db = getDB();

    // Ensure schedules collection exists
    if (!db.data.schedules) {
      db.data.schedules = [];
      await db.write();
    }

    // Start timers for all enabled schedules
    const enabledSchedules = db.data.schedules.filter((s) => s.enabled);
    for (const schedule of enabledSchedules) {
      this._startTimer(schedule);
    }

    console.log(
      `[Scheduler] Initialized with ${enabledSchedules.length} active schedule(s) out of ${db.data.schedules.length} total`,
    );
  }

  /**
   * Create a new scheduled task.
   *
   * @param {Object} params
   * @param {string} params.projectId - Associated project ID
   * @param {string} params.name - Human-readable name
   * @param {'command'|'test'|'plan'} params.type - Task type
   * @param {string} [params.command] - Shell command (for type='command')
   * @param {string} [params.testCommand] - Override test command (for type='test')
   * @param {Array} [params.planSteps] - Plan steps (for type='plan')
   * @param {string} [params.projectPath] - Working directory
   * @param {number} params.intervalMs - Interval in milliseconds (minimum 60000)
   * @param {boolean} [params.enabled=true] - Whether the schedule starts enabled
   * @param {boolean} [params.notifyOnFailure=true] - Log activity on failure
   * @param {boolean} [params.notifyOnSuccess=false] - Log activity on success
   * @returns {Promise<Schedule>} The created schedule
   * @throws {Error} If validation fails
   */
  async create(params) {
    const {
      projectId,
      name,
      type,
      command = null,
      testCommand = null,
      planSteps = null,
      projectPath = null,
      intervalMs,
      enabled = true,
      notifyOnFailure = true,
      notifyOnSuccess = false,
    } = params;

    // Validation
    if (!projectId) {
      throw new Error('projectId is required');
    }
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('name is required and must be a non-empty string');
    }
    if (!VALID_TYPES.has(type)) {
      throw new Error(`type must be one of: ${[...VALID_TYPES].join(', ')}`);
    }
    if (typeof intervalMs !== 'number' || intervalMs < MIN_INTERVAL_MS) {
      throw new Error(`intervalMs must be a number >= ${MIN_INTERVAL_MS}`);
    }
    if (type === 'command' && (!command || typeof command !== 'string')) {
      throw new Error('command is required for type="command"');
    }

    const now = new Date().toISOString();

    /** @type {Schedule} */
    const schedule = {
      id: uuidv4(),
      projectId,
      name: name.trim(),
      type,
      command: type === 'command' ? command : null,
      testCommand: type === 'test' ? (testCommand || null) : null,
      planSteps: type === 'plan' ? (planSteps || null) : null,
      projectPath: projectPath || null,
      intervalMs,
      enabled,
      notifyOnFailure,
      notifyOnSuccess,
      lastRunAt: null,
      lastResult: null,
      runCount: 0,
      failCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    const db = getDB();
    if (!db.data.schedules) {
      db.data.schedules = [];
    }
    db.data.schedules.push(schedule);
    await db.write();

    // Start the timer if enabled
    if (schedule.enabled) {
      this._startTimer(schedule);
    }

    console.log(`[Scheduler] Created schedule "${schedule.name}" (${schedule.id}), interval=${schedule.intervalMs}ms`);
    return schedule;
  }

  /**
   * Update an existing schedule.
   *
   * @param {string} scheduleId - The schedule ID to update
   * @param {Partial<Schedule>} updates - Fields to update
   * @returns {Promise<Schedule>} The updated schedule
   * @throws {Error} If the schedule is not found or validation fails
   */
  async update(scheduleId, updates) {
    const db = getDB();
    const schedule = (db.data.schedules || []).find((s) => s.id === scheduleId);

    if (!schedule) {
      throw new Error(`Schedule not found: ${scheduleId}`);
    }

    // Validate updates
    if (updates.type !== undefined && !VALID_TYPES.has(updates.type)) {
      throw new Error(`type must be one of: ${[...VALID_TYPES].join(', ')}`);
    }
    if (updates.intervalMs !== undefined) {
      if (typeof updates.intervalMs !== 'number' || updates.intervalMs < MIN_INTERVAL_MS) {
        throw new Error(`intervalMs must be a number >= ${MIN_INTERVAL_MS}`);
      }
    }
    if (updates.name !== undefined) {
      if (typeof updates.name !== 'string' || updates.name.trim().length === 0) {
        throw new Error('name must be a non-empty string');
      }
      updates.name = updates.name.trim();
    }

    // Prevent updating immutable fields
    const immutableFields = ['id', 'createdAt'];
    for (const field of immutableFields) {
      delete updates[field];
    }

    // Determine if we need to restart the timer
    const needsTimerRestart =
      updates.intervalMs !== undefined ||
      updates.enabled !== undefined;

    // Apply updates
    Object.assign(schedule, updates, { updatedAt: new Date().toISOString() });
    await db.write();

    // Restart timer if interval or enabled status changed
    if (needsTimerRestart) {
      this._stopTimer(scheduleId);
      if (schedule.enabled) {
        this._startTimer(schedule);
      }
    }

    console.log(`[Scheduler] Updated schedule "${schedule.name}" (${scheduleId})`);
    return schedule;
  }

  /**
   * Delete a schedule and stop its timer.
   *
   * @param {string} scheduleId - The schedule ID to delete
   * @returns {Promise<boolean>} True if the schedule was deleted
   * @throws {Error} If the schedule is not found
   */
  async remove(scheduleId) {
    const db = getDB();
    const index = (db.data.schedules || []).findIndex((s) => s.id === scheduleId);

    if (index === -1) {
      throw new Error(`Schedule not found: ${scheduleId}`);
    }

    const schedule = db.data.schedules[index];

    // Stop the timer
    this._stopTimer(scheduleId);

    // Remove from database
    db.data.schedules.splice(index, 1);
    await db.write();

    console.log(`[Scheduler] Deleted schedule "${schedule.name}" (${scheduleId})`);
    return true;
  }

  /**
   * Enable or disable a schedule.
   *
   * @param {string} scheduleId - The schedule ID to toggle
   * @param {boolean} enabled - Whether the schedule should be enabled
   * @returns {Promise<Schedule>} The updated schedule
   * @throws {Error} If the schedule is not found
   */
  async toggle(scheduleId, enabled) {
    const db = getDB();
    const schedule = (db.data.schedules || []).find((s) => s.id === scheduleId);

    if (!schedule) {
      throw new Error(`Schedule not found: ${scheduleId}`);
    }

    schedule.enabled = Boolean(enabled);
    schedule.updatedAt = new Date().toISOString();
    await db.write();

    // Start or stop the timer
    this._stopTimer(scheduleId);
    if (schedule.enabled) {
      this._startTimer(schedule);
    }

    console.log(`[Scheduler] Schedule "${schedule.name}" (${scheduleId}) ${schedule.enabled ? 'enabled' : 'disabled'}`);
    return schedule;
  }

  /**
   * Get all schedules, optionally filtered by project.
   *
   * @param {string|null} [projectId=null] - Filter by project ID, or null for all
   * @returns {Schedule[]} Array of schedules
   */
  getAll(projectId = null) {
    const db = getDB();
    const schedules = db.data.schedules || [];

    if (projectId) {
      return schedules.filter((s) => s.projectId === projectId);
    }

    return [...schedules];
  }

  /**
   * Get a single schedule by ID.
   *
   * @param {string} scheduleId - The schedule ID
   * @returns {Schedule|null} The schedule, or null if not found
   */
  get(scheduleId) {
    const db = getDB();
    return (db.data.schedules || []).find((s) => s.id === scheduleId) || null;
  }

  /**
   * Manually trigger a schedule to run immediately, regardless of its timer.
   *
   * @param {string} scheduleId - The schedule ID to trigger
   * @returns {Promise<ScheduleLastResult>} The execution result
   * @throws {Error} If the schedule is not found
   */
  async triggerNow(scheduleId) {
    const db = getDB();
    const schedule = (db.data.schedules || []).find((s) => s.id === scheduleId);

    if (!schedule) {
      throw new Error(`Schedule not found: ${scheduleId}`);
    }

    console.log(`[Scheduler] Manually triggering schedule "${schedule.name}" (${scheduleId})`);
    return this._execute(schedule);
  }

  /**
   * Execute a scheduled task.
   * Handles all three task types: command, test, and plan.
   * Updates run statistics and logs to the activity feed.
   *
   * @param {Schedule} schedule - The schedule to execute
   * @returns {Promise<ScheduleLastResult>} The execution result
   * @private
   */
  async _execute(schedule) {
    const startTime = Date.now();
    this.running.set(schedule.id, true);

    /** @type {ScheduleLastResult} */
    let result;

    try {
      // If a CLI tool is specified, use it instead of raw command execution
      if (schedule.cliTool && schedule.cliTool !== 'shell') {
        result = await this._executeCliTool(schedule);
      } else {
        switch (schedule.type) {
          case 'command':
            result = await this._executeCommand(schedule);
            break;

          case 'test':
            result = await this._executeTest(schedule);
            break;

          case 'plan':
            result = await this._executePlan(schedule);
            break;

          case 'webhook':
            result = await this._executeWebhook(schedule);
            break;

          default:
            result = {
              success: false,
              output: `Unknown schedule type: ${schedule.type}`,
              duration: Date.now() - startTime,
            };
        }
      }
    } catch (err) {
      result = {
        success: false,
        output: `Unexpected error: ${err.message}`,
        duration: Date.now() - startTime,
      };
    } finally {
      this.running.set(schedule.id, false);
    }

    // Update schedule statistics in the database
    const db = getDB();
    const stored = (db.data.schedules || []).find((s) => s.id === schedule.id);
    if (stored) {
      stored.lastRunAt = new Date().toISOString();
      stored.lastResult = result;
      stored.runCount = (stored.runCount || 0) + 1;
      if (!result.success) {
        stored.failCount = (stored.failCount || 0) + 1;
      }
      stored.updatedAt = new Date().toISOString();
      await db.write();
    }

    // Log to activity feed
    const shouldNotify =
      (result.success && schedule.notifyOnSuccess) ||
      (!result.success && schedule.notifyOnFailure);

    if (shouldNotify) {
      activityFeed.log({
        projectId: schedule.projectId,
        type: result.success ? 'step-completed' : 'step-failed',
        title: `Scheduled task "${schedule.name}" ${result.success ? 'completed' : 'failed'}`,
        detail: result.output.slice(0, 500),
        duration: result.duration,
        metadata: {
          scheduleId: schedule.id,
          scheduleType: schedule.type,
          success: result.success,
        },
      });
    }

    // Emit task-complete event for external listeners
    this.emit('task-complete', {
      scheduleId: schedule.id,
      schedule,
      result,
    });

    return result;
  }

  /**
   * Execute a shell command task.
   *
   * @param {Schedule} schedule - The schedule containing the command
   * @returns {Promise<ScheduleLastResult>}
   * @private
   */
  _executeCommand(schedule) {
    return new Promise((resolve) => {
      const startTime = Date.now();

      // Determine if this runs inside a container
      const containerName = this._getContainerName(schedule.projectId);
      let command = schedule.command;

      if (containerName) {
        // Wrap command to run inside the container
        const workDir = schedule.projectPath || '/workspace';
        const escaped = command.replace(/"/g, '\\"');
        command = `docker exec -w "${workDir}" ${containerName} bash -c "${escaped}"`;
      }

      const execOptions = {
        cwd: containerName ? undefined : (schedule.projectPath || undefined),
        timeout: DEFAULT_EXEC_TIMEOUT_MS,
        encoding: 'utf-8',
        maxBuffer: 5 * 1024 * 1024,
        env: { ...process.env },
      };

      exec(command, execOptions, (error, stdout, stderr) => {
        const duration = Date.now() - startTime;
        const output = this._combineOutput(stdout, stderr);
        const truncated = output.length > MAX_OUTPUT_LENGTH
          ? output.slice(0, MAX_OUTPUT_LENGTH) + '\n... (output truncated)'
          : output;

        if (error) {
          resolve({
            success: false,
            output: truncated || `Command failed: ${error.message}`,
            duration,
          });
        } else {
          resolve({
            success: true,
            output: truncated,
            duration,
          });
        }
      });
    });
  }

  /**
   * Execute a command using a CLI tool (claude, copilot, etc.)
   * Uses claude -p / copilot -p in non-interactive mode inside the container.
   *
   * @param {Schedule} schedule - The schedule containing the prompt and tool config
   * @returns {Promise<ScheduleLastResult>}
   * @private
   */
  async _executeCliTool(schedule) {
    const startTime = Date.now();
    const tool = schedule.cliTool || 'claude';
    const containerName = this._getContainerName(schedule.projectId);
    const workDir = schedule.projectPath || '/workspace';

    // Build the CLI command
    const escaped = schedule.command.replace(/"/g, '\\"');
    let command;

    switch (tool) {
      case 'claude':
        command = `claude -p "${escaped}"`;
        break;
      case 'copilot':
        command = `copilot -p "${escaped}"`;
        break;
      case 'aider':
        command = `aider --message "${escaped}" --yes`;
        break;
      default:
        command = schedule.command;
    }

    // Wrap in docker exec if container-based
    if (containerName) {
      command = `docker exec -w "${workDir}" ${containerName} bash -c '${command.replace(/'/g, "'\\''")}'`;
    }

    return new Promise((resolve) => {
      exec(command, {
        cwd: containerName ? undefined : (schedule.projectPath || undefined),
        timeout: 120000, // 2 min timeout for AI tools
        encoding: 'utf-8',
        maxBuffer: 5 * 1024 * 1024,
        env: { ...process.env },
      }, (error, stdout, stderr) => {
        const duration = Date.now() - startTime;
        const output = (stdout || '') + (stderr || '');
        const truncated = output.length > 10000 ? output.slice(0, 10000) + '\n...(truncated)' : output;

        resolve({
          success: !error,
          output: truncated || (error ? error.message : 'No output'),
          duration,
        });
      });
    });
  }

  /**
   * Look up the container name for a project (if it's container-based)
   * @private
   */
  _getContainerName(projectId) {
    if (!projectId) return null;
    try {
      const db = getDB();
      const project = (db.data.projects || []).find(p => p.id === projectId);
      return project?.containerName || null;
    } catch { return null; }
  }

  /**
   * Execute a test task using the testGate.
   *
   * @param {Schedule} schedule - The schedule containing test configuration
   * @returns {Promise<ScheduleLastResult>}
   * @private
   */
  async _executeTest(schedule) {
    const projectPath = schedule.projectPath;
    if (!projectPath) {
      return {
        success: false,
        output: 'projectPath is required for test schedules',
        duration: 0,
      };
    }

    const startTime = Date.now();
    const containerName = this._getContainerName(schedule.projectId);

    try {
      if (containerName) {
        // Run tests inside the container
        const testCmd = schedule.testCommand || 'npm test';
        const workDir = projectPath || '/workspace';
        const escaped = testCmd.replace(/"/g, '\\"');
        const result = await new Promise((resolve) => {
          exec(
            `docker exec -w "${workDir}" ${containerName} bash -c "${escaped}"`,
            { encoding: 'utf-8', timeout: 120000, maxBuffer: 5 * 1024 * 1024 },
            (error, stdout, stderr) => {
              const output = this._combineOutput(stdout, stderr);
              resolve({
                success: !error,
                output: output.slice(0, MAX_OUTPUT_LENGTH),
                duration: Date.now() - startTime,
              });
            },
          );
        });
        return result;
      }

      const testResult = await testGate.runTests(projectPath, {
        testCommand: schedule.testCommand || undefined,
      });

      return {
        success: testResult.passed,
        output: testResult.output
          ? testResult.output.slice(0, MAX_OUTPUT_LENGTH)
          : testResult.summary,
        duration: Date.now() - startTime,
      };
    } catch (err) {
      return {
        success: false,
        output: `Test execution error: ${err.message}`,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute a plan task by emitting a plan-trigger event.
   * The orchestrator route handler can listen for this event to start execution.
   *
   * @param {Schedule} schedule - The schedule containing plan steps
   * @returns {Promise<ScheduleLastResult>}
   * @private
   */
  async _executePlan(schedule) {
    const startTime = Date.now();

    if (!schedule.planSteps || schedule.planSteps.length === 0) {
      return {
        success: false,
        output: 'No plan steps configured for this schedule',
        duration: Date.now() - startTime,
      };
    }

    // Emit plan-trigger event for the orchestrator to pick up
    this.emit('plan-trigger', {
      scheduleId: schedule.id,
      schedule,
      planSteps: schedule.planSteps,
    });

    return {
      success: true,
      output: `Plan trigger emitted with ${schedule.planSteps.length} step(s)`,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Execute a webhook / HTTP notification.
   * @param {Schedule} schedule - Must have schedule.webhookUrl and optionally schedule.webhookMethod, schedule.webhookBody
   * @returns {Promise<ScheduleLastResult>}
   * @private
   */
  async _executeWebhook(schedule) {
    const startTime = Date.now();
    const url = schedule.webhookUrl;
    if (!url) {
      return { success: false, output: 'webhookUrl is required', duration: 0 };
    }

    try {
      const method = (schedule.webhookMethod || 'POST').toUpperCase();
      const headers = { 'Content-Type': 'application/json' };
      const fetchOpts = { method, headers, signal: AbortSignal.timeout(15000) };

      if (method !== 'GET' && schedule.webhookBody) {
        fetchOpts.body = typeof schedule.webhookBody === 'string'
          ? schedule.webhookBody
          : JSON.stringify(schedule.webhookBody);
      }

      const res = await fetch(url, fetchOpts);
      const body = await res.text().catch(() => '');
      const truncated = body.length > MAX_OUTPUT_LENGTH
        ? body.slice(0, MAX_OUTPUT_LENGTH) + '\n...'
        : body;

      return {
        success: res.ok,
        output: `${res.status} ${res.statusText}\n${truncated}`,
        duration: Date.now() - startTime,
      };
    } catch (err) {
      return {
        success: false,
        output: `Webhook failed: ${err.message}`,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Start the interval timer for a schedule.
   * Guards against overlapping execution — if a previous run is still in
   * progress when the timer fires, the tick is silently skipped.
   *
   * @param {Schedule} schedule - The schedule to start
   * @private
   */
  _startTimer(schedule) {
    // Stop any existing timer for this schedule
    this._stopTimer(schedule.id);

    const intervalId = setInterval(async () => {
      // Skip if already running (prevent overlapping executions)
      if (this.running.get(schedule.id)) {
        console.log(`[Scheduler] Skipping "${schedule.name}" — previous run still in progress`);
        return;
      }

      try {
        // Re-read schedule from DB in case it was updated
        const db = getDB();
        const current = (db.data.schedules || []).find((s) => s.id === schedule.id);
        if (!current || !current.enabled) {
          this._stopTimer(schedule.id);
          return;
        }

        await this._execute(current);
      } catch (err) {
        console.error(`[Scheduler] Error executing "${schedule.name}":`, err);
      }
    }, schedule.intervalMs);

    this.timers.set(schedule.id, intervalId);
  }

  /**
   * Stop the timer for a schedule.
   *
   * @param {string} scheduleId - The schedule ID whose timer to stop
   * @private
   */
  _stopTimer(scheduleId) {
    const intervalId = this.timers.get(scheduleId);
    if (intervalId) {
      clearInterval(intervalId);
      this.timers.delete(scheduleId);
    }
  }

  /**
   * Stop all active timers. Call during server shutdown to clean up.
   */
  cleanup() {
    for (const [scheduleId, intervalId] of this.timers) {
      clearInterval(intervalId);
    }
    this.timers.clear();
    this.running.clear();
    console.log('[Scheduler] All timers stopped');
  }

  /**
   * Combine stdout and stderr into a single output string.
   *
   * @param {string} stdout - Standard output
   * @param {string} stderr - Standard error
   * @returns {string} Combined output
   * @private
   */
  _combineOutput(stdout, stderr) {
    const parts = [];
    if (stdout) parts.push(stdout);
    if (stderr) parts.push(stderr);
    return parts.join('\n').trim();
  }
}

export const scheduler = new Scheduler();
export default scheduler;
