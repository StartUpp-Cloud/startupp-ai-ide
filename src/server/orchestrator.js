/**
 * Orchestrator — Central brain of the autonomous IDE
 *
 * Drives plan execution by sending steps to the terminal and watching for
 * completion. Coordinates between the completion detector, git manager,
 * activity feed, and memory store to provide a fully autonomous workflow
 * with observability and rollback support.
 *
 * @module orchestrator
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { CompletionDetector } from './completionDetector.js';
import { gitManager } from './gitManager.js';
import { activityFeed } from './activityFeed.js';
import { memoryStore } from './memoryStore.js';
import { getDB } from './db.js';

/** @type {Object} Default execution configuration */
const DEFAULT_CONFIG = {
  autoCommit: true,
  runTests: false,
  testCommand: null,
  maxRetries: 1,
  gitStrategy: 'current-branch', // 'new-branch' | 'current-branch'
};

/**
 * @typedef {Object} ExecutionStep
 * @property {string}  title           - Human-readable step title
 * @property {string}  prompt          - The prompt/command to send to the CLI tool
 * @property {boolean} requiresApproval - Whether the step needs user approval before executing
 */

/**
 * @typedef {Object} ExecutionState
 * @property {string}              id               - Unique execution identifier
 * @property {string}              sessionId        - Terminal session to use
 * @property {string}              projectId        - Associated project
 * @property {string|null}         projectPath      - Filesystem path for git operations
 * @property {string}              planTitle        - Human-readable plan title
 * @property {ExecutionStep[]}     steps            - Ordered steps to execute
 * @property {number}              currentStepIndex - Index of the step currently executing
 * @property {'running'|'paused'|'waiting-approval'|'completed'|'failed'|'stopped'} status
 * @property {Object}              config           - Execution configuration
 * @property {string}              cliTool          - CLI tool name for completion detection
 * @property {Function}            writeFn          - Writes data to the PTY
 * @property {CompletionDetector}  detector         - Completion detector instance
 * @property {string}              startedAt        - ISO timestamp
 * @property {number}              retryCount       - Retries consumed for the current step
 * @property {string|null}         stepStartedAt    - ISO timestamp when current step began
 * @property {string|null}         initialCommit    - Commit hash before plan started (for rollback)
 */

