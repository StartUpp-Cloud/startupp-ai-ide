/**
 * Smart Response Engine
 * Uses NLP to understand AI prompts and generate intelligent responses
 * without requiring a full LLM
 */

import nlp from 'compromise';
import natural from 'natural';
import fs from 'fs';
import path from 'path';

// Intent categories
export const INTENTS = {
  APPROVAL: 'approval',           // "Allow X?" "Can I do Y?"
  CHOICE: 'choice',               // "A or B?" "Which one?"
  CONFIRMATION: 'confirmation',   // "Continue?" "Proceed?" "Yes/No?"
  INFORMATION: 'information',     // "What is X?" "Where is Y?"
  CLARIFICATION: 'clarification', // "Did you mean X?" "Can you clarify?"
  COMPLETION: 'completion',       // "Done!" "Finished" "Complete"
  ERROR: 'error',                 // "Error" "Failed" "Could not"
  UNKNOWN: 'unknown',
};

// Training data for intent classification
const TRAINING_DATA = [
  // Approval intents
  { text: 'allow me to read', intent: INTENTS.APPROVAL },
  { text: 'allow me to write', intent: INTENTS.APPROVAL },
  { text: 'allow me to edit', intent: INTENTS.APPROVAL },
  { text: 'allow me to create', intent: INTENTS.APPROVAL },
  { text: 'allow me to delete', intent: INTENTS.APPROVAL },
  { text: 'allow me to run', intent: INTENTS.APPROVAL },
  { text: 'allow me to execute', intent: INTENTS.APPROVAL },
  { text: 'can i modify', intent: INTENTS.APPROVAL },
  { text: 'may i change', intent: INTENTS.APPROVAL },
  { text: 'permission to access', intent: INTENTS.APPROVAL },
  { text: 'approve this action', intent: INTENTS.APPROVAL },
  { text: 'do you want me to', intent: INTENTS.APPROVAL },
  { text: 'should i proceed with', intent: INTENTS.APPROVAL },
  { text: 'ok to make changes', intent: INTENTS.APPROVAL },

  // Choice intents
  { text: 'which one should i use', intent: INTENTS.CHOICE },
  { text: 'should i use a or b', intent: INTENTS.CHOICE },
  { text: 'typescript or javascript', intent: INTENTS.CHOICE },
  { text: 'would you prefer', intent: INTENTS.CHOICE },
  { text: 'pick one', intent: INTENTS.CHOICE },
  { text: 'choose between', intent: INTENTS.CHOICE },
  { text: 'which option', intent: INTENTS.CHOICE },
  { text: 'select from', intent: INTENTS.CHOICE },
  { text: 'what format should', intent: INTENTS.CHOICE },
  { text: 'which directory', intent: INTENTS.CHOICE },
  { text: 'which file', intent: INTENTS.CHOICE },
  { text: 'which approach', intent: INTENTS.CHOICE },
  { text: 'what style', intent: INTENTS.CHOICE },
  { text: 'which framework', intent: INTENTS.CHOICE },
  { text: 'which library', intent: INTENTS.CHOICE },

  // Confirmation intents
  { text: 'continue', intent: INTENTS.CONFIRMATION },
  { text: 'proceed', intent: INTENTS.CONFIRMATION },
  { text: 'go ahead', intent: INTENTS.CONFIRMATION },
  { text: 'yes or no', intent: INTENTS.CONFIRMATION },
  { text: 'is this correct', intent: INTENTS.CONFIRMATION },
  { text: 'does this look right', intent: INTENTS.CONFIRMATION },
  { text: 'shall i continue', intent: INTENTS.CONFIRMATION },
  { text: 'ready to proceed', intent: INTENTS.CONFIRMATION },
  { text: 'confirm this', intent: INTENTS.CONFIRMATION },
  { text: 'are you sure', intent: INTENTS.CONFIRMATION },
  { text: 'is that ok', intent: INTENTS.CONFIRMATION },
  { text: 'sound good', intent: INTENTS.CONFIRMATION },
  { text: 'press enter', intent: INTENTS.CONFIRMATION },
  { text: 'hit enter', intent: INTENTS.CONFIRMATION },

  // Information intents
  { text: 'what is the', intent: INTENTS.INFORMATION },
  { text: 'where is the', intent: INTENTS.INFORMATION },
  { text: 'how do i', intent: INTENTS.INFORMATION },
  { text: 'can you tell me', intent: INTENTS.INFORMATION },
  { text: 'what should the', intent: INTENTS.INFORMATION },
  { text: 'what value', intent: INTENTS.INFORMATION },
  { text: 'what name', intent: INTENTS.INFORMATION },
  { text: 'what path', intent: INTENTS.INFORMATION },
  { text: 'provide the', intent: INTENTS.INFORMATION },
  { text: 'enter the', intent: INTENTS.INFORMATION },
  { text: 'specify the', intent: INTENTS.INFORMATION },
  { text: 'input the', intent: INTENTS.INFORMATION },

  // Clarification intents
  { text: 'did you mean', intent: INTENTS.CLARIFICATION },
  { text: 'do you mean', intent: INTENTS.CLARIFICATION },
  { text: 'can you clarify', intent: INTENTS.CLARIFICATION },
  { text: 'what do you mean by', intent: INTENTS.CLARIFICATION },
  { text: 'could you explain', intent: INTENTS.CLARIFICATION },
  { text: 'i am not sure what', intent: INTENTS.CLARIFICATION },
  { text: 'please elaborate', intent: INTENTS.CLARIFICATION },
  { text: 'be more specific', intent: INTENTS.CLARIFICATION },

  // Completion intents
  { text: 'done', intent: INTENTS.COMPLETION },
  { text: 'finished', intent: INTENTS.COMPLETION },
  { text: 'complete', intent: INTENTS.COMPLETION },
  { text: 'all set', intent: INTENTS.COMPLETION },
  { text: 'task completed', intent: INTENTS.COMPLETION },
  { text: 'successfully', intent: INTENTS.COMPLETION },
  { text: 'changes applied', intent: INTENTS.COMPLETION },
  { text: 'let me know if', intent: INTENTS.COMPLETION },
  { text: 'anything else', intent: INTENTS.COMPLETION },
  { text: 'is there anything', intent: INTENTS.COMPLETION },

  // Error intents
  { text: 'error', intent: INTENTS.ERROR },
  { text: 'failed', intent: INTENTS.ERROR },
  { text: 'could not', intent: INTENTS.ERROR },
  { text: 'unable to', intent: INTENTS.ERROR },
  { text: 'permission denied', intent: INTENTS.ERROR },
  { text: 'not found', intent: INTENTS.ERROR },
  { text: 'does not exist', intent: INTENTS.ERROR },
  { text: 'invalid', intent: INTENTS.ERROR },
  { text: 'retry', intent: INTENTS.ERROR },
  { text: 'try again', intent: INTENTS.ERROR },
];

