/**
 * Safety System
 * Provides safety checks and guardrails for autonomous code execution.
 * Validates commands against dangerous patterns, enforces project scope,
 * monitors resource limits, and creates checkpoints before risky operations.
 */

import { getDB } from './db.js';
import { gitManager } from './gitManager.js';
import path from 'path';

// ---------------------------------------------------------------------------
// Risk levels (aligned with sessionContext.js RISK_LEVELS)
// ---------------------------------------------------------------------------

const RISK = {
  SAFE: 'safe',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

/** Ordered from most to least severe, used when aggregating risks. */
const RISK_ORDER = [RISK.CRITICAL, RISK.HIGH, RISK.MEDIUM, RISK.LOW, RISK.SAFE];

// ---------------------------------------------------------------------------
// Dangerous command / prompt patterns
// ---------------------------------------------------------------------------

const DANGEROUS_PATTERNS = [
  // Critical - always block or require explicit confirmation
  { pattern: /rm\s+-rf\s+[\/~]/, risk: RISK.CRITICAL, reason: 'Recursive delete from root/home' },
  { pattern: /curl.*\|\s*(ba)?sh/, risk: RISK.CRITICAL, reason: 'Remote code execution' },
  { pattern: /DROP\s+TABLE|DROP\s+DATABASE/i, risk: RISK.CRITICAL, reason: 'Database destruction' },
  { pattern: />(\/dev\/|\/etc\/)/, risk: RISK.CRITICAL, reason: 'System file write' },
  { pattern: /dd\s+if=/, risk: RISK.CRITICAL, reason: 'Direct device write' },
  { pattern: /chmod\s+777|chmod\s+-R\s+777/i, risk: RISK.CRITICAL, reason: 'Insecure permissions' },
  { pattern: /mkfs\.|format\s+[a-z]:/i, risk: RISK.CRITICAL, reason: 'Filesystem format' },

  // High - pause and ask for confirmation
  { pattern: /git\s+push\s+.*--force/, risk: RISK.HIGH, reason: 'Force push' },
  { pattern: /git\s+reset\s+--hard/, risk: RISK.HIGH, reason: 'Hard reset' },
  { pattern: /git\s+clean\s+-fd/, risk: RISK.HIGH, reason: 'Destructive git clean' },
  { pattern: /sudo\s+/, risk: RISK.HIGH, reason: 'Sudo operation' },
  { pattern: /npm\s+publish/, risk: RISK.HIGH, reason: 'Package publishing' },
  { pattern: /yarn\s+publish/, risk: RISK.HIGH, reason: 'Package publishing' },
  { pattern: /DELETE\s+FROM.*WHERE\s+1|TRUNCATE/i, risk: RISK.HIGH, reason: 'Destructive database operation' },
  { pattern: /password|secret|api[_-]?key|token|credential/i, risk: RISK.HIGH, reason: 'Potential credential exposure' },

  // Medium
  { pattern: /rm\s+(-r|--recursive)/i, risk: RISK.MEDIUM, reason: 'Recursive delete' },
  { pattern: /npm\s+install\s+(-g|--global)/i, risk: RISK.MEDIUM, reason: 'Global package install' },
  { pattern: /git\s+checkout\s+--?\s/i, risk: RISK.MEDIUM, reason: 'Discarding changes' },

  // Low
  { pattern: /npm\s+install|yarn\s+add|pnpm\s+add/i, risk: RISK.LOW, reason: 'Package installation' },
  { pattern: /git\s+commit|git\s+push(?!\s+.*--force)/i, risk: RISK.LOW, reason: 'Git commit/push' },
];

// Default safety settings (mirrors db.js defaultSafetySettings)
const DEFAULT_SETTINGS = {
  maxStepsPerPlan: 50,
  maxExecutionTime: 3600000, // 1 hour
  maxConcurrentExecutions: 1,
  scopeRestriction: 'project',
  autoCommitBeforeRiskyOps: true,
  blockCriticalRisk: true,
  pauseOnHighRisk: true,
  allowedPaths: [],
  blockedCommands: [],
};

class SafetySystem {
  /**
   * Get current safety settings from the database.
   * Falls back to sensible defaults if the DB has not been initialized yet.
   * @returns {object} The safety settings object.
   */
  getSettings() {
    const db = getDB();
    return { ...DEFAULT_SETTINGS, ...(db.data?.safetySettings || {}) };
  }

  /**
   * Update safety settings in the database.
   * Merges the provided updates with the existing settings.
   * @param {object} updates - Partial settings object to merge.
   * @returns {Promise<object>} The updated settings.
   */
  async updateSettings(updates) {
    const db = getDB();

    if (!db.data.safetySettings) {
      db.data.safetySettings = { ...DEFAULT_SETTINGS };
    }

    Object.assign(db.data.safetySettings, updates);
    await db.write();

    return this.getSettings();
  }

  /**
   * Check if a step prompt is safe to execute.
   * Runs the text through dangerous patterns and verifies that any file paths
   * referenced in the prompt stay within the project scope.
   * @param {string} promptText - The prompt or command text to check.
   * @param {string} projectPath - Absolute path to the project root.
   * @returns {{ safe: boolean, risk: 'safe'|'low'|'medium'|'high'|'critical', reasons: string[], requiresConfirmation: boolean }}
   *   Safety assessment result.
   */
  checkStepSafety(promptText, projectPath) {
    const settings = this.getSettings();
    const reasons = [];
    let highestRisk = RISK.SAFE;

    // Check against dangerous patterns
    for (const { pattern, risk, reason } of DANGEROUS_PATTERNS) {
      if (pattern.test(promptText)) {
        reasons.push(reason);
        if (RISK_ORDER.indexOf(risk) < RISK_ORDER.indexOf(highestRisk)) {
          highestRisk = risk;
        }
      }
    }

    // Check against user-configured blocked commands
    if (settings.blockedCommands && settings.blockedCommands.length > 0) {
      for (const blocked of settings.blockedCommands) {
        if (promptText.includes(blocked)) {
          reasons.push(`Blocked command: ${blocked}`);
          if (RISK_ORDER.indexOf(RISK.HIGH) < RISK_ORDER.indexOf(highestRisk)) {
            highestRisk = RISK.HIGH;
          }
        }
      }
    }

    // Check for out-of-scope file paths in the prompt
    if (projectPath) {
      const scopeViolations = this._detectOutOfScopePaths(promptText, projectPath);
      if (scopeViolations.length > 0) {
        reasons.push(`Out-of-scope paths: ${scopeViolations.join(', ')}`);
        if (RISK_ORDER.indexOf(RISK.HIGH) < RISK_ORDER.indexOf(highestRisk)) {
          highestRisk = RISK.HIGH;
        }
      }
    }

    const requiresConfirmation =
      highestRisk === RISK.CRITICAL || highestRisk === RISK.HIGH;
    const safe =
      highestRisk === RISK.SAFE ||
      highestRisk === RISK.LOW ||
      (highestRisk === RISK.MEDIUM && !settings.pauseOnHighRisk);

    return {
      safe: safe && !(highestRisk === RISK.CRITICAL && settings.blockCriticalRisk),
      risk: highestRisk,
      reasons,
      requiresConfirmation,
    };
  }

  /**
   * Check if terminal output contains dangerous patterns.
   * Useful for monitoring command output during autonomous execution.
   * @param {string} output - Terminal output text to check.
   * @returns {{ safe: boolean, risk: string, reasons: string[] }}
   *   Safety assessment of the output.
   */
  checkOutputSafety(output) {
    if (!output) {
      return { safe: true, risk: RISK.SAFE, reasons: [] };
    }

    const reasons = [];
    let highestRisk = RISK.SAFE;

    // Patterns that indicate dangerous output
    const outputPatterns = [
      { pattern: /permission denied/i, risk: RISK.MEDIUM, reason: 'Permission denied error' },
      { pattern: /segmentation fault/i, risk: RISK.HIGH, reason: 'Segmentation fault' },
      { pattern: /out of memory/i, risk: RISK.HIGH, reason: 'Out of memory' },
      { pattern: /disk full|no space left/i, risk: RISK.HIGH, reason: 'Disk space exhausted' },
      { pattern: /FATAL|PANIC/i, risk: RISK.HIGH, reason: 'Fatal error detected' },
      { pattern: /infinite loop|maximum call stack/i, risk: RISK.HIGH, reason: 'Possible infinite loop' },
      { pattern: /password|secret|api[_-]?key|private[_-]?key/i, risk: RISK.HIGH, reason: 'Potential credential leak in output' },
    ];

    for (const { pattern, risk, reason } of outputPatterns) {
      if (pattern.test(output)) {
        reasons.push(reason);
        if (RISK_ORDER.indexOf(risk) < RISK_ORDER.indexOf(highestRisk)) {
          highestRisk = risk;
        }
      }
    }

    return {
      safe: highestRisk === RISK.SAFE || highestRisk === RISK.LOW,
      risk: highestRisk,
      reasons,
    };
  }

  /**
   * Verify that all file changes are within the project scope.
   * Prevents autonomous operations from modifying files outside the project directory.
   * @param {string} projectPath - Absolute path to the project root.
   * @param {string[]} changedFiles - List of absolute file paths that were changed.
   * @returns {{ inScope: boolean, violations: string[] }}
   *   Scope enforcement result.
   */
  enforceScope(projectPath, changedFiles) {
    if (!projectPath || !changedFiles || changedFiles.length === 0) {
      return { inScope: true, violations: [] };
    }

    const normalizedProject = path.resolve(projectPath);
    const settings = this.getSettings();
    const violations = [];

    for (const filePath of changedFiles) {
      const normalizedFile = path.resolve(filePath);

      // Check if the file is within the project directory
      if (!normalizedFile.startsWith(normalizedProject + path.sep) && normalizedFile !== normalizedProject) {
        // Check if it's in any of the explicitly allowed paths
        const inAllowedPath = settings.allowedPaths.some((allowed) => {
          const normalizedAllowed = path.resolve(allowed);
          return (
            normalizedFile.startsWith(normalizedAllowed + path.sep) ||
            normalizedFile === normalizedAllowed
          );
        });

        if (!inAllowedPath) {
          violations.push(normalizedFile);
        }
      }
    }

    return {
      inScope: violations.length === 0,
      violations,
    };
  }

  /**
   * Check resource limits for an execution.
   * Compares current execution stats against the configured safety limits.
   * @param {object} execution - Execution state object.
   * @param {number} execution.stepsCompleted - Number of steps completed so far.
   * @param {number} execution.startedAt - Timestamp (ms) when execution started.
   * @param {number} [execution.concurrentCount] - Number of currently running executions.
   * @returns {{ withinLimits: boolean, violations: string[] }}
   *   Resource limit check result.
   */
  checkResourceLimits(execution) {
    const settings = this.getSettings();
    const violations = [];

    // Check step count limit
    if (execution.stepsCompleted >= settings.maxStepsPerPlan) {
      violations.push(
        `Step limit reached: ${execution.stepsCompleted}/${settings.maxStepsPerPlan} steps`,
      );
    }

    // Check execution time limit
    if (execution.startedAt) {
      const elapsed = Date.now() - execution.startedAt;
      if (elapsed >= settings.maxExecutionTime) {
        const elapsedMinutes = Math.round(elapsed / 60000);
        const limitMinutes = Math.round(settings.maxExecutionTime / 60000);
        violations.push(
          `Time limit reached: ${elapsedMinutes}min/${limitMinutes}min`,
        );
      }
    }

    // Check concurrent execution limit
    if (
      execution.concurrentCount !== undefined &&
      execution.concurrentCount > settings.maxConcurrentExecutions
    ) {
      violations.push(
        `Concurrent execution limit reached: ${execution.concurrentCount}/${settings.maxConcurrentExecutions}`,
      );
    }

    return {
      withinLimits: violations.length === 0,
      violations,
    };
  }

  /**
   * Create a safety checkpoint before risky operations.
   * Delegates to gitManager to create a tagged commit that can be rolled back to.
   * @param {string} projectPath - Absolute path to the project directory.
   * @param {string} label - Human-readable label for the checkpoint.
   * @returns {Promise<string|null>} The checkpoint tag name, or null on failure.
   */
  async createCheckpoint(projectPath, label) {
    const settings = this.getSettings();

    if (!settings.autoCommitBeforeRiskyOps) {
      return null;
    }

    return gitManager.createCheckpoint(projectPath, label);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Detect absolute file paths in prompt text that fall outside the project scope.
   * Looks for Unix-style absolute paths (/...) in the text.
   * @param {string} text - The prompt text to scan.
   * @param {string} projectPath - Absolute path to the project root.
   * @returns {string[]} List of out-of-scope paths found in the text.
   * @private
   */
  _detectOutOfScopePaths(text, projectPath) {
    const normalizedProject = path.resolve(projectPath);
    const violations = [];

    // Match absolute paths in the text (Unix-style)
    const pathMatches = text.match(/(?:^|\s)(\/[^\s:;'"`,]+)/g);
    if (!pathMatches) return violations;

    for (const match of pathMatches) {
      const detectedPath = match.trim();

      // Skip common non-path patterns
      if (this._isCommonSystemReference(detectedPath)) {
        continue;
      }

      // Check if the path is outside the project
      const normalizedDetected = path.resolve(detectedPath);
      if (
        !normalizedDetected.startsWith(normalizedProject + path.sep) &&
        normalizedDetected !== normalizedProject
      ) {
        violations.push(detectedPath);
      }
    }

    return violations;
  }

  /**
   * Check if a path-like string is a common system reference that should be ignored.
   * Examples: /dev/null, /tmp, /usr/bin, standard flags like /i or /g.
   * @param {string} pathStr - The path string to check.
   * @returns {boolean} True if this is a benign system reference.
   * @private
   */
  _isCommonSystemReference(pathStr) {
    const benignPatterns = [
      /^\/dev\/null$/,
      /^\/dev\/stdout$/,
      /^\/dev\/stderr$/,
      /^\/tmp\/?$/,
      /^\/[a-z]$/,         // Regex flags like /i, /g
    ];

    return benignPatterns.some((p) => p.test(pathStr));
  }
}

export const safetySystem = new SafetySystem();
export default safetySystem;
