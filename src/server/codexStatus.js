/**
 * Live Codex run status from `codex exec --json` events.
 * Percent is derived from todo_list completion when present, otherwise
 * a conservative step heuristic. Token usage is not treated as progress.
 */

const PHASES = new Set(['idle', 'running', 'done', 'failed']);

export function createIdleCodexStatus() {
  return {
    phase: 'idle',
    label: '',
    percent: 0,
    todoDone: 0,
    todoTotal: 0,
    itemsCompleted: 0,
  };
}

export function extractJsonlEvents(buffer) {
  const text = String(buffer || '');
  const lines = text.split('\n');
  const remainder = lines.pop() ?? '';
  const events = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Ignore partial or non-event JSON lines.
    }
  }
  return { events, remainder };
}

function shortCommand(command) {
  const text = String(command || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Running command';
  return text.length > 48 ? `${text.slice(0, 45)}…` : text;
}

function shortPath(path) {
  const text = String(path || '').trim();
  if (!text) return 'Updating files';
  const parts = text.split('/').filter(Boolean);
  return parts[parts.length - 1] || text;
}

function labelForEvent(event) {
  const type = event?.type;
  const item = event?.item || {};

  if (type === 'turn.started') return 'Thinking';
  if (type === 'turn.completed') return 'Done';
  if (type === 'turn.failed' || type === 'error') {
    return String(event?.message || event?.error || item.error || 'Failed').slice(0, 72);
  }

  if (item.type === 'command_execution') {
    const verb = type === 'item.completed' ? 'Ran' : 'Running';
    return `${verb} ${shortCommand(item.command)}`;
  }
  if (item.type === 'file_change') {
    const first = Array.isArray(item.changes) ? item.changes[0] : null;
    const name = shortPath(first?.path);
    return type === 'item.completed' ? `Updated ${name}` : `Editing ${name}`;
  }
  if (item.type === 'agent_message') {
    return 'Writing response';
  }
  if (item.type === 'todo_list') {
    const items = Array.isArray(item.items) ? item.items : [];
    const next = items.find((entry) => !entry?.completed);
    return next?.text ? String(next.text).slice(0, 72) : 'Updating plan';
  }
  if (item.type === 'web_search') {
    return item.query ? `Searching ${String(item.query).slice(0, 40)}` : 'Searching';
  }
  if (item.type === 'mcp_tool_call') {
    return item.tool ? `Using ${item.tool}` : 'Using tool';
  }
  if (type === 'item.started') return 'Working';
  if (type === 'item.completed') return 'Working';
  return '';
}

function applyTodos(state, item) {
  if (item?.type !== 'todo_list' || !Array.isArray(item.items)) return state;
  const todos = item.items.map((entry) => ({
    text: String(entry?.text || '').trim(),
    completed: Boolean(entry?.completed),
  }));
  return {
    ...state,
    todoDone: todos.filter((entry) => entry.completed).length,
    todoTotal: todos.length,
  };
}

function computePercent(state) {
  if (state.phase === 'done') return 100;
  if (state.todoTotal > 0) {
    const raw = Math.round((100 * state.todoDone) / state.todoTotal);
    const floor = state.phase === 'failed' ? 0 : 8;
    return Math.min(state.phase === 'failed' ? 99 : 96, Math.max(floor, raw || floor));
  }
  if (state.phase === 'idle') return 0;
  return Math.min(90, 8 + (Number(state.itemsCompleted) || 0) * 10);
}

export function ingestCodexStatusEvent(prev, event) {
  const state = prev && PHASES.has(prev.phase) ? { ...prev } : createIdleCodexStatus();
  const type = event?.type;
  if (!type) return state;

  if (type === 'turn.started' || type === 'thread.started') {
    state.phase = 'running';
    if (!state.percent) state.percent = 6;
  } else if (type === 'turn.completed') {
    state.phase = 'done';
  } else if (type === 'turn.failed' || type === 'error') {
    state.phase = 'failed';
  } else if (state.phase === 'idle') {
    state.phase = 'running';
  }

  if (type === 'item.completed') {
    state.itemsCompleted = (Number(state.itemsCompleted) || 0) + 1;
  }

  const next = applyTodos(state, event?.item);
  const label = labelForEvent(event);
  if (label) next.label = label;
  next.percent = computePercent(next);
  return next;
}

export function createCodexStatusTracker() {
  let current = createIdleCodexStatus();
  return {
    snapshot() {
      return { ...current };
    },
    ingest(event) {
      current = ingestCodexStatusEvent(current, event);
      return this.snapshot();
    },
    reset() {
      current = createIdleCodexStatus();
      return this.snapshot();
    },
  };
}
