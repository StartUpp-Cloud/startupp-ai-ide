/**
 * Completion Detection Engine
 *
 * Monitors terminal (PTY) output from CLI tools and determines when a step
 * has finished executing. Uses a multi-signal approach:
 *
 *   1. Idle timeout   - No meaningful output for N seconds
 *   2. Prompt pattern - The CLI tool's prompt has reappeared
 *   3. Error pattern  - Stack traces, "Error:", "FAILED", etc.
 *   4. Success pattern - "Done", "Successfully", "All tests passed", etc.
 *
 * @module completionDetector
 */

import { EventEmitter } from 'events';
import { stripAnsi } from './conversationParser.js';

// ---------------------------------------------------------------------------
// Per-CLI tool configurations
// ---------------------------------------------------------------------------

/** @type {Record<string, CliConfig>} */
const CLI_CONFIGS = {
  claude: {
    idleTimeoutMs: 20_000,
    promptPatterns: [/^> /m, /^❯ /m, /^\s*\$ /m],
    errorPatterns: [
      /Error:/i,
      /FAILED/i,
      /fatal:/i,
      /panic:/i,
      /Traceback/i,
      /SyntaxError/i,
      /TypeError/i,
      /ReferenceError/i,
    ],
    successPatterns: [/✓|✔|Done|Successfully|Complete|All tests passed/i],
    ignorePatterns: [
      /⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/,
      /\.{3,}/,
      /Thinking|Processing|Analyzing/i,
    ],
  },

  aider: {
    idleTimeoutMs: 15_000,
    promptPatterns: [/^aider>\s*/m, /^>\s*/m],
    errorPatterns: [
      /Error:/i,
      /FAILED/i,
      /fatal:/i,
      /Traceback/i,
      /SyntaxError/i,
    ],
    successPatterns: [/✓|✔|Done|Applied|Complete|All tests passed/i],
    ignorePatterns: [
      /⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/,
      /\.{3,}/,
      /Thinking|Processing/i,
    ],
  },

  copilot: {
    idleTimeoutMs: 15_000,
    promptPatterns: [/^>\s*/m, /^❯\s*/m],
    errorPatterns: [
      /Error:/i,
      /FAILED/i,
      /fatal:/i,
      /Exception/i,
      /Traceback/i,
    ],
    successPatterns: [/✓|✔|Done|Successfully|Complete/i],
    ignorePatterns: [
      /⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/,
      /\.{3,}/,
      /Thinking|Processing/i,
    ],
  },

  shell: {
    idleTimeoutMs: 5_000,
    promptPatterns: [/\$\s*$/, />\s*$/, /#\s*$/],
    errorPatterns: [
      /Error:/i,
      /FAILED/i,
      /fatal:/i,
      /command not found/i,
      /No such file or directory/i,
      /Permission denied/i,
    ],
    successPatterns: [/Done|Successfully|Complete|OK/i],
    ignorePatterns: [],
  },

  generic: {
    idleTimeoutMs: 10_000,
    promptPatterns: [/^>\s*/m, /^❯\s*/m, /\$\s*$/, /#\s*$/],
    errorPatterns: [
      /Error:/i,
      /FAILED/i,
      /fatal:/i,
      /panic:/i,
      /Traceback/i,
      /Exception/i,
    ],
    successPatterns: [/✓|✔|Done|Successfully|Complete|All tests passed/i],
    ignorePatterns: [
      /⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/,
      /\.{3,}/,
    ],
  },
};

// ---------------------------------------------------------------------------
// Completion reasons (emitted in the `complete` event payload)
// ---------------------------------------------------------------------------

/** @enum {string} */
const CompletionReason = {
  IDLE_TIMEOUT: 'idle-timeout',
  PROMPT_DETECTED: 'prompt-detected',
  EXIT: 'exit',
  SUCCESS_PATTERN: 'success-pattern',
};

// ---------------------------------------------------------------------------
// CompletionDetector
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CliConfig
 * @property {number}   idleTimeoutMs  - Milliseconds of silence before completion fires
 * @property {RegExp[]} promptPatterns - Patterns that indicate the CLI prompt has returned
 * @property {RegExp[]} errorPatterns  - Patterns that indicate an error occurred
 * @property {RegExp[]} successPatterns - Patterns that indicate a successful completion
 * @property {RegExp[]} ignorePatterns - Patterns for output that should not reset the idle timer
 */

/**
 * @typedef {Object} CompletionEvent
 * @property {boolean} success  - Whether the step completed without detected errors
 * @property {string}  output   - Accumulated output since last reset
 * @property {number}  duration - Elapsed milliseconds since the step started
 * @property {string}  reason   - Why completion was triggered (see CompletionReason)
 */

/**
 * Watches terminal output and emits `complete` when a CLI step finishes.
 *
 * @fires CompletionDetector#complete
 * @fires CompletionDetector#error-detected
 * @fires CompletionDetector#progress
 */
class CompletionDetector extends EventEmitter {
  /**
   * @param {string} [cliTool='generic'] - Key into CLI_CONFIGS (e.g. 'claude', 'aider', 'shell')
   */
  constructor(cliTool = 'generic') {
    super();

    /** @type {CliConfig} */
    this._config = CLI_CONFIGS[cliTool] || CLI_CONFIGS.generic;

    /** @type {string} */
    this._cliTool = cliTool;

    /** Accumulated output since last reset @type {string} */
    this._buffer = '';

    /** Whether we have received any meaningful output yet @type {boolean} */
    this._hasReceivedOutput = false;

    /** Timestamp (ms) when the current step started @type {number} */
    this._startedAt = Date.now();

    /** Whether a `complete` event has already fired for this step @type {boolean} */
    this._completed = false;

    /** Handle for the idle debounce timer @type {ReturnType<typeof setTimeout>|null} */
    this._idleTimer = null;

    /** Handle for the periodic progress timer @type {ReturnType<typeof setInterval>|null} */
    this._progressTimer = null;

    /** Tracks detected errors for the current step @type {string[]} */
    this._detectedErrors = [];

    this._startProgressReporting();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Feed a chunk of terminal output into the detector.
   *
   * The data should already have ANSI escape codes stripped, but the method
   * will strip them again defensively.
   *
   * @param {string} data - Raw or cleaned terminal output chunk
   */
  feed(data) {
    if (this._completed) return;

    const clean = stripAnsi(data);
    if (!clean || clean.trim().length === 0) return;

    // Check if this output is purely spinner / progress noise
    if (this._isIgnoredOutput(clean)) return;

    // Mark that we have received real output
    this._hasReceivedOutput = true;

    // Accumulate
    this._buffer += clean;

    // --- Signal checks (order matters: most specific first) ---

    // 1. Error detection (non-terminal — we note it but keep waiting)
    this._checkErrors(clean);

    // 2. Success pattern detection
    if (this._checkSuccessPatterns(clean)) {
      this._emitComplete(true, CompletionReason.SUCCESS_PATTERN);
      return;
    }

    // 3. Prompt reappeared
    if (this._checkPromptPatterns(clean)) {
      const success = this._detectedErrors.length === 0;
      this._emitComplete(success, CompletionReason.PROMPT_DETECTED);
      return;
    }

    // 4. Reset idle timer (debounce)
    this._resetIdleTimer();
  }

  /**
   * Signal that the underlying process has exited.
   *
   * This immediately fires `complete` if it hasn't already.
   *
   * @param {number} [exitCode=0] - The process exit code
   */
  notifyExit(exitCode = 0) {
    if (this._completed) return;

    const success = exitCode === 0 && this._detectedErrors.length === 0;
    this._emitComplete(success, CompletionReason.EXIT);
  }

  /**
   * Reset internal state for the next step.
   *
   * Call this before sending a new command to the CLI tool.
   */
  reset() {
    this._clearIdleTimer();
    this._buffer = '';
    this._hasReceivedOutput = false;
    this._startedAt = Date.now();
    this._completed = false;
    this._detectedErrors = [];
  }

  /**
   * Return all accumulated output since the last `reset()`.
   *
   * @returns {string}
   */
  getOutput() {
    return this._buffer;
  }

  /**
   * Check whether any error patterns have been detected in the current step.
   *
   * @returns {boolean}
   */
  hasErrors() {
    return this._detectedErrors.length > 0;
  }

  /**
   * Return the list of matched error pattern strings for the current step.
   *
   * @returns {string[]}
   */
  getDetectedErrors() {
    return [...this._detectedErrors];
  }

  /**
   * Tear down all timers. Call when the detector is no longer needed.
   */
  destroy() {
    this._clearIdleTimer();
    this._clearProgressTimer();
    this.removeAllListeners();
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Determine if a chunk of output consists entirely of ignored patterns
   * (spinners, progress dots, etc.).
   *
   * @param {string} text - Cleaned terminal output
   * @returns {boolean}
   * @private
   */
  _isIgnoredOutput(text) {
    const { ignorePatterns } = this._config;
    if (ignorePatterns.length === 0) return false;

    // Strip the ignored content and see if anything meaningful remains
    let remaining = text;
    for (const pattern of ignorePatterns) {
      remaining = remaining.replace(new RegExp(pattern.source, pattern.flags + 'g'), '');
    }
    return remaining.trim().length === 0;
  }

  /**
   * Check the chunk for error patterns and emit `error-detected` if found.
   *
   * @param {string} text - Cleaned terminal output
   * @private
   */
  _checkErrors(text) {
    for (const pattern of this._config.errorPatterns) {
      if (pattern.test(text)) {
        const matched = pattern.toString();
        this._detectedErrors.push(matched);
        this.emit('error-detected', { pattern: matched, output: this._buffer });
      }
    }
  }

  /**
   * Check the chunk for success patterns.
   *
   * @param {string} text - Cleaned terminal output
   * @returns {boolean} True if a success pattern was matched
   * @private
   */
  _checkSuccessPatterns(text) {
    for (const pattern of this._config.successPatterns) {
      if (pattern.test(text)) return true;
    }
    return false;
  }

  /**
   * Check the chunk for prompt patterns that indicate the CLI is waiting
   * for input again.
   *
   * @param {string} text - Cleaned terminal output
   * @returns {boolean} True if a prompt pattern was matched
   * @private
   */
  _checkPromptPatterns(text) {
    for (const pattern of this._config.promptPatterns) {
      if (pattern.test(text)) return true;
    }
    return false;
  }

  /**
   * Emit the `complete` event and mark this step as done.
   *
   * @param {boolean} success
   * @param {string}  reason - One of CompletionReason values
   * @private
   */
  _emitComplete(success, reason) {
    if (this._completed) return;
    this._completed = true;

    this._clearIdleTimer();

    /** @type {CompletionEvent} */
    const event = {
      success,
      output: this._buffer,
      duration: Date.now() - this._startedAt,
      reason,
    };

    this.emit('complete', event);
  }

  /**
   * Reset (debounce) the idle timer. Fires completion when the CLI has been
   * silent for `idleTimeoutMs` after receiving at least some output.
   *
   * @private
   */
  _resetIdleTimer() {
    this._clearIdleTimer();

    // Only start the idle timer once we have received real output
    if (!this._hasReceivedOutput) return;

    this._idleTimer = setTimeout(() => {
      const success = this._detectedErrors.length === 0;
      this._emitComplete(success, CompletionReason.IDLE_TIMEOUT);
    }, this._config.idleTimeoutMs);
  }

  /**
   * Clear the idle timer if it is running.
   *
   * @private
   */
  _clearIdleTimer() {
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }

  /**
   * Start a periodic interval that emits `progress` events so callers can
   * display intermediate output while waiting for completion.
   *
   * Fires every 2 seconds while the detector is active.
   *
   * @private
   */
  _startProgressReporting() {
    this._progressTimer = setInterval(() => {
      if (this._completed || !this._hasReceivedOutput) return;
      this.emit('progress', { output: this._buffer });
    }, 2_000);
  }

  /**
   * Clear the progress reporting interval.
   *
   * @private
   */
  _clearProgressTimer() {
    if (this._progressTimer !== null) {
      clearInterval(this._progressTimer);
      this._progressTimer = null;
    }
  }
}

export { CompletionDetector, CLI_CONFIGS, CompletionReason };
export default CompletionDetector;
