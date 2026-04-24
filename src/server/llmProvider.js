/**
 * LLM Provider Service
 * Supports Ollama (local) and can be extended for OpenAI, Anthropic, etc.
 * Includes session context, security checks, and auto-response logic
 */

import { getDB } from './db.js';
import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as pty from 'node-pty';
import { sessionContext, RISK_LEVELS } from './sessionContext.js';
import { encrypt, decrypt } from './fieldEncryption.js';

const execFileAsync = promisify(execFile);

const OPENCODE_MODEL_ID_RE = /^[a-z0-9][a-z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const OPENCODE_MODELS_CACHE_TTL_MS = 10 * 60 * 1000;
const OPENCODE_MODELS_MAX_BUFFER = 1024 * 1024;

const OPENCODE_FALLBACK_MODELS = [
  'opencode/big-pickle',
  'opencode/gpt-5-nano',
  'openai/gpt-5.5-fast',
  'openai/gpt-5.5',
  'openai/gpt-5.4',
  'openai/gpt-5.4-mini',
  'deepseek/deepseek-chat',
  'deepseek/deepseek-reasoner',
];

function normalizeOpenCodeModelId(id) {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (!OPENCODE_MODEL_ID_RE.test(trimmed)) return null;
  const slashIndex = trimmed.indexOf('/');
  return {
    id: trimmed,
    name: trimmed,
    provider: trimmed.slice(0, slashIndex),
    model: trimmed.slice(slashIndex + 1),
  };
}

function parseOpenCodeModels(raw) {
  const seen = new Set();
  const models = [];

  for (const line of String(raw || '').split(/\r?\n/)) {
    const firstToken = line.trim().split(/\s+/)[0];
    const model = normalizeOpenCodeModelId(firstToken);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }

  return models;
}

function fallbackOpenCodeModels() {
  return OPENCODE_FALLBACK_MODELS.map(normalizeOpenCodeModelId).filter(Boolean);
}

function parseOpenCodeRunOutput(raw) {
  const textParts = [];
  const errorParts = [];
  let tokensUsed = null;

  for (const line of String(raw || '').split(/\r?\n/)) {
    const jsonStart = line.indexOf('{');
    const trimmed = jsonStart >= 0 ? line.slice(jsonStart).trim() : line.trim();
    if (!trimmed.startsWith('{')) continue;

    try {
      const event = JSON.parse(trimmed);
      if (event.type === 'text' && typeof event.part?.text === 'string') {
        textParts.push(event.part.text);
      } else if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
        textParts.push(event.item.text);
      } else if (event.type === 'step_finish' && event.part?.tokens?.total) {
        tokensUsed = event.part.tokens.total;
      }

      if (event.type === 'error' || event.part?.type === 'error' || event.error) {
        const message = event.error?.data?.message
          || event.error?.message
          || (typeof event.error === 'string' ? event.error : '')
          || event.part?.message
          || event.message;
        if (message) errorParts.push(message);
      }
    } catch {
      // Ignore non-JSON progress lines from older OpenCode versions.
    }
  }

  return { response: textParts.join('').trim(), tokensUsed, error: errorParts.join('\n').trim() };
}

function runOpenCodePty(args, { timeout, cwd } = {}) {
  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    const ptyProcess = pty.spawn('opencode', args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: cwd || process.cwd(),
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      },
    });

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ptyProcess.kill(); } catch { /* already exited */ }
      reject(new Error('OpenCode request timed out'));
    }, timeout || 60000);

    ptyProcess.onData((data) => {
      output += data;
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (exitCode !== 0) {
        reject(new Error(`OpenCode exited with code ${exitCode}`));
        return;
      }
      resolve(output);
    });
  });
}

