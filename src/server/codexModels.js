/**
 * Codex models that ChatGPT-authenticated CLI sessions can actually use.
 * `codex models` is not a list command (it opens the TUI). The CLI writes
 * the account-aware catalog to ~/.codex/models_cache.json.
 */

export const CODEX_MODELS_CACHE_PATH = '/home/dev/.codex/models_cache.json';

export const CODEX_DEPRECATED_CHATGPT_MODELS = new Set([
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.3-codex',
]);

export const FALLBACK_CHATGPT_CODEX_MODELS = [
  { id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol', description: 'Latest frontier agentic coding model.', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], visibility: 'list' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra', description: 'Everyday workhorse.', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], visibility: 'list' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6-Luna', description: 'Faster, lower-cost GPT-5.6.', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], visibility: 'list' },
  { id: 'gpt-5.5', name: 'GPT-5.5', description: 'Previous-generation frontier model.', efforts: ['low', 'medium', 'high', 'xhigh'], visibility: 'list' },
  { id: 'gpt-5.4', name: 'GPT-5.4', description: 'Still available on ChatGPT until 2026-08-31.', efforts: ['low', 'medium', 'high', 'xhigh'], visibility: 'list' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4-Mini', description: 'Fast mini model.', efforts: ['low', 'medium', 'high', 'xhigh'], visibility: 'list' },
  { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3-Codex-Spark', description: 'Near-instant coding (ChatGPT Pro research preview).', efforts: ['low', 'medium', 'high', 'xhigh'], visibility: 'list' },
];

export const DEFAULT_CHATGPT_CODEX_MODEL = 'gpt-5.6-sol';

export function parseCodexModelsCache(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      data = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  const models = Array.isArray(data?.models) ? data.models : [];
  return models.map((model) => ({
    id: String(model.slug || model.id || '').trim(),
    name: String(model.display_name || model.slug || model.id || '').trim(),
    description: String(model.description || ''),
    visibility: String(model.visibility || 'list'),
    supportedInApi: Boolean(model.supported_in_api),
    efforts: (model.supported_reasoning_levels || [])
      .map((level) => (typeof level === 'string' ? level : level?.effort))
      .filter(Boolean),
  })).filter((model) => model.id);
}

export function listSupportedCodexModels(models = []) {
  return models.filter((model) => (
    model?.id
    && model.visibility === 'list'
    && !CODEX_DEPRECATED_CHATGPT_MODELS.has(model.id)
  ));
}

export function unwrapCodexErrorMessage(message) {
  const raw = String(message || '').trim();
  if (!raw.startsWith('{')) return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed.error?.message || parsed.message || raw;
  } catch {
    return raw;
  }
}

export function toPickerOptions(models = []) {
  return listSupportedCodexModels(models).map((model) => ({
    value: model.id,
    label: model.name && model.name !== model.id ? `${model.name}` : model.id,
    description: model.description || '',
    efforts: model.efforts || [],
  }));
}
