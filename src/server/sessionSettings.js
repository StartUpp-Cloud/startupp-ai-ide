const SESSION_TOOLS = ['claude', 'copilot', 'opencode', 'codex', 'aider', 'gemini', 'ollama', 'shell'];

const TOOL_EFFORT_LEVELS = {
  claude: ['low', 'medium', 'high', 'max'],
  copilot: ['low', 'medium', 'high', 'xhigh'],
  opencode: ['minimal', 'low', 'medium', 'high', 'max'],
};

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function normalizeTool(tool, fallback = 'claude') {
  const value = typeof tool === 'string' ? tool.trim().toLowerCase() : '';
  if (SESSION_TOOLS.includes(value)) return value;
  return SESSION_TOOLS.includes(fallback) ? fallback : 'claude';
}

function supportsModelSelection(tool) {
  return tool === 'claude' || tool === 'copilot' || tool === 'opencode' || tool === 'codex' || tool === 'ollama';
}

function supportsEffortSelection(tool) {
  return Array.isArray(TOOL_EFFORT_LEVELS[tool]);
}

function normalizeModel(tool, model) {
  if (!supportsModelSelection(tool)) return null;
  if (typeof model !== 'string') return null;
  const value = model.trim();
  return value || null;
}

function normalizeEffort(tool, effort) {
  if (!supportsEffortSelection(tool) || typeof effort !== 'string') return null;
  const value = effort.trim().toLowerCase();
  return TOOL_EFFORT_LEVELS[tool].includes(value) ? value : null;
}

export function resolveSessionAssistantSettings(input = {}, fallback = {}) {
  const tool = normalizeTool(input.tool, normalizeTool(fallback.tool, 'claude'));

  return {
    tool,
    model: normalizeModel(tool, input.model),
    effort: normalizeEffort(tool, input.effort),
  };
}

export function mergeSessionAssistantSettings(existing = {}, updates = {}, fallback = {}) {
  const merged = {
    tool: hasOwn(updates, 'tool') ? updates.tool : existing.tool,
    model: hasOwn(updates, 'model') ? updates.model : existing.model,
    effort: hasOwn(updates, 'effort') ? updates.effort : existing.effort,
  };

  return resolveSessionAssistantSettings(merged, {
    tool: existing.tool || fallback.tool || 'claude',
  });
}

export function supportsSessionModelSelection(tool) {
  return supportsModelSelection(tool);
}

export function supportsSessionEffortSelection(tool) {
  return supportsEffortSelection(tool);
}

export { SESSION_TOOLS, TOOL_EFFORT_LEVELS };