class Orchestrator extends EventEmitter {
  constructor() {
    super();

    /** @type {Map<string, ExecutionState>} executionId -> execution state */
    this.executions = new Map();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Start autonomous execution of a plan.
   *
   * Creates the execution state, optionally creates a git branch and records
   * the initial commit for rollback, then begins executing the first step
   * (or waits for approval if the first step requires it).
   *
   * @param {Object} params
   * @param {string}   params.sessionId    - Terminal session to use
   * @param {string}   params.projectId
   * @param {string}   [params.projectPath] - For git operations
   * @param {Array}    params.steps         - Array of { title, prompt, requiresApproval }
   * @param {string}   [params.planTitle]
   * @param {string}   [params.cliTool]     - CLI tool running in terminal (for completion detection)
   * @param {Object}   [params.config]      - { autoCommit, runTests, testCommand, maxRetries }
   * @param {Function} params.writeFn       - Function to write to the PTY: (data) => void
   * @returns {string} executionId
   */
  start({ sessionId, projectId, projectPath, steps, planTitle, cliTool, config, writeFn }) {
    const executionId = uuidv4();
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    // Capture initial commit hash for potential rollback
    let initialCommit = null;
    if (projectPath && gitManager.isGitRepo(projectPath)) {
      const commits = gitManager.getRecentCommits(projectPath, 1);
      if (commits.length > 0) {
        initialCommit = commits[0].hash;
      }

      // Only create a new branch if gitStrategy says so
      if (mergedConfig.gitStrategy === 'new-branch') {
        const branch = gitManager.createBranch(projectPath, planTitle || 'autonomous-plan');
        if (branch) {
          activityFeed.log({
            projectId,
            executionId,
            sessionId,
            type: 'git-branch',
            title: `Created branch: ${branch}`,
            metadata: { branch, planTitle },
          });
        }
      } else {
        const currentBranch = gitManager.getCurrentBranch(projectPath);
        activityFeed.log({
          projectId,
          executionId,
          sessionId,
          type: 'git-branch',
          title: `Working on existing branch: ${currentBranch}`,
          metadata: { branch: currentBranch, planTitle },
        });
      }
    }

    const detector = new CompletionDetector(cliTool || 'generic');

    /** @type {ExecutionState} */
    const execution = {
      id: executionId,
      sessionId,
      projectId,
      projectPath: projectPath || null,
      planTitle: planTitle || 'Untitled Plan',
      steps: [...steps],
      currentStepIndex: 0,
      status: 'running',
      config: mergedConfig,
      cliTool: cliTool || 'generic',
      writeFn,
      detector,
      startedAt: new Date().toISOString(),
      retryCount: 0,
      stepStartedAt: null,
      initialCommit,
    };

    this.executions.set(executionId, execution);

    // Wire up the completion detector
    detector.on('complete', (result) => this._onStepComplete(execution, result));

    // Log the start of orchestration
    activityFeed.log({
      projectId,
      executionId,
      sessionId,
      type: 'orchestrator-started',
      title: `Started plan: ${execution.planTitle}`,
      metadata: { totalSteps: steps.length, config: mergedConfig },
    });

    this._emitStatusChange(execution);

    // Persist initial state
    this._persistExecution(execution);

    // Begin the first step
    const firstStep = execution.steps[0];
    if (firstStep && firstStep.requiresApproval) {
      execution.status = 'waiting-approval';
      this._emitStatusChange(execution);
      this.emit('waiting-approval', {
        executionId,
        stepIndex: 0,
        stepTitle: firstStep.title,
        stepPrompt: firstStep.prompt,
      });
    } else {
      this._sendCurrentStep(execution);
    }

    return executionId;
  }

  /**
   * Feed terminal output to the orchestrator for a session.
   *
   * Called by the terminal server when data arrives. Routes the data to the
   * appropriate execution's completion detector.
   *
   * @param {string} sessionId - The terminal session that produced the output
   * @param {string} data      - Raw terminal output
   */
  feedOutput(sessionId, data) {
    const execution = this._getExecutionBySession(sessionId);
    if (!execution) return;
    if (execution.status !== 'running') return;

    execution.detector.feed(data);
  }

  /**
   * Notify the orchestrator that a PTY process exited.
   *
   * @param {string} sessionId - The terminal session that exited
   * @param {number} exitCode  - Process exit code
   */
  notifyExit(sessionId, exitCode) {
    const execution = this._getExecutionBySession(sessionId);
    if (!execution) return;
    if (execution.status !== 'running') return;

    execution.detector.notifyExit(exitCode);
  }

  /**
   * Pause execution. Stops auto-advancing but does not kill the terminal.
   *
   * @param {string} executionId
   * @returns {boolean} True if the execution was paused
   */
  pause(executionId) {
    const execution = this.executions.get(executionId);
    if (!execution) return false;
    if (execution.status !== 'running' && execution.status !== 'waiting-approval') return false;

    execution.status = 'paused';
    this._emitStatusChange(execution);
    this._persistExecution(execution);

    activityFeed.log({
      projectId: execution.projectId,
      executionId,
      sessionId: execution.sessionId,
      type: 'orchestrator-paused',
      title: `Paused at step ${execution.currentStepIndex + 1}: ${this._currentStepTitle(execution)}`,
    });

    return true;
  }

  /**
   * Resume execution from where it was paused.
   *
   * @param {string} executionId
   * @returns {boolean} True if the execution was resumed
   */
  resume(executionId) {
    const execution = this.executions.get(executionId);
    if (!execution) return false;
    if (execution.status !== 'paused') return false;

    execution.status = 'running';
    this._emitStatusChange(execution);
    this._persistExecution(execution);

    // If the current step hasn't been sent yet (e.g. paused before sending), send it
    if (!execution.stepStartedAt) {
      this._sendCurrentStep(execution);
    }
    // Otherwise, the detector is still listening for the in-progress step

    return true;
  }

  /**
   * Stop execution completely.
   *
   * @param {string} executionId
   * @returns {boolean} True if the execution was stopped
   */
  stop(executionId) {
    const execution = this.executions.get(executionId);
    if (!execution) return false;
    if (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'stopped') {
      return false;
    }

    this._completeExecution(execution, 'stopped');
    return true;
  }

  /**
   * Approve a step that requires approval, then send it.
   *
   * @param {string} executionId
   * @returns {boolean} True if the step was approved and sent
   */
  approveStep(executionId) {
    const execution = this.executions.get(executionId);
    if (!execution) return false;
    if (execution.status !== 'waiting-approval') return false;

    execution.status = 'running';
    this._emitStatusChange(execution);
    this._sendCurrentStep(execution);

    return true;
  }

  /**
   * Skip the current step and move to the next one.
   *
   * @param {string} executionId
   * @returns {boolean} True if the step was skipped
   */
  skipStep(executionId) {
    const execution = this.executions.get(executionId);
    if (!execution) return false;
    if (execution.status !== 'running' && execution.status !== 'waiting-approval' && execution.status !== 'paused') {
      return false;
    }

    activityFeed.log({
      projectId: execution.projectId,
      executionId,
      sessionId: execution.sessionId,
      type: 'user-intervention',
      title: `Skipped step ${execution.currentStepIndex + 1}: ${this._currentStepTitle(execution)}`,
    });

    execution.status = 'running';
    this._advanceToNext(execution);

    return true;
  }

  /**
   * Get execution status.
   *
   * @param {string} executionId
   * @returns {Object|null} Status object or null if not found
   */
  getStatus(executionId) {
    const execution = this.executions.get(executionId);
    if (!execution) return null;

    return {
      id: execution.id,
      sessionId: execution.sessionId,
      projectId: execution.projectId,
      planTitle: execution.planTitle,
      status: execution.status,
      currentStepIndex: execution.currentStepIndex,
      totalSteps: execution.steps.length,
      currentStepTitle: this._currentStepTitle(execution),
      startedAt: execution.startedAt,
      stepStartedAt: execution.stepStartedAt,
      retryCount: execution.retryCount,
      config: execution.config,
    };
  }

  /**
   * Get all active executions (not completed, failed, or stopped).
   *
   * @returns {Array<Object>} Array of execution status objects
   */
  getActiveExecutions() {
    const active = [];
    for (const execution of this.executions.values()) {
      if (execution.status !== 'completed' && execution.status !== 'failed' && execution.status !== 'stopped') {
        active.push(this.getStatus(execution.id));
      }
    }
    return active;
  }

  /**
   * Check if a session has an active (running) orchestrator execution.
   *
   * @param {string} sessionId
   * @returns {boolean}
   */
  isSessionActive(sessionId) {
    return !!this._getExecutionBySession(sessionId);
  }

  /**
   * Get execution for a session (if any).
   *
   * @param {string} sessionId
   * @returns {Object|null} Execution status or null
   */
  getExecutionForSession(sessionId) {
    const execution = this._getExecutionBySession(sessionId);
    if (!execution) return null;
    return this.getStatus(execution.id);
  }

  // -------------------------------------------------------------------------
  // Internal methods
  // -------------------------------------------------------------------------

  /**
   * Send the current step's prompt to the terminal.
   *
   * Resets the completion detector, logs the activity, and writes the prompt
   * to the PTY via the provided write function.
   *
   * @param {ExecutionState} execution
   * @private
   */
  _sendCurrentStep(execution) {
    const step = execution.steps[execution.currentStepIndex];
    if (!step) {
      this._completeExecution(execution, 'completed');
      return;
    }

    // Reset detector state for the new step
    execution.detector.reset();
    execution.stepStartedAt = new Date().toISOString();

    // Log step start
    activityFeed.log({
      projectId: execution.projectId,
      executionId: execution.id,
      sessionId: execution.sessionId,
      type: 'step-started',
      title: `Step ${execution.currentStepIndex + 1}/${execution.steps.length}: ${step.title}`,
      metadata: {
        stepIndex: execution.currentStepIndex,
        prompt: step.prompt,
      },
    });

    // Write the prompt to the terminal, followed by a newline to execute it
    const prompt = step.prompt.endsWith('\n') ? step.prompt : step.prompt + '\n';
    execution.writeFn(prompt);
  }

  /**
   * Handle a step completion event from the detector.
   *
   * On success: logs activity, optionally commits with git, records success
   * in the memory store, then advances to the next step.
   * On failure: logs activity, records failure in memory, retries or pauses.
   *
   * @param {ExecutionState} execution
   * @param {import('./completionDetector.js').CompletionEvent} result
   * @private
   */
  _onStepComplete(execution, result) {
    // Guard against events arriving after execution was stopped/completed
    if (execution.status !== 'running') return;

    const step = execution.steps[execution.currentStepIndex];
    const stepDuration = execution.stepStartedAt
      ? Date.now() - new Date(execution.stepStartedAt).getTime()
      : result.duration;

    this.emit('step-complete', {
      executionId: execution.id,
      stepIndex: execution.currentStepIndex,
      success: result.success,
      output: result.output,
    });

    if (result.success) {
      this._handleStepSuccess(execution, result, step, stepDuration);
    } else {
      this._handleStepFailure(execution, result);
    }
  }

  /**
   * Process a successful step completion.
   *
   * @param {ExecutionState} execution
   * @param {import('./completionDetector.js').CompletionEvent} result
   * @param {ExecutionStep} step
   * @param {number} stepDuration
   * @private
   */
  _handleStepSuccess(execution, result, step, stepDuration) {
    // Log success
    activityFeed.log({
      projectId: execution.projectId,
      executionId: execution.id,
      sessionId: execution.sessionId,
      type: 'step-completed',
      title: `Completed step ${execution.currentStepIndex + 1}: ${step.title}`,
      duration: stepDuration,
      metadata: {
        stepIndex: execution.currentStepIndex,
        reason: result.reason,
        outputLength: result.output.length,
      },
    });

    // Auto-commit if configured and we have a project path
    if (execution.config.autoCommit && execution.projectPath) {
      const commitMessage = `auto: ${step.title} (step ${execution.currentStepIndex + 1}/${execution.steps.length})`;
      const commitResult = gitManager.commitStep(execution.projectPath, commitMessage);

      if (commitResult) {
        activityFeed.log({
          projectId: execution.projectId,
          executionId: execution.id,
          sessionId: execution.sessionId,
          type: 'git-commit',
          title: `Committed: ${commitResult.commitHash.substring(0, 7)}`,
          metadata: {
            commitHash: commitResult.commitHash,
            filesChanged: commitResult.filesChanged,
            insertions: commitResult.insertions,
            deletions: commitResult.deletions,
          },
        });
      }
    }

    // Record success in memory store (fire-and-forget)
    memoryStore.recordSuccess(execution.projectId, {
      stepDescription: step.title,
      approach: step.prompt.substring(0, 200),
    }).catch((err) => {
      console.error('[Orchestrator] Failed to record success in memory:', err.message);
    });

    // Reset retry count for the next step
    execution.retryCount = 0;

    // Advance to next step
    this._advanceToNext(execution);
  }

  /**
   * Handle a failed step. Retries up to maxRetries before pausing.
   *
   * @param {ExecutionState} execution
   * @param {import('./completionDetector.js').CompletionEvent} result
   * @private
   */
  _handleStepFailure(execution, result) {
    const step = execution.steps[execution.currentStepIndex];

    // Log failure
    activityFeed.log({
      projectId: execution.projectId,
      executionId: execution.id,
      sessionId: execution.sessionId,
      type: 'step-failed',
      title: `Failed step ${execution.currentStepIndex + 1}: ${step.title}`,
      detail: result.output.substring(result.output.length - 500),
      metadata: {
        stepIndex: execution.currentStepIndex,
        reason: result.reason,
        retryCount: execution.retryCount,
        maxRetries: execution.config.maxRetries,
      },
    });

    // Record failure in memory store (fire-and-forget)
    memoryStore.recordFailure(execution.projectId, {
      stepDescription: step.title,
      errorOutput: result.output.substring(result.output.length - 300),
    }).catch((err) => {
      console.error('[Orchestrator] Failed to record failure in memory:', err.message);
    });

    // Retry if we haven't exhausted attempts
    if (execution.retryCount < execution.config.maxRetries) {
      execution.retryCount++;

      activityFeed.log({
        projectId: execution.projectId,
        executionId: execution.id,
        sessionId: execution.sessionId,
        type: 'step-retried',
        title: `Retrying step ${execution.currentStepIndex + 1} (attempt ${execution.retryCount + 1})`,
        metadata: { stepIndex: execution.currentStepIndex, attempt: execution.retryCount + 1 },
      });

      this._sendCurrentStep(execution);
      return;
    }

    // Exhausted retries — pause for user intervention
    execution.status = 'paused';
    this._emitStatusChange(execution);
    this._persistExecution(execution);

    activityFeed.log({
      projectId: execution.projectId,
      executionId: execution.id,
      sessionId: execution.sessionId,
      type: 'orchestrator-paused',
      title: `Paused: step ${execution.currentStepIndex + 1} failed after ${execution.config.maxRetries + 1} attempt(s)`,
      detail: 'Waiting for user intervention. Resume, skip, or stop the execution.',
    });
  }

  /**
   * Advance to the next step in the plan.
   *
   * If there are no more steps, completes the execution.
   * If the next step requires approval, waits for it.
   * Otherwise, sends the next step immediately.
   *
   * @param {ExecutionState} execution
   * @private
   */
  _advanceToNext(execution) {
    execution.currentStepIndex++;
    execution.stepStartedAt = null;

    // All steps done?
    if (execution.currentStepIndex >= execution.steps.length) {
      this._completeExecution(execution, 'completed');
      return;
    }

    this._persistExecution(execution);
    this._emitStatusChange(execution);

    const nextStep = execution.steps[execution.currentStepIndex];
    if (nextStep.requiresApproval) {
      execution.status = 'waiting-approval';
      this._emitStatusChange(execution);
      this._persistExecution(execution);

      this.emit('waiting-approval', {
        executionId: execution.id,
        stepIndex: execution.currentStepIndex,
        stepTitle: nextStep.title,
        stepPrompt: nextStep.prompt,
      });
    } else {
      this._sendCurrentStep(execution);
    }
  }

  /**
   * Finalize an execution with a terminal status.
   *
   * Cleans up the completion detector, logs the final activity, records
   * learned knowledge, and emits the 'completed' event.
   *
   * @param {ExecutionState} execution
   * @param {'completed'|'failed'|'stopped'} status
   * @private
   */
  _completeExecution(execution, status) {
    execution.status = status;
    execution.detector.destroy();

    const stepsCompleted = status === 'completed'
      ? execution.steps.length
      : execution.currentStepIndex;

    // Log the final state
    activityFeed.log({
      projectId: execution.projectId,
      executionId: execution.id,
      sessionId: execution.sessionId,
      type: 'orchestrator-completed',
      title: `Plan ${status}: ${execution.planTitle}`,
      duration: Date.now() - new Date(execution.startedAt).getTime(),
      metadata: {
        status,
        stepsCompleted,
        totalSteps: execution.steps.length,
      },
    });

    // Record overall plan outcome in memory (fire-and-forget)
    if (status === 'completed') {
      memoryStore.learn(execution.projectId, {
        type: 'success',
        category: 'build',
        content: `Plan "${execution.planTitle}" completed all ${execution.steps.length} steps successfully`,
        source: 'step-success',
        tags: ['plan-complete'],
      }).catch((err) => {
        console.error('[Orchestrator] Failed to record plan completion in memory:', err.message);
      });
    }

    this._emitStatusChange(execution);
    this._persistExecution(execution);

    this.emit('completed', {
      executionId: execution.id,
      status,
      stepsCompleted,
    });
  }

  /**
   * Persist the current execution state to the database for recovery.
   *
   * Stores a serializable snapshot (without functions or event emitters)
   * so executions can be inspected even after server restarts.
   *
   * @param {ExecutionState} execution
   * @private
   */
  _persistExecution(execution) {
    try {
      const db = getDB();

      if (!db.data.executions) {
        db.data.executions = [];
      }

      const snapshot = {
        id: execution.id,
        sessionId: execution.sessionId,
        projectId: execution.projectId,
        projectPath: execution.projectPath,
        planTitle: execution.planTitle,
        steps: execution.steps,
        currentStepIndex: execution.currentStepIndex,
        status: execution.status,
        config: execution.config,
        cliTool: execution.cliTool,
        startedAt: execution.startedAt,
        retryCount: execution.retryCount,
        stepStartedAt: execution.stepStartedAt,
        initialCommit: execution.initialCommit,
        updatedAt: new Date().toISOString(),
      };

      const existingIndex = db.data.executions.findIndex((e) => e.id === execution.id);
      if (existingIndex >= 0) {
        db.data.executions[existingIndex] = snapshot;
      } else {
        db.data.executions.push(snapshot);
      }

      // Fire-and-forget write — we don't want persistence failures to block execution
      db.write().catch((err) => {
        console.error('[Orchestrator] Failed to persist execution:', err.message);
      });
    } catch (err) {
      console.error('[Orchestrator] Failed to persist execution:', err.message);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Emit a 'status-change' event with the current execution snapshot.
   *
   * @param {ExecutionState} execution
   * @private
   */
  _emitStatusChange(execution) {
    this.emit('status-change', {
      executionId: execution.id,
      status: execution.status,
      currentStepIndex: execution.currentStepIndex,
      stepTitle: this._currentStepTitle(execution),
    });
  }

  /**
   * Get the title of the current step, or a fallback if out of bounds.
   *
   * @param {ExecutionState} execution
   * @returns {string}
   * @private
   */
  _currentStepTitle(execution) {
    const step = execution.steps[execution.currentStepIndex];
    return step ? step.title : '(no step)';
  }

  /**
   * Look up an active execution by session ID.
   *
   * @param {string} sessionId
   * @returns {ExecutionState|undefined}
   * @private
   */
  _getExecutionBySession(sessionId) {
    for (const execution of this.executions.values()) {
      if (execution.sessionId === sessionId && execution.status !== 'completed' && execution.status !== 'failed' && execution.status !== 'stopped') {
        return execution;
      }
    }
    return undefined;
  }
}

export const orchestrator = new Orchestrator();
export default orchestrator;
