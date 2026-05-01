/**
 * Auto-Responder Engine
 * Detects prompts in CLI output and can auto-respond or suggest responses
 * Integrates with SmartEngine for NLP-based intent analysis
 */

import { getDB } from './db.js';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { smartEngine, INTENTS } from './smartEngine.js';
import { llmProvider } from './llmProvider.js';
import { sessionContext, RISK_LEVELS } from './sessionContext.js';

// Default patterns for common AI CLI prompts
export const DEFAULT_PATTERNS = [
  // Claude Code patterns
  {
    id: 'claude-tool-approval',
    name: 'Claude Tool Approval',
    pattern: '(Allow|Approve).*\\?\\s*\\[([Yy]\\/[Nn]|yes\\/no)\\]',
    cli: 'claude',
    category: 'approval',
    action: 'suggest',
    responses: ['y', 'n'],
    defaultResponse: 'y',
    description: 'Claude asking to approve a tool action',
  },
  {
    id: 'claude-continue',
    name: 'Claude Continue',
    pattern: '(Continue|Proceed)\\?|Press Enter to continue',
    cli: 'claude',
    category: 'continue',
    action: 'auto',
    responses: ['', 'y'],
    defaultResponse: '',
    description: 'Claude asking to continue',
  },
  {
    id: 'claude-file-edit',
    name: 'Claude File Edit',
    pattern: 'Allow Claude to edit.*\\?',
    cli: 'claude',
    category: 'approval',
    action: 'suggest',
    responses: ['y', 'n'],
    defaultResponse: 'y',
    description: 'Claude asking to edit a file',
  },
  {
    id: 'claude-file-create',
    name: 'Claude File Create',
    pattern: 'Allow Claude to create.*\\?',
    cli: 'claude',
    category: 'approval',
    action: 'suggest',
    responses: ['y', 'n'],
    defaultResponse: 'y',
    description: 'Claude asking to create a file',
  },
  {
    id: 'claude-bash',
    name: 'Claude Bash Command',
    pattern: 'Allow Claude to run.*\\?|Allow.*bash.*\\?',
    cli: 'claude',
    category: 'approval',
    action: 'suggest',
    responses: ['y', 'n'],
    defaultResponse: 'y',
    description: 'Claude asking to run a bash command',
  },

  // GitHub Copilot patterns
  {
    id: 'copilot-confirm',
    name: 'Copilot Confirm',
    pattern: '\\[Y\\]es.*\\[N\\]o|\\(y\\/n\\)',
    cli: 'copilot',
    category: 'approval',
    action: 'suggest',
    responses: ['y', 'n', 'Y', 'N'],
    defaultResponse: 'y',
    description: 'Copilot yes/no confirmation',
  },

  // Aider patterns
  {
    id: 'aider-apply',
    name: 'Aider Apply Changes',
    pattern: 'Apply.*changes\\?|Commit.*\\?',
    cli: 'aider',
    category: 'approval',
    action: 'suggest',
    responses: ['y', 'n'],
    defaultResponse: 'y',
    description: 'Aider asking to apply changes',
  },
  {
    id: 'aider-add-file',
    name: 'Aider Add File',
    pattern: 'Add.*to the chat\\?',
    cli: 'aider',
    category: 'approval',
    action: 'suggest',
    responses: ['y', 'n'],
    defaultResponse: 'y',
    description: 'Aider asking to add a file',
  },

  // Generic patterns (work with any CLI)
  {
    id: 'generic-yes-no',
    name: 'Generic Yes/No',
    pattern: '\\?\\s*(?:\\(|\\[)?[Yy](?:es)?\\/?[Nn](?:o)?(?:\\)|\\])?\\s*$',
    cli: 'generic',
    category: 'approval',
    action: 'suggest',
    responses: ['y', 'n'],
    defaultResponse: 'y',
    description: 'Generic yes/no prompt',
  },
  {
    id: 'generic-continue',
    name: 'Generic Continue',
    pattern: 'Press (Enter|any key) to continue|Continue\\?',
    cli: 'generic',
    category: 'continue',
    action: 'suggest',
    responses: [''],
    defaultResponse: '',
    description: 'Generic continue prompt',
  },
  {
    id: 'generic-overwrite',
    name: 'Generic Overwrite',
    pattern: '(Overwrite|Replace).*\\?',
    cli: 'generic',
    category: 'approval',
    action: 'suggest',
    responses: ['y', 'n'],
    defaultResponse: 'n',
    description: 'File overwrite confirmation',
  },

  // Error/retry patterns
  {
    id: 'generic-retry',
    name: 'Retry on Error',
    pattern: 'Retry\\?|Try again\\?',
    cli: 'generic',
    category: 'error',
    action: 'suggest',
    responses: ['y', 'n'],
    defaultResponse: 'y',
    description: 'Retry after error',
  },

  // Completion detection (not for response, but for state tracking)
  {
    id: 'completion-done',
    name: 'Task Completed',
    pattern: '(Task|Done|Completed|Finished|Success)!?\\s*$|All done|Let me know if',
    cli: 'generic',
    category: 'completion',
    action: 'notify',
    responses: [],
    defaultResponse: null,
    description: 'AI indicates task completion',
  },
];