// Default LLM settings
const DEFAULT_LLM_SETTINGS = {
  enabled: false,
  provider: 'ollama',
  ollama: {
    endpoint: 'http://localhost:11434',
    model: 'llama3.2',
    timeout: 30000,
  },
  openai: {
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: '', // User must provide
    timeout: 30000,
  },
  deepseek: {
    endpoint: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    apiKey: '', // User must provide
    timeout: 60000, // DeepSeek can be slower
  },
  github: {
    endpoint: 'https://models.github.ai/inference',
    model: 'openai/gpt-4o-mini', // Free with Copilot subscription. Options: openai/gpt-4o-mini, openai/gpt-4o, meta-llama/Llama-4-Scout-17B-16E-Instruct
    apiKey: '', // GitHub Personal Access Token (PAT) with copilot scope
    timeout: 30000,
  },
  opencode: {
    model: 'openai/gpt-5.5-fast',
    timeout: 60000,
  },
  // When to use LLM
  useForLowConfidence: true,
  confidenceThreshold: 0.5, // Use LLM when smart engine confidence is below this
  useForUnknownIntent: true,
  useForInformationRequests: true,
  // Auto-response settings
  autoRespondThreshold: 0.9, // Auto-respond when confidence >= 90%
  autoRespondEnabled: true,
  // Security settings
  requireConfirmationForHighRisk: true,
  createRollbackPoints: true,
  blockCriticalWithoutConfirm: true,
  // Response settings
  maxTokens: 150,
  temperature: 0.3, // Low temperature for more deterministic responses
};

// System prompt for the LLM to understand its role
const SYSTEM_PROMPT = `You are an intelligent assistant integrated into an AI Prompt IDE. Your role is to respond to prompts from AI CLI tools (Claude Code, GitHub Copilot, Aider) on behalf of the developer.

## Your Core Mission
Help the developer by providing quick, accurate responses to AI CLI questions so they can focus on reviewing results rather than answering routine prompts.

## Response Format Rules
CRITICAL: Respond with ONLY the exact text to send to the terminal. No explanations, no markdown, no quotes around the response.

- Yes/No questions → "y" or "n"
- Choice questions → Just the chosen option (e.g., "typescript" not "I choose typescript")
- Continue prompts → Empty string or "y"
- Path questions → The actual path (e.g., "src/components")
- Name questions → The actual name (e.g., "UserService")

## Decision-Making Guidelines

### When to say YES (approve):
- Reading files (always safe)
- Writing to files that align with the current task
- Creating new files in appropriate directories
- Running tests, linting, or build commands
- Git commits with clear messages
- Installing dependencies that match the project stack

### When to say NO (reject):
- Operations that don't match the project's language/framework
- Deleting critical files (package.json, tsconfig.json, etc.)
- Force pushing to main/master
- Operations outside the project directory
- Installing suspicious or unnecessary packages

### When to DEFER to user (respond with special marker):
If you're uncertain or the operation seems risky, respond with: [NEEDS_USER_CONFIRMATION]
This will alert the user to make the decision themselves.

## Security Awareness
- Never approve operations that could expose credentials
- Be cautious with rm -rf, git reset --hard, force push
- Prefer reversible operations over destructive ones
- Consider if there's a rollback path

## Using Context
You'll receive context about:
- The project (name, language, framework, file structure)
- Recent conversation history (what the AI has been doing)
- Project rules defined by the developer
- The CLAUDE.md file if present (developer's preferences)

Use this context to make informed decisions that align with the project's patterns and the developer's preferences.`;

// Build the full system prompt with all context
function buildFullSystemPrompt(context) {
  let prompt = SYSTEM_PROMPT;

  // Add project context
  if (context.projectName) {
    prompt += `\n\n## Current Project: ${context.projectName}`;
    if (context.projectDescription) {
      prompt += `\nDescription: ${context.projectDescription}`;
    }
  }

  // Add technical context
  if (context.projectContext) {
    prompt += `\n\n## Technical Context
- Main language: ${context.projectContext.mainLanguage || 'unknown'}
- Framework: ${context.projectContext.framework || 'none detected'}
- TypeScript: ${context.projectContext.hasTypeScript ? 'yes' : 'no'}
- Test framework: ${context.projectContext.testFramework || 'none detected'}`;
  }

  // Add git status
  if (context.gitStatus) {
    prompt += `\n\n## Git Status
- Branch: ${context.gitStatus.branch}
- Last commit: ${context.gitStatus.lastCommit}
- Working tree: ${context.gitStatus.clean ? 'clean' : `${context.gitStatus.modified} modified, ${context.gitStatus.added} added, ${context.gitStatus.deleted} deleted`}`;
  }

  // Add file tree (condensed)
  if (context.fileTree) {
    const treePreview = context.fileTree.split('\n').slice(0, 30).join('\n');
    prompt += `\n\n## Project Structure\n\`\`\`\n${treePreview}\n\`\`\``;
  }

  // Add CLAUDE.md content (developer preferences)
  if (context.claudeMd) {
    prompt += `\n\n## Developer Preferences (from CLAUDE.md)\n${context.claudeMd.slice(0, 2000)}`;
  }

  // Add project rules
  if (context.promptRules && context.promptRules.length > 0) {
    prompt += `\n\n## Project Rules\n${context.promptRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
  }

  // Add global rules
  if (context.globalRules && context.globalRules.length > 0) {
    prompt += `\n\n## Global Rules\n${context.globalRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
  }

  // Add recent history
  if (context.recentHistory) {
    prompt += `\n\n## Recent Conversation\n${context.recentHistory}`;
  }

  // Add CLI tool context
  if (context.cliTool) {
    prompt += `\n\n## Active CLI: ${context.cliTool}`;
  }

  return prompt;
}

