/**
 * Session Context Manager
 * Tracks conversation history, file context, and provides rollback capabilities
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getDB } from './db.js';

// Security risk levels
export const RISK_LEVELS = {
  SAFE: 'safe',           // Read operations, simple confirmations
  LOW: 'low',             // Write to existing files, create files
  MEDIUM: 'medium',       // Delete files, install packages
  HIGH: 'high',           // System commands, git force operations
  CRITICAL: 'critical',   // Destructive operations, credential access
};

// Dangerous command patterns
const DANGEROUS_PATTERNS = [
  // Critical - always require confirmation
  { pattern: /rm\s+-rf?\s+[\/~]|rmdir\s+[\/~]/i, level: RISK_LEVELS.CRITICAL, reason: 'Recursive delete from root or home' },
  { pattern: />\s*\/dev\/|dd\s+if=/i, level: RISK_LEVELS.CRITICAL, reason: 'Direct device write' },
  { pattern: /chmod\s+777|chmod\s+-R\s+777/i, level: RISK_LEVELS.CRITICAL, reason: 'Insecure permissions' },
  { pattern: /curl.*\|\s*(ba)?sh|wget.*\|\s*(ba)?sh/i, level: RISK_LEVELS.CRITICAL, reason: 'Remote code execution' },
  { pattern: /password|secret|api[_-]?key|token|credential/i, level: RISK_LEVELS.HIGH, reason: 'Potential credential exposure' },

  // High risk
  { pattern: /git\s+(push\s+--force|reset\s+--hard|clean\s+-fd)/i, level: RISK_LEVELS.HIGH, reason: 'Destructive git operation' },
  { pattern: /npm\s+publish|yarn\s+publish/i, level: RISK_LEVELS.HIGH, reason: 'Package publishing' },
  { pattern: /sudo\s+/i, level: RISK_LEVELS.HIGH, reason: 'Elevated privileges' },
  { pattern: /DROP\s+TABLE|DELETE\s+FROM.*WHERE\s+1|TRUNCATE/i, level: RISK_LEVELS.HIGH, reason: 'Destructive database operation' },

  // Medium risk
  { pattern: /rm\s+(-r|--recursive)/i, level: RISK_LEVELS.MEDIUM, reason: 'Recursive delete' },
  { pattern: /npm\s+install\s+(-g|--global)/i, level: RISK_LEVELS.MEDIUM, reason: 'Global package install' },
  { pattern: /git\s+checkout\s+--?\s/i, level: RISK_LEVELS.MEDIUM, reason: 'Discarding changes' },

  // Low risk
  { pattern: /npm\s+install|yarn\s+add|pnpm\s+add/i, level: RISK_LEVELS.LOW, reason: 'Package installation' },
  { pattern: /git\s+commit|git\s+push(?!\s+--force)/i, level: RISK_LEVELS.LOW, reason: 'Git commit/push' },
];

class SessionContext {
  constructor() {
    this.sessions = new Map(); // sessionId -> SessionData
    this.maxHistoryLength = 50; // Keep last 50 interactions per session
    this.maxFileContextSize = 10000; // Max chars for file context
  }

  /**
   * Initialize or get session data
   */
  getSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId,
        projectId: null,
        projectPath: null,
        cliTool: null,
        history: [],
        fileContext: null,
        claudeMd: null,
        promptRules: [],
        rollbackPoints: [],
        userPreferences: {},
        lastActivity: Date.now(),
        createdAt: Date.now(),
      });
    }
    return this.sessions.get(sessionId);
  }

  /**
   * Initialize session with project context
   */
  async initSession(sessionId, { projectId, projectPath, cliTool }) {
    const session = this.getSession(sessionId);
    session.projectId = projectId;
    session.projectPath = projectPath;
    session.cliTool = cliTool;
    session.lastActivity = Date.now();

    // Load project-specific context
    if (projectPath) {
      await this.loadProjectContext(session);
    }

    // Load prompt rules from database
    if (projectId) {
      await this.loadPromptRules(session, projectId);
    }

    return session;
  }

  /**
   * Load project context (claude.md, file tree, etc.)
   */
  async loadProjectContext(session) {
    const projectPath = session.projectPath;
    if (!projectPath || !fs.existsSync(projectPath)) return;

    // Load claude.md or CLAUDE.md
    const claudeMdPaths = [
      path.join(projectPath, 'claude.md'),
      path.join(projectPath, 'CLAUDE.md'),
      path.join(projectPath, '.claude.md'),
      path.join(projectPath, 'docs', 'claude.md'),
    ];

    for (const mdPath of claudeMdPaths) {
      if (fs.existsSync(mdPath)) {
        try {
          session.claudeMd = fs.readFileSync(mdPath, 'utf-8').slice(0, 5000);
          break;
        } catch (e) {
          console.warn(`Failed to read ${mdPath}:`, e.message);
        }
      }
    }

    // Load file tree context
    session.fileContext = this.buildFileTree(projectPath);

    // Get git status if available
    session.gitStatus = this.getGitStatus(projectPath);
  }

  /**
   * Build a concise file tree representation
   */
  buildFileTree(projectPath, maxDepth = 3) {
    const ignorePatterns = [
      'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
      '__pycache__', '.pytest_cache', 'venv', '.venv', 'coverage',
      '.idea', '.vscode', '*.log', '.DS_Store',
    ];

    const shouldIgnore = (name) => {
      return ignorePatterns.some(pattern => {
        if (pattern.includes('*')) {
          const regex = new RegExp(pattern.replace('*', '.*'));
          return regex.test(name);
        }
        return name === pattern;
      });
    };

    const buildTree = (dirPath, depth = 0, prefix = '') => {
      if (depth > maxDepth) return '';

      let result = '';
      try {
        const items = fs.readdirSync(dirPath)
          .filter(item => !shouldIgnore(item))
          .sort((a, b) => {
            // Directories first
            const aIsDir = fs.statSync(path.join(dirPath, a)).isDirectory();
            const bIsDir = fs.statSync(path.join(dirPath, b)).isDirectory();
            if (aIsDir && !bIsDir) return -1;
            if (!aIsDir && bIsDir) return 1;
            return a.localeCompare(b);
          })
          .slice(0, 20); // Limit items per directory

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const itemPath = path.join(dirPath, item);
          const isLast = i === items.length - 1;
          const connector = isLast ? '└── ' : '├── ';
          const newPrefix = prefix + (isLast ? '    ' : '│   ');

          try {
            const stat = fs.statSync(itemPath);
            if (stat.isDirectory()) {
              result += `${prefix}${connector}${item}/\n`;
              result += buildTree(itemPath, depth + 1, newPrefix);
            } else {
              result += `${prefix}${connector}${item}\n`;
            }
          } catch (e) {
            // Skip inaccessible files
          }
        }
      } catch (e) {
        // Skip inaccessible directories
      }

      return result;
    };

    const tree = buildTree(projectPath);
    return tree.slice(0, this.maxFileContextSize);
  }

  /**
   * Get git status summary
   */
  getGitStatus(projectPath) {
    try {
      const status = execSync('git status --porcelain', {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 5000,
      });

      const branch = execSync('git branch --show-current', {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      const lastCommit = execSync('git log -1 --oneline', {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      const lines = status.split('\n').filter(l => l.trim());
      const modified = lines.filter(l => l.startsWith(' M') || l.startsWith('M ')).length;
      const added = lines.filter(l => l.startsWith('A ') || l.startsWith('??')).length;
      const deleted = lines.filter(l => l.startsWith(' D') || l.startsWith('D ')).length;

      return {
        branch,
        lastCommit,
        modified,
        added,
        deleted,
        clean: lines.length === 0,
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Load prompt rules from project
   */
  async loadPromptRules(session, projectId) {
    try {
      const db = getDB();
      const project = db.data.projects?.find(p => p.id === projectId);

      if (project) {
        session.promptRules = project.rules || [];
        session.projectName = project.name;
        session.projectDescription = project.description;
      }

      // Also load global rules
      session.globalRules = db.data.globalRules?.filter(r => r.enabled !== false) || [];
    } catch (e) {
      console.warn('Failed to load prompt rules:', e.message);
    }
  }

  /**
   * Add interaction to history
   */
  addToHistory(sessionId, entry) {
    const session = this.getSession(sessionId);

    session.history.push({
      timestamp: Date.now(),
      ...entry,
    });

    // Trim history if too long
    if (session.history.length > this.maxHistoryLength) {
      session.history = session.history.slice(-this.maxHistoryLength);
    }

    session.lastActivity = Date.now();
  }

  /**
   * Add AI CLI output to history
   */
  addCliOutput(sessionId, output, type = 'output') {
    this.addToHistory(sessionId, {
      type: 'cli_' + type,
      content: output.slice(0, 2000), // Limit size
    });
  }

  /**
   * Add user/auto response to history
   */
  addResponse(sessionId, { prompt, response, wasAuto, confidence, reasoning }) {
    this.addToHistory(sessionId, {
      type: 'response',
      prompt: prompt.slice(0, 500),
      response,
      wasAuto,
      confidence,
      reasoning,
    });
  }

  /**
   * Create a rollback point
   */
  createRollbackPoint(sessionId, description) {
    const session = this.getSession(sessionId);
    const projectPath = session.projectPath;

    if (!projectPath) return null;

    const rollbackPoint = {
      id: `rollback-${Date.now()}`,
      timestamp: Date.now(),
      description,
      gitCommit: null,
      files: [],
    };

    // Try to get current git commit
    try {
      rollbackPoint.gitCommit = execSync('git rev-parse HEAD', {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
    } catch (e) {
      // Not a git repo or git not available
    }

    session.rollbackPoints.push(rollbackPoint);

    // Keep only last 10 rollback points
    if (session.rollbackPoints.length > 10) {
      session.rollbackPoints = session.rollbackPoints.slice(-10);
    }

    return rollbackPoint;
  }

  /**
   * Assess security risk of a command/action
   */
  assessRisk(text) {
    const risks = [];

    for (const { pattern, level, reason } of DANGEROUS_PATTERNS) {
      if (pattern.test(text)) {
        risks.push({ level, reason, matched: text.match(pattern)?.[0] });
      }
    }

    // Return highest risk found
    const riskOrder = [RISK_LEVELS.CRITICAL, RISK_LEVELS.HIGH, RISK_LEVELS.MEDIUM, RISK_LEVELS.LOW, RISK_LEVELS.SAFE];

    for (const level of riskOrder) {
      const risk = risks.find(r => r.level === level);
      if (risk) {
        return {
          level: risk.level,
          reasons: risks.filter(r => r.level === level).map(r => r.reason),
          requiresConfirmation: level === RISK_LEVELS.CRITICAL || level === RISK_LEVELS.HIGH,
          allRisks: risks,
        };
      }
    }

    return {
      level: RISK_LEVELS.SAFE,
      reasons: [],
      requiresConfirmation: false,
      allRisks: [],
    };
  }

  /**
   * Build full context for LLM
   */
  buildLLMContext(sessionId) {
    const session = this.getSession(sessionId);

    // Build history summary (last 10 interactions)
    const recentHistory = session.history.slice(-10).map(entry => {
      if (entry.type === 'response') {
        return `[${entry.wasAuto ? 'AUTO' : 'USER'}] Q: "${entry.prompt.slice(0, 100)}..." → A: "${entry.response}"`;
      } else if (entry.type === 'cli_output') {
        return `[CLI] ${entry.content.slice(0, 200)}...`;
      }
      return null;
    }).filter(Boolean).join('\n');

    return {
      // Project info
      projectName: session.projectName,
      projectDescription: session.projectDescription,
      projectPath: session.projectPath,

      // File context
      fileTree: session.fileContext,
      gitStatus: session.gitStatus,

      // Claude.md content
      claudeMd: session.claudeMd,

      // Rules
      promptRules: session.promptRules,
      globalRules: session.globalRules?.map(r => r.text) || [],

      // History
      recentHistory,
      totalInteractions: session.history.length,

      // Session info
      cliTool: session.cliTool,
      sessionDuration: Date.now() - session.createdAt,

      // Rollback info
      hasRollbackPoints: session.rollbackPoints.length > 0,
      lastRollbackPoint: session.rollbackPoints[session.rollbackPoints.length - 1],
    };
  }

  /**
   * Get session history for persistence
   */
  getSessionHistory(sessionId) {
    const session = this.sessions.get(sessionId);
    return session?.history || [];
  }

  /**
   * Restore session from persisted history
   */
  restoreSession(sessionId, history) {
    const session = this.getSession(sessionId);
    session.history = history;
  }

  /**
   * Clear session
   */
  clearSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions() {
    const now = Date.now();
    const activeThreshold = 30 * 60 * 1000; // 30 minutes

    return Array.from(this.sessions.entries())
      .filter(([_, session]) => now - session.lastActivity < activeThreshold)
      .map(([id, session]) => ({
        id,
        projectId: session.projectId,
        cliTool: session.cliTool,
        historyLength: session.history.length,
        lastActivity: session.lastActivity,
      }));
  }
}

// Singleton instance
export const sessionContext = new SessionContext();

export default sessionContext;