// Action types
export const ACTIONS = {
  AUTO: 'auto',       // Automatically send response
  SUGGEST: 'suggest', // Show suggestion to user
  ASK: 'ask',         // Always ask user
  NOTIFY: 'notify',   // Just notify, no response
  IGNORE: 'ignore',   // Ignore this pattern
};

// Categories
export const CATEGORIES = {
  APPROVAL: 'approval',
  CONTINUE: 'continue',
  ERROR: 'error',
  COMPLETION: 'completion',
  CUSTOM: 'custom',
};

class AutoResponder extends EventEmitter {
  constructor() {
    super();
    this.patterns = [];
    this.sessionSettings = new Map(); // sessionId -> settings
    this.compiledPatterns = new Map(); // pattern id -> RegExp
    this.recentMatches = new Map(); // sessionId -> recent matches for debounce
    this.sessionProjectPaths = new Map(); // sessionId -> projectPath
    this.smartEngineEnabled = true;
  }

  /**
   * Initialize with patterns from database or defaults
   */
  async init() {
    const db = getDB();

    // Ensure autoResponder config exists
    if (!db.data.autoResponder) {
      db.data.autoResponder = {
        enabled: true,
        patterns: DEFAULT_PATTERNS,
        globalSettings: {
          autoApproveReads: true,
          autoApproveWrites: false,
          autoApproveBash: false,
          autoContinue: true,
          notifyOnCompletion: true,
          responseDelay: 500, // ms delay before auto-response
        },
      };
      await db.write();
    }

    this.patterns = db.data.autoResponder.patterns;
    this.compilePatterns();

    // Initialize smart engine for NLP-based analysis
    await smartEngine.init();

    // Initialize LLM provider
    await llmProvider.init();

    console.log(`AutoResponder initialized with ${this.patterns.length} patterns`);
    console.log('Smart engine NLP classifier ready');
    console.log(`LLM provider ready (enabled: ${llmProvider.getSettings().enabled})`);
  }

  /**
   * Set project path for a session (for smart engine context)
   */
  setSessionProjectPath(sessionId, projectPath) {
    this.sessionProjectPaths.set(sessionId, projectPath);
  }

  /**
   * Get project path for a session
   */
  getSessionProjectPath(sessionId) {
    return this.sessionProjectPaths.get(sessionId);
  }

  /**
   * Compile regex patterns for performance
   */
  compilePatterns() {
    this.compiledPatterns.clear();
    for (const pattern of this.patterns) {
      try {
        this.compiledPatterns.set(pattern.id, new RegExp(pattern.pattern, 'im'));
      } catch (e) {
        console.warn(`Invalid pattern ${pattern.id}: ${e.message}`);
      }
    }
  }

  /**
   * Get global settings
   */
  getSettings() {
    const db = getDB();
    return db.data.autoResponder?.globalSettings || {};
  }

  /**
   * Update global settings
   */
  async updateSettings(settings) {
    const db = getDB();
    if (!db.data.autoResponder) {
      await this.init();
    }
    db.data.autoResponder.globalSettings = {
      ...db.data.autoResponder.globalSettings,
      ...settings,
    };
    await db.write();
    return db.data.autoResponder.globalSettings;
  }

