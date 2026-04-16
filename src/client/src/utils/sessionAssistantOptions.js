export const CLI_TOOLS = [
  { id: 'claude', name: 'Claude', color: 'text-orange-400', context: 'Full conversation memory via --resume' },
  { id: 'copilot', name: 'Copilot', color: 'text-blue-400', context: 'Full conversation memory via --resume' },
  { id: 'opencode', name: 'OpenCode', color: 'text-violet-400', context: 'Full conversation memory via --session' },
  { id: 'aider', name: 'Aider', color: 'text-green-400', context: 'Context from git history + repo map' },
  { id: 'gemini', name: 'Gemini', color: 'text-cyan-400', context: 'Per-message context' },
  { id: 'shell', name: 'Shell only', color: 'text-surface-400', context: 'Direct shell commands' },
];

const MODEL_OPTIONS = {
  claude: [
    { value: '', label: 'Tool default' },
    { value: 'sonnet', label: 'sonnet' },
    { value: 'opus', label: 'opus' },
    { value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
    { value: 'claude-opus-4-1', label: 'claude-opus-4-1' },
  ],
  opencode: [
    { value: '', label: 'Tool default' },
    { value: 'anthropic/claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
    { value: 'anthropic/claude-opus-4-5', label: 'claude-opus-4-5' },
    { value: 'anthropic/claude-haiku-4-5', label: 'claude-haiku-4-5' },
    { value: 'openai/gpt-4o', label: 'gpt-4o' },
    { value: 'openai/gpt-4o-mini', label: 'gpt-4o-mini' },
    { value: 'google/gemini-2-5-pro', label: 'gemini-2.5-pro' },
    { value: 'google/gemini-2-5-flash', label: 'gemini-2.5-flash' },
  ],
  copilot: [
    { value: '', label: 'Tool default' },
    { value: 'gpt-5.4', label: 'gpt-5.4' },
    { value: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
    { value: 'gpt-5.2-codex', label: 'gpt-5.2-codex' },
    { value: 'gpt-5.2', label: 'gpt-5.2' },
    { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { value: 'gpt-5-mini', label: 'gpt-5-mini' },
    { value: 'gpt-4.1', label: 'gpt-4.1' },
    { value: 'claude-sonnet-4.6', label: 'claude-sonnet-4.6' },
    { value: 'claude-sonnet-4.5', label: 'claude-sonnet-4.5' },
    { value: 'claude-haiku-4.5', label: 'claude-haiku-4.5' },
    { value: 'claude-opus-4.6', label: 'claude-opus-4.6' },
    { value: 'claude-opus-4.5', label: 'claude-opus-4.5' },
    { value: 'claude-sonnet-4', label: 'claude-sonnet-4' },
  ],
};

const EFFORT_OPTIONS = {
  claude: [
    { value: '', label: 'Default effort' },
    { value: 'low', label: 'low' },
    { value: 'medium', label: 'medium' },
    { value: 'high', label: 'high' },
    { value: 'max', label: 'max' },
  ],
  opencode: [
    { value: '', label: 'Default effort' },
    { value: 'minimal', label: 'minimal' },
    { value: 'low', label: 'low' },
    { value: 'medium', label: 'medium' },
    { value: 'high', label: 'high' },
    { value: 'max', label: 'max' },
  ],
  copilot: [
    { value: '', label: 'Default effort' },
    { value: 'low', label: 'low' },
    { value: 'medium', label: 'medium' },
    { value: 'high', label: 'high' },
    { value: 'xhigh', label: 'xhigh' },
  ],
};

export function getToolConfig(tool) {
  return CLI_TOOLS.find((item) => item.id === tool) || CLI_TOOLS[0];
}

export function supportsModelSelection(tool) {
  return Array.isArray(MODEL_OPTIONS[tool]);
}

export function supportsEffortSelection(tool) {
  return Array.isArray(EFFORT_OPTIONS[tool]);
}

export function getToolModelOptions(tool, currentValue = '') {
  const options = MODEL_OPTIONS[tool] || [];
  if (!currentValue || options.some((option) => option.value === currentValue)) {
    return options;
  }
  return [...options, { value: currentValue, label: `${currentValue} (current)` }];
}

export function getToolEffortOptions(tool) {
  return EFFORT_OPTIONS[tool] || [];
}
