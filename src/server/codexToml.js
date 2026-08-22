export const CODEX_MCP_START = '# >>> sai-managed-mcp >>>';
export const CODEX_MCP_END = '# <<< sai-managed-mcp <<<';

export function isPlausibleToml(text) {
  if (typeof text !== 'string' || !text) return false;
  if (text.includes('\uFFFD')) return false;
  if (/[\x00-\x08\x0e-\x1f]/.test(text)) return false;
  return true;
}

/**
 * Strip a previous managed MCP block and append a fresh one.
 * Binary or otherwise unreadable existing files are discarded.
 */
export function mergeManagedCodexToml(existing, block, {
  start = CODEX_MCP_START,
  end = CODEX_MCP_END,
} = {}) {
  const cur = isPlausibleToml(existing)
    ? existing.replace(new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, 'g'), '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    : '';
  const managed = `${start}\n${String(block || '').trim()}\n${end}\n`;
  return cur ? `${cur}\n\n${managed}` : managed;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