  /**
   * Get all patterns
   */
  getPatterns() {
    const db = getDB();
    return db.data.autoResponder?.patterns || DEFAULT_PATTERNS;
  }

  /**
   * Update a pattern
   */
  async updatePattern(patternId, updates) {
    const db = getDB();
    const patterns = db.data.autoResponder?.patterns || [];
    const index = patterns.findIndex(p => p.id === patternId);

    if (index === -1) return null;

    patterns[index] = { ...patterns[index], ...updates };
    await db.write();

    // Recompile if pattern changed
    if (updates.pattern) {
      try {
        this.compiledPatterns.set(patternId, new RegExp(updates.pattern, 'im'));
      } catch (e) {
        console.warn(`Invalid pattern update: ${e.message}`);
      }
    }

    return patterns[index];
  }

  /**
   * Add a custom pattern
   */
  async addPattern(pattern) {
    const db = getDB();
    if (!db.data.autoResponder) {
      await this.init();
    }

    const newPattern = {
      id: `custom-${uuidv4().slice(0, 8)}`,
      category: 'custom',
      action: 'suggest',
      cli: 'generic',
      ...pattern,
      createdAt: new Date().toISOString(),
    };

    db.data.autoResponder.patterns.push(newPattern);
    await db.write();

    // Compile the new pattern
    try {
      this.compiledPatterns.set(newPattern.id, new RegExp(newPattern.pattern, 'im'));
    } catch (e) {
      console.warn(`Invalid custom pattern: ${e.message}`);
    }

    this.patterns = db.data.autoResponder.patterns;
    return newPattern;
  }

  /**
   * Delete a pattern
   */
  async deletePattern(patternId) {
    const db = getDB();
    if (!db.data.autoResponder) return false;

    const index = db.data.autoResponder.patterns.findIndex(p => p.id === patternId);
    if (index === -1) return false;

    db.data.autoResponder.patterns.splice(index, 1);
    await db.write();

    this.compiledPatterns.delete(patternId);
    this.patterns = db.data.autoResponder.patterns;

    return true;
  }

  /**
   * Check text for matching patterns
   * @param {string} text - Text to check (usually last few lines of terminal output)
   * @param {string} sessionId - Session ID for debouncing
   * @param {string} cliTool - Current CLI tool (claude, copilot, aider, etc.)
   * @returns {object|null} - Match result with pattern and suggested response
   */
  checkForPrompt(text, sessionId, cliTool = 'generic') {
    if (!text || text.length < 2) return null;

    const settings = this.getSettings();
    if (!settings) return null;

    // Clean the text - get last meaningful lines
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const recentText = lines.slice(-5).join('\n');

    // Check for recent matches to avoid duplicates
    const recentKey = `${sessionId}-${recentText.slice(-50)}`;
    const lastMatch = this.recentMatches.get(recentKey);
    if (lastMatch && Date.now() - lastMatch < 2000) {
      return null; // Debounce: same prompt within 2 seconds
    }

    // Check patterns in order of specificity (CLI-specific first, then generic)
    const sortedPatterns = [...this.patterns].sort((a, b) => {
      // CLI-specific patterns first
      if (a.cli === cliTool && b.cli !== cliTool) return -1;
      if (b.cli === cliTool && a.cli !== cliTool) return 1;
      // Then by category priority
      const categoryOrder = ['approval', 'continue', 'error', 'completion', 'custom'];
      return categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
    });

    for (const pattern of sortedPatterns) {
      if (pattern.action === 'ignore') continue;

      // Skip if pattern is for a different CLI (unless generic)
      if (pattern.cli !== 'generic' && pattern.cli !== cliTool) continue;

      const regex = this.compiledPatterns.get(pattern.id);
      if (!regex) continue;

      const match = recentText.match(regex);
      if (match) {
        // Record this match for debouncing
        this.recentMatches.set(recentKey, Date.now());

        // Clean up old debounce entries
        if (this.recentMatches.size > 100) {
          const now = Date.now();
          for (const [key, time] of this.recentMatches) {
            if (now - time > 10000) {
              this.recentMatches.delete(key);
            }
          }
        }

        // Determine action based on settings and pattern
        let effectiveAction = pattern.action;

        // Override based on global settings
        if (pattern.category === 'continue' && settings.autoContinue) {
          effectiveAction = 'auto';
        }
        if (pattern.category === 'approval') {
          if (pattern.name.toLowerCase().includes('read') && settings.autoApproveReads) {
            effectiveAction = 'auto';
          }
          if (pattern.name.toLowerCase().includes('write') && settings.autoApproveWrites) {
            effectiveAction = 'auto';
          }
          if (pattern.name.toLowerCase().includes('bash') && settings.autoApproveBash) {
            effectiveAction = 'auto';
          }
        }

        return {
          pattern,
          matchedText: match[0],
          action: effectiveAction,
          suggestedResponse: pattern.defaultResponse,
          responses: pattern.responses,
          timestamp: Date.now(),
        };
      }
    }

    // No pattern matched - try smart engine analysis
    return this.analyzeWithSmartEngine(recentText, sessionId, cliTool);
  }