class SmartEngine {
  constructor() {
    this.classifier = new natural.BayesClassifier();
    this.trained = false;
    this.tokenizer = new natural.WordTokenizer();
    this.stemmer = natural.PorterStemmer;
  }

  /**
   * Initialize and train the classifier
   */
  async init() {
    // Train the classifier with our data
    for (const item of TRAINING_DATA) {
      this.classifier.addDocument(item.text, item.intent);
    }

    this.classifier.train();
    this.trained = true;
    console.log('Smart engine classifier trained');
  }

  /**
   * Classify the intent of a text
   */
  classifyIntent(text) {
    if (!this.trained) {
      return { intent: INTENTS.UNKNOWN, confidence: 0 };
    }

    const cleanText = text.toLowerCase().trim();
    const classifications = this.classifier.getClassifications(cleanText);

    if (classifications.length === 0) {
      return { intent: INTENTS.UNKNOWN, confidence: 0 };
    }

    const top = classifications[0];
    const second = classifications[1];

    // Calculate confidence based on difference between top two
    let confidence = top.value;
    if (second) {
      // If top two are close, lower confidence
      const diff = top.value - second.value;
      confidence = Math.min(1, diff * 2 + 0.3);
    }

    return {
      intent: top.label,
      confidence: Math.round(confidence * 100) / 100,
      allClassifications: classifications.slice(0, 3),
    };
  }