class LLMProvider extends EventEmitter {
  constructor() {
    super();
    this.settings = { ...DEFAULT_LLM_SETTINGS };
    this.available = false;
    this.lastHealthCheck = null;
  }

  /**
   * Initialize LLM provider with settings from database
   */
  async init() {
    const db = getDB();

    if (!db.data.llmSettings) {
      db.data.llmSettings = { ...DEFAULT_LLM_SETTINGS };
      await db.write();
    }

    this.settings = { ...DEFAULT_LLM_SETTINGS, ...db.data.llmSettings };
    this.settings.ollama = { ...DEFAULT_LLM_SETTINGS.ollama, ...(this.settings.ollama || {}) };
    this.settings.openai = { ...DEFAULT_LLM_SETTINGS.openai, ...(this.settings.openai || {}) };
    this.settings.deepseek = { ...DEFAULT_LLM_SETTINGS.deepseek, ...(this.settings.deepseek || {}) };
    this.settings.github = { ...DEFAULT_LLM_SETTINGS.github, ...(this.settings.github || {}) };
    this.settings.opencode = { ...DEFAULT_LLM_SETTINGS.opencode, ...(this.settings.opencode || {}) };

    // Decrypt API keys loaded from disk
    if (this.settings.openai?.apiKey) this.settings.openai.apiKey = decrypt(this.settings.openai.apiKey);
    if (this.settings.deepseek?.apiKey) this.settings.deepseek.apiKey = decrypt(this.settings.deepseek.apiKey);
    if (this.settings.github?.apiKey) this.settings.github.apiKey = decrypt(this.settings.github.apiKey);

    // Check if provider is available
    if (this.settings.enabled) {
      await this.checkHealth();
    }

    console.log(`LLM Provider initialized (enabled: ${this.settings.enabled}, provider: ${this.settings.provider})`);
  }

  /**
   * Get current settings (API keys masked for frontend display).
   */
  getSettings() {
    const s = JSON.parse(JSON.stringify(this.settings));
    // Mask API keys — show only last 4 chars for identification
    if (s.openai?.apiKey) s.openai.apiKey = s.openai.apiKey.length > 4 ? '••••' + s.openai.apiKey.slice(-4) : s.openai.apiKey;
    if (s.deepseek?.apiKey) s.deepseek.apiKey = s.deepseek.apiKey.length > 4 ? '••••' + s.deepseek.apiKey.slice(-4) : s.deepseek.apiKey;
    if (s.github?.apiKey) s.github.apiKey = s.github.apiKey.length > 4 ? '••••' + s.github.apiKey.slice(-4) : s.github.apiKey;
    return s;
  }

  /**
   * Update settings
   */
  async updateSettings(updates) {
    const db = getDB();

    this.settings = {
      ...this.settings,
      ...updates,
      ollama: { ...this.settings.ollama, ...updates.ollama },
      openai: { ...this.settings.openai, ...updates.openai },
      deepseek: { ...this.settings.deepseek, ...updates.deepseek },
      github: { ...this.settings.github, ...updates.github },
      opencode: { ...this.settings.opencode, ...updates.opencode },
    };

    // Write encrypted copy to disk — never store plaintext API keys in db.json
    const toSave = JSON.parse(JSON.stringify(this.settings));
    if (toSave.openai?.apiKey) toSave.openai.apiKey = encrypt(toSave.openai.apiKey);
    if (toSave.deepseek?.apiKey) toSave.deepseek.apiKey = encrypt(toSave.deepseek.apiKey);
    if (toSave.github?.apiKey) toSave.github.apiKey = encrypt(toSave.github.apiKey);
    db.data.llmSettings = toSave;
    await db.write();

    // Re-check health if provider changed or enabled
    if (this.settings.enabled) {
      await this.checkHealth();
    }

    return this.settings;
  }

