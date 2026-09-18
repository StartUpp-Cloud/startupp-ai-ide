/**
 * Compact, typed progress for the live run tree.
 * The durable chat bubble stays the handshake; these lines are ephemeral status.
 */

export const PROGRESS_KINDS = ['read', 'edit', 'run', 'test', 'search', 'blocked', 'think', 'other'];

const KIND_LABELS = {
  read: 'Read',
  edit: 'Edit',
  run: 'Run',
  test: 'Test',
  search: 'Search',
  blocked: 'Blocked',
  think: 'Think',
  other: 'Working',
};

const TEST_RE = /\b(?:npm test|pnpm test|yarn test|pytest|vitest|jest|playwright|cypress|coverage|typecheck|eslint|\blint\b)\b/i;

function extractTarget(text) {
  const tick = String(text || '').match(/`([^`]+)`/);
  if (tick) return tick[1].trim();
  const path = String(text || '').match(/((?:[\w.-]+\/)+[\w.-]+\.\w+)/);
  return path ? path[1] : '';
}

function trimTarget(target) {
  const text = String(target || '').replace(/\\/g, '/');
  const parts = text.split('/').filter(Boolean);
  if (parts.length <= 3) return text;
  return parts.slice(-3).join('/');
}

function compact(text, max = 80) {
  const cleaned = String(text || '').replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max).trim()}…`;
}

function summarizeProgress(kind, text, target) {
  const shortTarget = target ? trimTarget(target) : '';
  if (kind === 'read') return shortTarget ? `Read ${shortTarget}` : 'Reading files';
  if (kind === 'edit') return shortTarget ? `Edit ${shortTarget}` : 'Editing files';
  if (kind === 'search') return shortTarget ? `Search ${shortTarget}` : compact(text, 72) || 'Searching';
  if (kind === 'test') {
    if (shortTarget) return `Test ${shortTarget}`;
    return compact(String(text).replace(/^Running:\s*/i, ''), 72) || 'Running tests';
  }
  if (kind === 'run') {
    if (shortTarget) return `Run ${shortTarget}`;
    return compact(String(text).replace(/^Running:\s*/i, ''), 72) || 'Running command';
  }
  if (kind === 'blocked') return compact(text, 80) || 'Needs input';
  if (kind === 'think') return compact(text, 72) || 'Thinking';
  return compact(text, 80) || 'Working';
}

function finish(kind, text, target) {
  const resolved = PROGRESS_KINDS.includes(kind) ? kind : 'other';
  return {
    kind: resolved,
    target: target || '',
    label: KIND_LABELS[resolved] || 'Working',
    summary: summarizeProgress(resolved, text, target),
  };
}

/**
 * Classify a progress line into a compact typed event.
 * @param {string} content
 * @param {{ kind?: string }} [extra]
 */
export function classifyProgress(content, extra = {}) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  const target = extractTarget(text);
  const forced = extra.kind && PROGRESS_KINDS.includes(extra.kind) ? extra.kind : null;
  if (forced) return finish(forced, text, target);
  if (!text) return finish('other', '', '');

  if (/needs your input|waiting for (?:your|user)|blocked|permission den|approval needed/i.test(text)) {
    return finish('blocked', text, target);
  }
  if (/^(?:📖\s*)?reading\b|^read\b|reading project files/i.test(text)) {
    return finish('read', text, target);
  }
  if (/^(?:✏️\s*)?(?:editing|creating|writing)\b|editing project files/i.test(text)) {
    return finish('edit', text, target);
  }
  if (/^searching\b|searching the codebase/i.test(text)) {
    return finish('search', text, target);
  }
  if (/^running\b/i.test(text)) {
    return finish(TEST_RE.test(text) ? 'test' : 'run', text, target);
  }
  if (TEST_RE.test(text)) return finish('test', text, target);
  if (/^(?:thinking|reasoning|writing response|finalizing)/i.test(text)) {
    return finish('think', text, target);
  }
  return finish('other', text, target);
}
