export const CLI_TOOLS = [
  { id: 'claude', name: 'Claude', color: 'text-orange-400', context: 'Full conversation memory via --resume' },
  { id: 'copilot', name: 'Copilot', color: 'text-blue-400', context: 'Full conversation memory via --resume' },
  { id: 'opencode', name: 'OpenCode', color: 'text-violet-400', context: 'Full conversation memory via --session' },
  { id: 'codex', name: 'Codex', color: 'text-emerald-400', context: 'Full conversation memory via exec resume' },
  { id: 'aider', name: 'Aider', color: 'text-green-400', context: 'Context from git history + repo map' },
  { id: 'gemini', name: 'Gemini', color: 'text-cyan-400', context: 'Per-message context' },
  { id: 'shell', name: 'Shell only', color: 'text-surface-400', context: 'Direct shell commands' },
];

const MODEL_OPTIONS = {
  claude: [
    { value: '', label: 'Tool default' },
    { value: 'claude-opus-4-7', label: 'claude-opus-4-7 (latest)' },
    { value: 'claude-sonnet-4-7', label: 'claude-sonnet-4-7' },
    { value: 'claude-opus-4-6', label: 'claude-opus-4-6' },
    { value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
    { value: 'claude-haiku-4-6', label: 'claude-haiku-4-6' },
    { value: 'claude-opus-4-5', label: 'claude-opus-4-5' },
    { value: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
    { value: 'claude-haiku-4-5', label: 'claude-haiku-4-5' },
    { value: 'claude-opus-4-1', label: 'claude-opus-4-1' },
    { value: 'opus', label: 'opus (alias)' },
    { value: 'sonnet', label: 'sonnet (alias)' },
  ],
  opencode: [
    { value: '', label: 'Tool default' },
    // Anthropic
    { value: 'anthropic/claude-opus-4-7', label: 'claude-opus-4-7 (latest)' },
    { value: 'anthropic/claude-opus-4-6', label: 'claude-opus-4-6' },
    { value: 'anthropic/claude-opus-4-6-fast', label: 'claude-opus-4-6-fast' },
    { value: 'anthropic/claude-opus-4-5', label: 'claude-opus-4-5' },
    { value: 'anthropic/claude-opus-4-1', label: 'claude-opus-4-1' },
    { value: 'anthropic/claude-opus-4-0', label: 'claude-opus-4-0' },
    { value: 'anthropic/claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
    { value: 'anthropic/claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
    { value: 'anthropic/claude-sonnet-4-0', label: 'claude-sonnet-4-0' },
    { value: 'anthropic/claude-haiku-4-5', label: 'claude-haiku-4-5' },
    { value: 'anthropic/claude-3-7-sonnet-20250219', label: 'claude-3.7-sonnet' },
    { value: 'anthropic/claude-3-5-sonnet-20241022', label: 'claude-3.5-sonnet' },
    { value: 'anthropic/claude-3-5-haiku-latest', label: 'claude-3.5-haiku' },
    // GitHub Copilot
    { value: 'github-copilot/claude-opus-4.7', label: 'copilot/claude-opus-4.7' },
    { value: 'github-copilot/claude-opus-4.6', label: 'copilot/claude-opus-4.6' },
    { value: 'github-copilot/claude-opus-4.5', label: 'copilot/claude-opus-4.5' },
    { value: 'github-copilot/claude-sonnet-4.6', label: 'copilot/claude-sonnet-4.6' },
    { value: 'github-copilot/claude-sonnet-4.5', label: 'copilot/claude-sonnet-4.5' },
    { value: 'github-copilot/claude-sonnet-4', label: 'copilot/claude-sonnet-4' },
    { value: 'github-copilot/claude-haiku-4.5', label: 'copilot/claude-haiku-4.5' },
    { value: 'github-copilot/gpt-5.4', label: 'copilot/gpt-5.4' },
    { value: 'github-copilot/gpt-5.4-mini', label: 'copilot/gpt-5.4-mini' },
    { value: 'github-copilot/gpt-5.3-codex', label: 'copilot/gpt-5.3-codex' },
    { value: 'github-copilot/gpt-5.2-codex', label: 'copilot/gpt-5.2-codex' },
    { value: 'github-copilot/gpt-5.2', label: 'copilot/gpt-5.2' },
    { value: 'github-copilot/gpt-5-mini', label: 'copilot/gpt-5-mini' },
    { value: 'github-copilot/gpt-4.1', label: 'copilot/gpt-4.1' },
    { value: 'github-copilot/gpt-4o', label: 'copilot/gpt-4o' },
    { value: 'github-copilot/gemini-2.5-pro', label: 'copilot/gemini-2.5-pro' },
    { value: 'github-copilot/gemini-3.1-pro-preview', label: 'copilot/gemini-3.1-pro' },
    { value: 'github-copilot/gemini-3-flash-preview', label: 'copilot/gemini-3-flash' },
    { value: 'github-copilot/grok-code-fast-1', label: 'copilot/grok-code-fast-1' },
    // OpenAI
    { value: 'openai/gpt-5.4', label: 'gpt-5.4' },
    { value: 'openai/gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { value: 'openai/gpt-5.3-codex', label: 'gpt-5.3-codex' },
    { value: 'openai/gpt-5.2-codex', label: 'gpt-5.2-codex' },
    { value: 'openai/gpt-5.2', label: 'gpt-5.2' },
    { value: 'openai/gpt-5.1', label: 'gpt-5.1' },
    { value: 'openai/gpt-5-mini', label: 'gpt-5-mini' },
    { value: 'openai/gpt-4.1', label: 'gpt-4.1' },
    { value: 'openai/gpt-4o', label: 'gpt-4o' },
    { value: 'openai/o3', label: 'o3' },
    { value: 'openai/o4-mini', label: 'o4-mini' },
    // DeepSeek
    { value: 'deepseek/deepseek-chat', label: 'deepseek-chat' },
    { value: 'deepseek/deepseek-reasoner', label: 'deepseek-reasoner' },
    // OpenCode native
    { value: 'opencode/big-pickle', label: 'opencode/big-pickle' },
    { value: 'opencode/gpt-5-nano', label: 'opencode/gpt-5-nano' },
  ],
  codex: [
    { value: '', label: 'Tool default' },
    { value: 'gpt-5.4', label: 'gpt-5.4' },
    { value: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
    { value: 'gpt-5.2-codex', label: 'gpt-5.2-codex' },
    { value: 'gpt-5.2', label: 'gpt-5.2' },
    { value: 'gpt-5-mini', label: 'gpt-5-mini' },
    { value: 'o3', label: 'o3' },
    { value: 'o4-mini', label: 'o4-mini' },
  ],
  copilot: [
    { value: '', label: 'Tool default' },
    { value: 'claude-opus-4.7', label: 'claude-opus-4.7' },
    { value: 'claude-opus-4.6', label: 'claude-opus-4.6' },
    { value: 'claude-opus-4.6-fast', label: 'claude-opus-4.6-fast' },
    { value: 'claude-opus-4.5', label: 'claude-opus-4.5' },
    { value: 'claude-sonnet-4.6', label: 'claude-sonnet-4.6' },
    { value: 'claude-sonnet-4.5', label: 'claude-sonnet-4.5' },
    { value: 'claude-sonnet-4', label: 'claude-sonnet-4' },
    { value: 'claude-haiku-4.5', label: 'claude-haiku-4.5' },
    { value: 'gpt-5.4', label: 'gpt-5.4' },
    { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { value: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
    { value: 'gpt-5.2-codex', label: 'gpt-5.2-codex' },
    { value: 'gpt-5.2', label: 'gpt-5.2' },
    { value: 'gpt-5.1', label: 'gpt-5.1' },
    { value: 'gpt-5-mini', label: 'gpt-5-mini' },
    { value: 'gpt-4.1', label: 'gpt-4.1' },
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