  /**
   * Use smart engine for NLP-based prompt analysis
   */
  analyzeWithSmartEngine(text, sessionId, cliTool) {
    if (!this.smartEngineEnabled) {
      // If smart engine disabled, try LLM directly (async)
      this.requestLLMFallback(text, sessionId, cliTool, null);
      return null;
    }

    const projectPath = this.sessionProjectPaths.get(sessionId);

    try {
      const analysis = smartEngine.analyze(text, { projectPath });

      // Check if we should use LLM as fallback (async via event)
      if (llmProvider.shouldUseLLM(analysis)) {
        this.requestLLMFallback(text, sessionId, cliTool, analysis);
        return null; // Will come back via event
      }

      // Only act if we have reasonable confidence
      if (analysis.confidence < 0.4) {
        return null;
      }

      // Don't act on completion/notify intents (those are informational)
      if (analysis.intent === INTENTS.COMPLETION) {
        return {
          pattern: { id: 'smart-completion', name: 'Smart: Task Complete', category: 'completion' },
          matchedText: text.slice(-100),
          action: 'notify',
          suggestedResponse: null,
          responses: [],
          timestamp: Date.now(),
          smartEngine: true,
          reasoning: analysis.reasoning,
        };
      }

      // Don't act on unknown or low-confidence
      if (analysis.intent === INTENTS.UNKNOWN || !analysis.suggestion) {
        return null;
      }

      // Map smart engine action to auto-responder action
      let action = analysis.action;
      if (action === 'ask_user') action = 'suggest';
      if (action === 'ask_llm') action = 'suggest'; // For now, fallback to suggest

      // Build response options based on intent
      let responses = [];
      if (analysis.intent === INTENTS.APPROVAL || analysis.intent === INTENTS.CONFIRMATION) {
        responses = ['y', 'n'];
      } else if (analysis.intent === INTENTS.CHOICE && analysis.parsed?.options?.length > 0) {
        responses = analysis.parsed.options;
      } else if (analysis.suggestion) {
        responses = [analysis.suggestion];
      }

      // Record this match for debouncing
      const recentKey = `${sessionId}-${text.slice(-50)}`;
      this.recentMatches.set(recentKey, Date.now());

      return {
        pattern: {
          id: `smart-${analysis.intent}`,
          name: `Smart: ${analysis.intent.charAt(0).toUpperCase() + analysis.intent.slice(1)}`,
          category: analysis.intent,
          cli: cliTool,
        },
        matchedText: text.slice(-200),
        action,
        suggestedResponse: analysis.suggestion,
        responses,
        timestamp: Date.now(),
        smartEngine: true,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
        projectContext: analysis.projectContext,
      };
    } catch (error) {
      console.warn('Smart engine analysis failed:', error.message);
      this.requestLLMFallback(text, sessionId, cliTool, null);
      return null;
    }
  }

  /**
   * Request LLM fallback (async via event emitter)
   */
  requestLLMFallback(text, sessionId, cliTool, smartEngineResult) {
    if (!llmProvider.getSettings().enabled) {
      return;
    }

    // Debounce check
    const recentKey = `llm-${sessionId}-${text.slice(-50)}`;
    const lastRequest = this.recentMatches.get(recentKey);
    if (lastRequest && Date.now() - lastRequest < 5000) {
      return; // Already requested recently
    }
    this.recentMatches.set(recentKey, Date.now());

    // Emit event for async handling
    this.emit('llm-request', {
      text,
      sessionId,
      cliTool,
      smartEngineResult,
    });
  }