  /**
   * Parse a question using compromise NLP
   */
  parseQuestion(text) {
    const doc = nlp(text);

    // Extract key elements
    const result = {
      original: text,
      normalized: doc.normalize().text(),
      isQuestion: doc.questions().length > 0 || text.includes('?'),
      verbs: doc.verbs().out('array'),
      nouns: doc.nouns().out('array'),
      values: doc.values().out('array'),
      // Extract quoted strings (often file paths or options)
      quoted: this.extractQuoted(text),
      // Extract paths
      paths: this.extractPaths(text),
      // Extract options (A or B patterns)
      options: this.extractOptions(text),
      // Extract file extensions mentioned
      extensions: this.extractExtensions(text),
      // Is it asking about a specific technology
      technologies: this.extractTechnologies(text),
    };

    return result;
  }

  /**
   * Extract quoted strings
   */
  extractQuoted(text) {
    const patterns = [
      /"([^"]+)"/g,
      /'([^']+)'/g,
      /`([^`]+)`/g,
    ];

    const results = [];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        results.push(match[1]);
      }
    }
    return results;
  }

  /**
   * Extract file paths
   */
  extractPaths(text) {
    const pathPattern = /(?:^|[\s"'`])([.\/~]?(?:[\w.-]+\/)+[\w.-]+|\.\/[\w.-]+)/g;
    const results = [];
    let match;
    while ((match = pathPattern.exec(text)) !== null) {
      results.push(match[1]);
    }
    return results;
  }

  /**
   * Extract options from "A or B" patterns
   */
  extractOptions(text) {
    const patterns = [
      /(?:^|[\s,])(\w+)\s+or\s+(\w+)(?:[\s,?]|$)/gi,
      /(?:choose|select|pick)\s+(?:between\s+)?(\w+)(?:\s+(?:and|or|,)\s+(\w+))+/gi,
      /\[([^\]]+)\]/g, // [option1/option2]
    ];

    const options = new Set();

    // Pattern 1: "A or B"
    let match = text.match(/(\w+)\s+or\s+(\w+)/gi);
    if (match) {
      match.forEach(m => {
        const parts = m.split(/\s+or\s+/i);
        parts.forEach(p => options.add(p.trim().toLowerCase()));
      });
    }

    // Pattern 2: [Y/n] or [yes/no]
    match = text.match(/\[([^\]]+)\]/g);
    if (match) {
      match.forEach(m => {
        const inner = m.slice(1, -1);
        inner.split(/[\/,|]/).forEach(p => {
          const clean = p.trim().toLowerCase();
          if (clean) options.add(clean);
        });
      });
    }

    return Array.from(options);
  }

  /**
   * Extract file extensions mentioned
   */
  extractExtensions(text) {
    const extPattern = /\.(ts|tsx|js|jsx|py|rb|go|rs|java|json|yml|yaml|md|txt|css|scss|html|vue|svelte)\b/gi;
    const matches = text.match(extPattern) || [];
    return [...new Set(matches.map(m => m.toLowerCase()))];
  }

  /**
   * Extract technology mentions
   */
  extractTechnologies(text) {
    const technologies = {
      languages: ['typescript', 'javascript', 'python', 'ruby', 'go', 'rust', 'java'],
      frameworks: ['react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'express', 'fastify', 'django', 'flask', 'rails'],
      tools: ['jest', 'mocha', 'vitest', 'pytest', 'eslint', 'prettier', 'webpack', 'vite', 'rollup'],
      databases: ['postgres', 'mysql', 'mongodb', 'redis', 'sqlite'],
    };

    const found = {};
    const lowerText = text.toLowerCase();

    for (const [category, items] of Object.entries(technologies)) {
      const matches = items.filter(item => lowerText.includes(item));
      if (matches.length > 0) {
        found[category] = matches;
      }
    }

    return found;
  }

  /**
   * Analyze project context to help make decisions
   */
  analyzeProjectContext(projectPath) {
    const context = {
      hasTypeScript: false,
      hasJavaScript: false,
      hasPython: false,
      packageJson: null,
      tsConfig: null,
      framework: null,
      testFramework: null,
      directories: [],
      mainLanguage: null,
    };

    if (!projectPath || !fs.existsSync(projectPath)) {
      return context;
    }

    try {
      // Check for key files
      const files = fs.readdirSync(projectPath);

      // TypeScript
      if (files.includes('tsconfig.json')) {
        context.hasTypeScript = true;
        try {
          context.tsConfig = JSON.parse(
            fs.readFileSync(path.join(projectPath, 'tsconfig.json'), 'utf-8')
          );
        } catch (e) {}
      }

      // Package.json
      if (files.includes('package.json')) {
        context.hasJavaScript = true;
        try {
          context.packageJson = JSON.parse(
            fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8')
          );

          const deps = {
            ...context.packageJson.dependencies,
            ...context.packageJson.devDependencies,
          };

          // Detect framework
          if (deps.react) context.framework = 'react';
          else if (deps.vue) context.framework = 'vue';
          else if (deps.angular) context.framework = 'angular';
          else if (deps.svelte) context.framework = 'svelte';
          else if (deps.next) context.framework = 'next';
          else if (deps.express) context.framework = 'express';

          // Detect test framework
          if (deps.jest) context.testFramework = 'jest';
          else if (deps.mocha) context.testFramework = 'mocha';
          else if (deps.vitest) context.testFramework = 'vitest';
        } catch (e) {}
      }

      // Python
      if (files.includes('pyproject.toml') || files.includes('requirements.txt') || files.includes('setup.py')) {
        context.hasPython = true;
      }

      // Get directories
      context.directories = files.filter(f => {
        try {
          return fs.statSync(path.join(projectPath, f)).isDirectory();
        } catch (e) {
          return false;
        }
      }).filter(d => !d.startsWith('.') && d !== 'node_modules');

      // Determine main language
      if (context.hasTypeScript) {
        context.mainLanguage = 'typescript';
      } else if (context.hasJavaScript) {
        context.mainLanguage = 'javascript';
      } else if (context.hasPython) {
        context.mainLanguage = 'python';
      }

    } catch (error) {
      console.warn('Error analyzing project context:', error.message);
    }

    return context;
  }

  /**
   * Generate a smart response based on intent, parsed question, and context
   */
  generateResponse(text, projectContext = null, sessionHistory = []) {
    const intentResult = this.classifyIntent(text);
    const parsed = this.parseQuestion(text);

    const response = {
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      parsed,
      suggestion: null,
      reasoning: [],
      action: 'suggest', // 'auto', 'suggest', 'ask_user', 'ask_llm'
    };

    // Process based on intent
    switch (intentResult.intent) {
      case INTENTS.APPROVAL:
        return this.handleApproval(response, parsed, projectContext);

      case INTENTS.CHOICE:
        return this.handleChoice(response, parsed, projectContext);

      case INTENTS.CONFIRMATION:
        return this.handleConfirmation(response, parsed, projectContext);

      case INTENTS.INFORMATION:
        return this.handleInformation(response, parsed, projectContext);

      case INTENTS.COMPLETION:
        response.suggestion = null;
        response.action = 'notify';
        response.reasoning.push('Task appears to be complete');
        return response;

      case INTENTS.ERROR:
        return this.handleError(response, parsed, projectContext);

      default:
        response.action = 'ask_user';
        response.reasoning.push('Could not determine intent with confidence');
        return response;
    }
  }

  /**
   * Handle approval requests
   */
  handleApproval(response, parsed, context) {
    const lowerText = parsed.original.toLowerCase();

    // Determine what's being approved
    const isRead = /read|view|access|see|look|check/.test(lowerText);
    const isWrite = /write|edit|modify|change|update|save/.test(lowerText);
    const isCreate = /create|add|new|generate|make/.test(lowerText);
    const isDelete = /delete|remove|erase/.test(lowerText);
    const isExecute = /run|execute|bash|command|script/.test(lowerText);

    // Default to approve reads
    if (isRead && !isWrite && !isDelete && !isExecute) {
      response.suggestion = 'y';
      response.action = 'auto';
      response.confidence = 0.9;
      response.reasoning.push('Read-only operation is safe');
      return response;
    }

    // For file creation, check if path makes sense
    if (isCreate && parsed.paths.length > 0) {
      const targetPath = parsed.paths[0];
      if (context?.directories) {
        const targetDir = targetPath.split('/')[0];
        if (context.directories.includes(targetDir)) {
          response.suggestion = 'y';
          response.action = 'suggest';
          response.confidence = 0.7;
          response.reasoning.push(`Target directory '${targetDir}' exists in project`);
          return response;
        }
      }
    }

    // For write operations, suggest but don't auto
    if (isWrite || isCreate) {
      response.suggestion = 'y';
      response.action = 'suggest';
      response.confidence = 0.6;
      response.reasoning.push('Write operation - suggesting approval');
      return response;
    }

    // For delete/execute, be more cautious
    if (isDelete || isExecute) {
      response.suggestion = 'n';
      response.action = 'ask_user';
      response.confidence = 0.5;
      response.reasoning.push('Destructive or executable operation - requires user decision');
      return response;
    }

    // Default for approvals
    response.suggestion = 'y';
    response.action = 'suggest';
    response.reasoning.push('General approval request');
    return response;
  }

  /**
   * Handle choice questions
   */
  handleChoice(response, parsed, context) {
    const options = parsed.options;
    const techs = parsed.technologies;

    // TypeScript vs JavaScript choice
    if (options.includes('typescript') || options.includes('ts')) {
      if (context?.hasTypeScript) {
        response.suggestion = 'typescript';
        response.action = 'auto';
        response.confidence = 0.95;
        response.reasoning.push('Project has tsconfig.json - using TypeScript');
        return response;
      } else if (context?.hasJavaScript && !context?.hasTypeScript) {
        response.suggestion = 'javascript';
        response.action = 'auto';
        response.confidence = 0.9;
        response.reasoning.push('Project uses JavaScript (no tsconfig.json)');
        return response;
      }
    }

    // Test framework choice
    if (techs.tools?.some(t => ['jest', 'mocha', 'vitest', 'pytest'].includes(t))) {
      if (context?.testFramework) {
        response.suggestion = context.testFramework;
        response.action = 'auto';
        response.confidence = 0.9;
        response.reasoning.push(`Project uses ${context.testFramework} for testing`);
        return response;
      }
    }

    // Directory choice (src vs lib, etc.)
    if (context?.directories && options.length > 0) {
      const matchingDir = options.find(opt =>
        context.directories.some(dir =>
          dir.toLowerCase() === opt.toLowerCase()
        )
      );
      if (matchingDir) {
        response.suggestion = matchingDir;
        response.action = 'suggest';
        response.confidence = 0.8;
        response.reasoning.push(`Directory '${matchingDir}' exists in project`);
        return response;
      }
    }

    // Yes/No options
    if (options.includes('y') || options.includes('yes')) {
      response.suggestion = 'y';
      response.action = 'suggest';
      response.confidence = 0.6;
      response.reasoning.push('Yes/No choice - suggesting yes');
      return response;
    }

    // If we have options but can't decide
    if (options.length > 0) {
      response.suggestion = options[0];
      response.action = 'ask_user';
      response.confidence = 0.4;
      response.reasoning.push(`Multiple options available: ${options.join(', ')}`);
      return response;
    }

    response.action = 'ask_user';
    response.reasoning.push('Could not determine best choice');
    return response;
  }

  /**
   * Handle confirmation requests
   */
  handleConfirmation(response, parsed, context) {
    // Most confirmations can be auto-approved
    const lowerText = parsed.original.toLowerCase();

    // Check for dangerous keywords
    const dangerous = /delete|remove|destroy|reset|clear all|drop|truncate/.test(lowerText);

    if (dangerous) {
      response.suggestion = 'n';
      response.action = 'ask_user';
      response.confidence = 0.7;
      response.reasoning.push('Confirmation contains potentially dangerous action');
      return response;
    }

    // Continue/proceed prompts
    if (/continue|proceed|go ahead|next|enter/.test(lowerText)) {
      response.suggestion = '';  // Just press enter
      response.action = 'auto';
      response.confidence = 0.9;
      response.reasoning.push('Simple continuation prompt');
      return response;
    }

    // Default confirmation
    response.suggestion = 'y';
    response.action = 'suggest';
    response.confidence = 0.7;
    response.reasoning.push('Standard confirmation request');
    return response;
  }

  /**
   * Handle information requests
   */
  handleInformation(response, parsed, context) {
    const lowerText = parsed.original.toLowerCase();

    // Entry point questions
    if (/entry\s*point|main\s*file/.test(lowerText)) {
      if (context?.packageJson?.main) {
        response.suggestion = context.packageJson.main;
        response.action = 'auto';
        response.confidence = 0.9;
        response.reasoning.push(`Found main entry in package.json: ${context.packageJson.main}`);
        return response;
      }
    }

    // Project name
    if (/project\s*name|app\s*name/.test(lowerText)) {
      if (context?.packageJson?.name) {
        response.suggestion = context.packageJson.name;
        response.action = 'auto';
        response.confidence = 0.9;
        response.reasoning.push(`Found name in package.json: ${context.packageJson.name}`);
        return response;
      }
    }

    // Version
    if (/version/.test(lowerText)) {
      if (context?.packageJson?.version) {
        response.suggestion = context.packageJson.version;
        response.action = 'suggest';
        response.confidence = 0.8;
        response.reasoning.push(`Found version in package.json: ${context.packageJson.version}`);
        return response;
      }
    }

    // Can't auto-answer most information requests
    response.action = 'ask_user';
    response.confidence = 0.3;
    response.reasoning.push('Information request requires user input');
    return response;
  }

  /**
   * Handle error situations
   */
  handleError(response, parsed, context) {
    const lowerText = parsed.original.toLowerCase();

    // Retry prompts
    if (/retry|try again/.test(lowerText)) {
      response.suggestion = 'y';
      response.action = 'suggest';
      response.confidence = 0.7;
      response.reasoning.push('Error with retry option');
      return response;
    }

    // General errors - notify user
    response.action = 'ask_user';
    response.confidence = 0.5;
    response.reasoning.push('Error detected - user should review');
    return response;
  }

  /**
   * Main analysis function - combines everything
   */
  analyze(text, options = {}) {
    const { projectPath, sessionHistory = [] } = options;

    // Get project context if path provided
    const projectContext = projectPath
      ? this.analyzeProjectContext(projectPath)
      : null;

    // Generate response
    const result = this.generateResponse(text, projectContext, sessionHistory);

    return {
      ...result,
      projectContext: projectContext ? {
        mainLanguage: projectContext.mainLanguage,
        framework: projectContext.framework,
        testFramework: projectContext.testFramework,
        hasTypeScript: projectContext.hasTypeScript,
      } : null,
    };
  }
}

// Singleton instance
export const smartEngine = new SmartEngine();

export default smartEngine;