  /**
   * Check if LLM should be used based on smart engine result
   */
  shouldUseLLM(smartEngineResult) {
    if (!this.settings.enabled || !this.available) {
      return false;
    }

    // No smart engine result - use LLM for unknown
    if (!smartEngineResult) {
      return this.settings.useForUnknownIntent;
    }

    // Low confidence
    if (
      this.settings.useForLowConfidence &&
      smartEngineResult.confidence < this.settings.confidenceThreshold
    ) {
      return true;
    }

    // Unknown intent
    if (this.settings.useForUnknownIntent && smartEngineResult.intent === 'unknown') {
      return true;
    }

    // Information requests (hard to answer without context)
    if (
      this.settings.useForInformationRequests &&
      smartEngineResult.intent === 'information'
    ) {
      return true;
    }

    return false;
  }

  /**
   * Generate a response using the configured LLM
   */
  async generateResponse(prompt, context = {}) {
    if (!this.settings.enabled) {
      throw new Error('LLM is not enabled');
    }

    if (!this.available) {
      throw new Error('LLM is not available');
    }

    const provider = this.settings.provider;

    switch (provider) {
      case 'ollama':
        return this.generateOllamaResponse(prompt, context);
      case 'openai':
        return this.generateOpenAIResponse(prompt, context);
      case 'deepseek':
        return this.generateDeepSeekResponse(prompt, context);
      case 'github':
        return this.generateGitHubResponse(prompt, context);
      case 'opencode':
        return this.generateOpenCodeResponse(prompt, context);
      default:
        throw new Error(`Unknown LLM provider: ${provider}`);
    }
  }

