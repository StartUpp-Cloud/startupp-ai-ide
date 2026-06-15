import assert from 'node:assert/strict';
import { mergeSessionAssistantSettings, resolveSessionAssistantSettings } from '../sessionSettings.js';

assert.deepEqual(
  mergeSessionAssistantSettings(
    { tool: 'opencode', model: 'openai/gpt-5.5', effort: 'high' },
    { tool: 'claude' },
  ),
  { tool: 'claude', model: null, effort: null },
  'Changing tools should clear stale model and effort when not explicitly provided',
);

assert.deepEqual(
  mergeSessionAssistantSettings(
    { tool: 'codex', model: 'gpt-5.5-pro' },
    { tool: 'claude', model: 'openai/gpt-5.5' },
  ),
  { tool: 'claude', model: null, effort: null },
  'Claude should reject provider-prefixed OpenCode/Codex models',
);

assert.deepEqual(
  resolveSessionAssistantSettings({ tool: 'claude', model: 'claude-sonnet-4-7', effort: 'high' }),
  { tool: 'claude', model: 'claude-sonnet-4-7', effort: 'high' },
  'Claude should keep compatible Claude models and effort',
);

assert.deepEqual(
  resolveSessionAssistantSettings({ tool: 'codex', model: 'openai/gpt-5.5' }),
  { tool: 'codex', model: null, effort: null },
  'Codex should reject provider-prefixed OpenCode model IDs',
);

assert.deepEqual(
  resolveSessionAssistantSettings({ tool: 'codex', model: 'gpt-5.4', effort: 'xhigh' }),
  { tool: 'codex', model: 'gpt-5.4', effort: 'xhigh' },
  'Codex should keep compatible model IDs and effort',
);

assert.deepEqual(
  resolveSessionAssistantSettings({ tool: 'codex', model: 'gpt-5.4', effort: 'max' }),
  { tool: 'codex', model: 'gpt-5.4', effort: null },
  'Codex should reject unsupported effort values',
);

assert.deepEqual(
  resolveSessionAssistantSettings({ tool: 'claude', model: 'gpt-5.5-pro' }),
  { tool: 'claude', model: null, effort: null },
  'Claude should reject stale Codex/OpenAI model IDs',
);

console.log('sessionSettings tests passed');