  /**
   * Process LLM request (called by terminal server)
   * Returns a promise that resolves to a result object or null
   */
  async processLLMRequest(text, sessionId, cliTool, smartEngineResult) {
    if (!llmProvider.getSettings().enabled || !llmProvider.available) {
      return null;
    }

    try {
      // Use the enhanced context-aware generation
      const llmResult = await llmProvider.generateResponseWithContext(
        text,
        sessionId,
        smartEngineResult
      );

      // Handle security confirmation required
      if (llmResult.requiresConfirmation) {
        return {
          pattern: {
            id: 'security-confirmation',
            name: `Security: ${llmResult.riskAssessment.level.toUpperCase()} Risk`,
            category: 'security',
            cli: cliTool,
          },
          matchedText: text.slice(-200),
          action: 'ask_user', // Force user confirmation
          suggestedResponse: null,
          responses: ['y', 'n'],
          timestamp: Date.now(),
          requiresConfirmation: true,
          riskLevel: llmResult.riskAssessment.level,
          riskReasons: llmResult.riskAssessment.reasons,
          reasoning: [llmResult.reason],
        };
      }

      // Determine action based on auto-respond settings
      const action = llmResult.shouldAutoRespond ? 'auto' : 'suggest';

      return {
        pattern: {
          id: 'llm-response',
          name: `LLM: ${llmResult.provider}/${llmResult.model}`,
          category: smartEngineResult?.intent || 'unknown',
          cli: cliTool,
        },
        matchedText: text.slice(-200),
        action,
        suggestedResponse: llmResult.response,
        responses: [llmResult.response],
        timestamp: Date.now(),
        llmGenerated: true,
        llmProvider: llmResult.provider,
        llmModel: llmResult.model,
        confidence: llmResult.confidence,
        smartEngineConfidence: smartEngineResult?.confidence,
        riskLevel: llmResult.riskAssessment?.level,
        reasoning: [
          `LLM generated response using ${llmResult.provider}/${llmResult.model}`,
          llmResult.shouldAutoRespond ? 'High confidence - auto-responding' : 'Awaiting user confirmation',
          ...(smartEngineResult?.reasoning || []),
        ],
      };
    } catch (error) {
      console.warn('LLM request failed:', error.message);
      this.emit('llm-error', { sessionId, error: error.message });
      return null;
    }
  }

  /**
   * Get session-specific settings
   */
  getSessionSettings(sessionId) {
    return this.sessionSettings.get(sessionId) || {
      enabled: true,
      autoMode: false, // Full auto mode (respond to everything)
    };
  }

  /**
   * Set session-specific settings
   */
  setSessionSettings(sessionId, settings) {
    this.sessionSettings.set(sessionId, {
      ...this.getSessionSettings(sessionId),
      ...settings,
    });
  }

  /**
   * Clear session settings
   */
  clearSessionSettings(sessionId) {
    this.sessionSettings.delete(sessionId);
    this.sessionProjectPaths.delete(sessionId);
    // Clean up debounce entries for this session
    for (const key of this.recentMatches.keys()) {
      if (key.startsWith(sessionId)) {
        this.recentMatches.delete(key);
      }
    }
  }

  /**
   * Enable/disable smart engine
   */
  setSmartEngineEnabled(enabled) {
    this.smartEngineEnabled = enabled;
  }

  /**
   * Check if smart engine is enabled
   */
  isSmartEngineEnabled() {
    return this.smartEngineEnabled;
  }

  /**
   * Reset patterns to defaults
   */
  async resetToDefaults() {
    const db = getDB();
    db.data.autoResponder = {
      enabled: true,
      patterns: DEFAULT_PATTERNS,
      globalSettings: {
        autoApproveReads: true,
        autoApproveWrites: false,
        autoApproveBash: false,
        autoContinue: true,
        notifyOnCompletion: true,
        responseDelay: 500,
      },
    };
    await db.write();
    this.patterns = DEFAULT_PATTERNS;
    this.compilePatterns();
    return db.data.autoResponder;
  }
}

// Singleton instance
export const autoResponder = new AutoResponder();

export default autoResponder;