  /**
   * Generate response using Ollama
   */
  async generateOllamaResponse(prompt, context) {
    const { endpoint, model, timeout } = this.settings.ollama;

    const systemPrompt = context.systemPrompt || this.buildSystemPrompt(context);
    const userPrompt = context.systemPrompt ? prompt : this.buildUserPrompt(prompt, context);
    const maxTokens = context.maxTokens || this.settings.maxTokens;
    const temperature = context.temperature ?? this.settings.temperature;
    const useChat = !!context.systemPrompt; // Use chat API for custom prompts (works with all modern models)

    const controller = new AbortController();
    const effectiveTimeout = maxTokens > 1000 ? timeout * 4 : timeout;
    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

    try {
      let data;

      if (useChat) {
        // Use /api/chat for custom system prompts — works with chat-tuned models like qwen3.5
        const response = await fetch(`${endpoint}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            stream: false,
            options: {
              temperature,
              num_predict: maxTokens,
            },
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Ollama error: ${error}`);
        }

        data = await response.json();
        const content = data.message?.content || '';

        return {
          response: content.trim(),
          provider: 'ollama',
          model,
          tokensUsed: data.eval_count,
          duration: data.total_duration,
        };
      } else {
        // Use /api/generate for auto-responder (backward-compatible)
        const response = await fetch(`${endpoint}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            prompt: userPrompt,
            system: systemPrompt,
            stream: false,
            options: {
              temperature,
              num_predict: maxTokens,
            },
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Ollama error: ${error}`);
        }

        data = await response.json();

        return {
          response: this.cleanResponse(data.response),
          provider: 'ollama',
          model,
          tokensUsed: data.eval_count,
          duration: data.total_duration,
        };
      }
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Ollama request timed out (${effectiveTimeout / 1000}s). The model may be too slow for this request. Try a smaller model or increase the timeout.`);
      }
      throw error;
    }
  }

  /**
   * Generate response using OpenAI-compatible API
   */
  async generateOpenAIResponse(prompt, context) {
    const { endpoint, model, apiKey, timeout } = this.settings.openai;

    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const systemPrompt = context.systemPrompt || this.buildSystemPrompt(context);
    const userPrompt = context.systemPrompt ? prompt : this.buildUserPrompt(prompt, context);
    const maxTokens = context.maxTokens || this.settings.maxTokens;
    const temperature = context.temperature ?? this.settings.temperature;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), maxTokens > 1000 ? timeout * 3 : timeout);

    try {
      const response = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: maxTokens,
          temperature,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`OpenAI error: ${error.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();
      const rawContent = data.choices[0]?.message?.content || '';
      const generatedResponse = context.systemPrompt ? rawContent.trim() : this.cleanResponse(rawContent);

      return {
        response: generatedResponse,
        provider: 'openai',
        model,
        tokensUsed: data.usage?.total_tokens,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('OpenAI request timed out');
      }
      throw error;
    }
  }

  /**
   * Generate response using DeepSeek API (OpenAI-compatible)
   */
  async generateDeepSeekResponse(prompt, context) {
    const { endpoint, model, apiKey, timeout } = this.settings.deepseek;

    if (!apiKey) {
      throw new Error('DeepSeek API key not configured');
    }

    const systemPrompt = context.systemPrompt || this.buildSystemPrompt(context);
    const userPrompt = context.systemPrompt ? prompt : this.buildUserPrompt(prompt, context);
    const maxTokens = context.maxTokens || this.settings.maxTokens;
    const temperature = context.temperature ?? this.settings.temperature;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), maxTokens > 1000 ? timeout * 3 : timeout);

    try {
      const response = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: maxTokens,
          temperature,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`DeepSeek error: ${error.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();
      const rawContent = data.choices[0]?.message?.content || '';
      const generatedResponse = context.systemPrompt ? rawContent.trim() : this.cleanResponse(rawContent);

      return {
        response: generatedResponse,
        provider: 'deepseek',
        model,
        tokensUsed: data.usage?.total_tokens,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('DeepSeek request timed out');
      }
      throw error;
    }
  }

  /**
   * Generate response using GitHub Models API (free with Copilot subscription).
   * Uses the OpenAI-compatible chat completions endpoint.
   */
  async generateGitHubResponse(prompt, context) {
    const { endpoint, model, apiKey, timeout } = this.settings.github;

    if (!apiKey) {
      throw new Error('GitHub token not configured. Go to LLM Settings and add a GitHub PAT with "copilot" scope.');
    }

    const systemPrompt = context.systemPrompt || this.buildSystemPrompt(context);
    const userPrompt = context.systemPrompt ? prompt : this.buildUserPrompt(prompt, context);
    const maxTokens = context.maxTokens || this.settings.maxTokens;
    const temperature = context.temperature ?? this.settings.temperature;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), maxTokens > 1000 ? timeout * 3 : timeout);

    try {
      const response = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: maxTokens,
          temperature,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: `HTTP ${response.status}` } }));
        throw new Error(`GitHub Models error: ${error.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();
      const rawContent = data.choices[0]?.message?.content || '';
      const generatedResponse = context.systemPrompt ? rawContent.trim() : this.cleanResponse(rawContent);

      return {
        response: generatedResponse,
        provider: 'github',
        model,
        tokensUsed: data.usage?.total_tokens,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('GitHub Models request timed out');
      }
      throw error;
    }
  }

  /**
   * Generate response using the authenticated OpenCode CLI.
   * This lets users reuse the subscriptions/accounts already connected to OpenCode.
   */
  async generateOpenCodeResponse(prompt, context) {
    const { model, timeout } = this.settings.opencode;

    const systemPrompt = context.systemPrompt || this.buildSystemPrompt(context);
    const userPrompt = context.systemPrompt ? prompt : this.buildUserPrompt(prompt, context);
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
    const args = ['run', fullPrompt, '--format', 'json', '--dangerously-skip-permissions'];
    if (model) args.push('--model', model);

    try {
      const stdout = await runOpenCodePty(args, { timeout: timeout || 60000 });

      const { response, tokensUsed, error } = parseOpenCodeRunOutput(stdout);
      if (error) {
        throw new Error(error);
      }
      if (!response) {
        throw new Error('OpenCode returned no text response');
      }

      return {
        response: context.systemPrompt ? response : this.cleanResponse(response),
        provider: 'opencode',
        model: model || 'default',
        tokensUsed,
      };
    } catch (error) {
      throw new Error(`OpenCode error: ${error.message}`);
    }
  }

  /**
   * Build system prompt with context
   */
  buildSystemPrompt(context) {
    return buildFullSystemPrompt(context);
  }

  /**
   * Build user prompt
   */
  buildUserPrompt(prompt, context) {
    let userPrompt = `## Current Question\nThe AI CLI is asking:\n"${prompt}"\n`;

    if (context.intent) {
      userPrompt += `\nDetected intent: ${context.intent}`;
    }

    if (context.options && context.options.length > 0) {
      userPrompt += `\nAvailable options: ${context.options.join(', ')}`;
    }

    if (context.reasoning && context.reasoning.length > 0) {
      userPrompt += `\nSmart engine analysis: ${context.reasoning.join('; ')}`;
    }

    // Add security assessment
    if (context.riskAssessment) {
      userPrompt += `\n\n## Security Assessment`;
      userPrompt += `\nRisk level: ${context.riskAssessment.level.toUpperCase()}`;
      if (context.riskAssessment.reasons.length > 0) {
        userPrompt += `\nConcerns: ${context.riskAssessment.reasons.join(', ')}`;
      }
      if (context.riskAssessment.requiresConfirmation) {
        userPrompt += `\n⚠️ This operation may require user confirmation.`;
      }
    }

    userPrompt += '\n\nRespond with ONLY the exact text to send (no quotes, no explanation):';

    return userPrompt;
  }

  /**
   * Check if response should be auto-sent based on confidence
   */
  shouldAutoRespond(confidence, riskLevel) {
    if (!this.settings.autoRespondEnabled) {
      return false;
    }

    // Never auto-respond to high-risk operations
    if (riskLevel === RISK_LEVELS.HIGH || riskLevel === RISK_LEVELS.CRITICAL) {
      return false;
    }

    // Auto-respond if confidence meets threshold
    return confidence >= this.settings.autoRespondThreshold;
  }

  /**
   * Check if operation requires user confirmation due to security
   */
  requiresSecurityConfirmation(riskLevel) {
    if (this.settings.blockCriticalWithoutConfirm && riskLevel === RISK_LEVELS.CRITICAL) {
      return true;
    }
    if (this.settings.requireConfirmationForHighRisk && riskLevel === RISK_LEVELS.HIGH) {
      return true;
    }
    return false;
  }

  /**
   * Generate response with full context and security checks
   */
  async generateResponseWithContext(prompt, sessionId, smartEngineResult = null) {
    // Get full session context
    const sessionCtx = sessionContext.buildLLMContext(sessionId);

    // Assess security risk
    const riskAssessment = sessionContext.assessRisk(prompt);

    // Build enhanced context
    const context = {
      ...sessionCtx,
      intent: smartEngineResult?.intent,
      options: smartEngineResult?.parsed?.options,
      reasoning: smartEngineResult?.reasoning,
      projectContext: smartEngineResult?.projectContext || sessionCtx,
      riskAssessment,
    };

    // Check if this requires user confirmation
    if (this.requiresSecurityConfirmation(riskAssessment.level)) {
      return {
        response: null,
        requiresConfirmation: true,
        riskAssessment,
        reason: `This operation has been flagged as ${riskAssessment.level} risk: ${riskAssessment.reasons.join(', ')}`,
      };
    }

    // Create rollback point if enabled and operation is not safe
    if (this.settings.createRollbackPoints && riskAssessment.level !== RISK_LEVELS.SAFE) {
      sessionContext.createRollbackPoint(sessionId, `Before: ${prompt.slice(0, 50)}...`);
    }

    // Generate the response
    const result = await this.generateResponse(prompt, context);

    // Check for special markers
    if (result.response === '[NEEDS_USER_CONFIRMATION]') {
      return {
        response: null,
        requiresConfirmation: true,
        riskAssessment,
        reason: 'LLM indicated this decision should be made by the user',
      };
    }

    // Determine if we should auto-respond
    const confidence = smartEngineResult?.confidence || 0.5;
    const shouldAuto = this.shouldAutoRespond(confidence, riskAssessment.level);

    // Record in history
    sessionContext.addResponse(sessionId, {
      prompt,
      response: result.response,
      wasAuto: shouldAuto,
      confidence,
      reasoning: smartEngineResult?.reasoning,
    });

    return {
      ...result,
      shouldAutoRespond: shouldAuto,
      riskAssessment,
      confidence,
    };
  }

  /**
   * Clean and normalize the LLM response
   */
  cleanResponse(response) {
    if (!response) return '';

    // Strip <think>...</think> blocks from reasoning models (qwen3.5, deepseek-r1, etc.)
    let cleaned = response.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    // Strip any other XML-like tags models might emit
    cleaned = cleaned.replace(/<\/?[a-z][a-z0-9_-]*>/gi, '').trim();

    // Strip markdown code block wrappers
    cleaned = cleaned.replace(/^```[\w]*\n?/gm, '').replace(/\n?```$/gm, '').trim();

    // Remove quotes if the response is wrapped in them
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
        (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
      cleaned = cleaned.slice(1, -1);
    }

    // Remove common prefixes LLMs might add
    const prefixes = [
      'Response: ', 'Answer: ', 'Output: ', 'Send: ', 'Reply: ',
      'Sure, ', 'Here is ', 'The response is: ', 'I would respond with: ',
    ];
    for (const prefix of prefixes) {
      if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
        cleaned = cleaned.slice(prefix.length);
      }
    }

    // For auto-responder: only take the first line if it looks like the model added explanation
    // (a single y/n followed by explanation lines)
    const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      const firstWord = lines[0].toLowerCase();
      if (['y', 'n', 'yes', 'no'].includes(firstWord)) {
        cleaned = lines[0];
      }
    }

    cleaned = cleaned.trim();

    // Normalize yes/no responses
    const lowerCleaned = cleaned.toLowerCase();
    if (['yes', 'yeah', 'yep', 'affirmative', 'correct', 'true', 'sure', 'ok', 'okay', 'approve'].includes(lowerCleaned)) {
      return 'y';
    }
    if (['no', 'nope', 'negative', 'false', 'deny', 'reject', 'decline'].includes(lowerCleaned)) {
      return 'n';
    }

    return cleaned;
  }

  /**
   * Check health of the current provider
   */
  async checkHealth() {
    const provider = this.settings.provider;

    switch (provider) {
      case 'ollama':
        return this.checkOllamaHealth();
      case 'openai':
        return this.checkOpenAIHealth();
      case 'deepseek':
        return this.checkDeepSeekHealth();
      case 'github':
        return this.checkGitHubHealth();
      case 'opencode':
        return this.checkOpenCodeHealth();
      default:
        this.available = false;
        return { available: false, error: `Unknown provider: ${provider}` };
    }
  }

  /**
   * Check if the OpenCode CLI is available and can list models.
   */
  async checkOpenCodeHealth() {
    const models = await this.getOpenCodeModels({ allowFallback: false });
    const hasModels = models.length > 0;
    this.available = hasModels;
    this.lastHealthCheck = hasModels
      ? { available: true, provider: 'opencode', model: this.settings.opencode.model, models: models.map(m => m.name) }
      : { available: false, error: 'OpenCode CLI unavailable or returned no models' };
    return this.lastHealthCheck;
  }

  /**
   * Check if GitHub Models API is available
   */
  async checkGitHubHealth() {
    const { endpoint, apiKey } = this.settings.github;

    if (!apiKey) {
      this.available = false;
      return { available: false, error: 'GitHub token not configured' };
    }

    try {
      const response = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.settings.github.model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        this.available = true;
        return { available: true, provider: 'github', model: this.settings.github.model };
      }

      const error = await response.json().catch(() => ({}));
      this.available = false;
      return { available: false, error: error.error?.message || `HTTP ${response.status}` };
    } catch (error) {
      this.available = false;
      return { available: false, error: error.message };
    }
  }

  /**
   * Check if Ollama is available
   */
  async checkOllamaHealth() {
    const { endpoint, model } = this.settings.ollama;

    try {
      // Check if Ollama is running
      const response = await fetch(`${endpoint}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        this.available = false;
        this.lastHealthCheck = { available: false, error: 'Ollama not responding' };
        return this.lastHealthCheck;
      }

      const data = await response.json();
      const models = data.models || [];
      const hasModel = models.some(m => m.name === model || m.name.startsWith(`${model}:`));

      this.available = hasModel;
      this.lastHealthCheck = {
        available: hasModel,
        models: models.map(m => m.name),
        selectedModel: model,
        hasSelectedModel: hasModel,
        error: hasModel ? null : `Model "${model}" not found. Available: ${models.map(m => m.name).join(', ')}`,
      };

      if (!hasModel) {
        console.warn(`Ollama model "${model}" not found. Available models:`, models.map(m => m.name));
      }

      return this.lastHealthCheck;
    } catch (error) {
      this.available = false;
      this.lastHealthCheck = {
        available: false,
        error: `Cannot connect to Ollama at ${endpoint}: ${error.message}`,
      };
      return this.lastHealthCheck;
    }
  }

  /**
   * Check if OpenAI is available (just validates API key format)
   */
  async checkOpenAIHealth() {
    const { apiKey } = this.settings.openai;

    if (!apiKey) {
      this.available = false;
      this.lastHealthCheck = { available: false, error: 'OpenAI API key not configured' };
      return this.lastHealthCheck;
    }

    // Basic format check
    if (!apiKey.startsWith('sk-')) {
      this.available = false;
      this.lastHealthCheck = { available: false, error: 'Invalid OpenAI API key format' };
      return this.lastHealthCheck;
    }

    // We don't want to make a real API call just to check health
    // Assume it's available if the key looks valid
    this.available = true;
    this.lastHealthCheck = { available: true, provider: 'openai' };
    return this.lastHealthCheck;
  }

  /**
   * Check if DeepSeek is available
   */
  async checkDeepSeekHealth() {
    const { apiKey } = this.settings.deepseek;

    if (!apiKey) {
      this.available = false;
      this.lastHealthCheck = { available: false, error: 'DeepSeek API key not configured' };
      return this.lastHealthCheck;
    }

    // DeepSeek API keys start with 'sk-'
    if (!apiKey.startsWith('sk-')) {
      this.available = false;
      this.lastHealthCheck = { available: false, error: 'Invalid DeepSeek API key format' };
      return this.lastHealthCheck;
    }

    // Assume it's available if the key looks valid
    this.available = true;
    this.lastHealthCheck = { available: true, provider: 'deepseek' };
    return this.lastHealthCheck;
  }

  /**
   * Get list of available Ollama models
   */
  async getOllamaModels() {
    const { endpoint } = this.settings.ollama;

    try {
      const response = await fetch(`${endpoint}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return (data.models || []).map(m => ({
        name: m.name,
        size: m.size,
        modified: m.modified_at,
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Get model IDs reported by the authenticated OpenCode CLI.
   */
  async getOpenCodeModels({ refresh = false, allowFallback = true } = {}) {
    const now = Date.now();
    if (!refresh && this.openCodeModelsCache && now - this.openCodeModelsCache.fetchedAt < OPENCODE_MODELS_CACHE_TTL_MS) {
      return this.openCodeModelsCache.models;
    }

    try {
      const { stdout } = await execFileAsync('opencode', ['models'], {
        encoding: 'utf-8',
        timeout: 8000,
        maxBuffer: OPENCODE_MODELS_MAX_BUFFER,
        windowsHide: true,
      });

      const models = parseOpenCodeModels(stdout);
      if (models.length > 0) {
        this.openCodeModelsCache = { models, fetchedAt: now };
        return models;
      }
    } catch (error) {
      console.warn('[llmProvider] OpenCode model discovery failed:', error.message);
    }

    return this.openCodeModelsCache?.models || (allowFallback ? fallbackOpenCodeModels() : []);
  }

  /**
   * Pull a model in Ollama
   */
  async pullOllamaModel(modelName) {
    const { endpoint } = this.settings.ollama;

    const response = await fetch(`${endpoint}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: false }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to pull model: ${error}`);
    }

    return await response.json();
  }

  /**
   * Test the LLM with a sample prompt
   */
  async testConnection() {
    if (this.settings.provider === 'opencode') {
      const health = await this.checkOpenCodeHealth();
      if (!health.available) {
        throw new Error(health.error || 'OpenCode CLI unavailable');
      }
    }

    const testPrompt = 'Continue with the changes? [Y/n]';
    const result = await this.generateResponse(testPrompt, {
      intent: 'confirmation',
      options: ['y', 'n'],
    });

    return {
      success: true,
      response: result.response,
      provider: result.provider,
      model: result.model,
    };
  }
}

// Singleton instance
export const llmProvider = new LLMProvider();

export default llmProvider;
