/**
 * checklistTracker — turns an agent's streaming output into a live checklist.
 *
 * Instead of surfacing the raw "status conversation" (a wall of reasoning text),
 * we derive discrete, ordered steps as the agent works and broadcast them so the
 * UI can render a checklist that fills in — completed steps with a check, the
 * current step active with a short "what's happening now" detail. This mirrors
 * how the desktop harnesses present progress.
 *
 * Sources, per message:
 *  - Codex `exec --json`: `agent_message` items (its narration paragraphs) and
 *    `command_execution` items.
 *  - Claude `stream-json`: assistant text + `tool_use` blocks, resolved by the
 *    following `tool_result`.
 *  - Manual milestones the gateway notes (retries, "verifying completeness").
 *
 * Everything is defensive: malformed lines are ignored, unknown shapes simply
 * produce no step. Worst case is fewer steps, never a crash.
 */

const BROADCAST_DEBOUNCE_MS = 350;
const MAX_STEPS = 40;
const LABEL_MAX = 96;
const DETAIL_MAX = 320;

// A line that looks like the start of the final structured report — we do NOT
// want the report itself showing up as a "step"; it becomes the message body.
const REPORT_START_RE = /^\s*(?:#{1,4}\s*)?\*{0,2}\s*(Summary|Verification)\s*\*{0,2}\s*:?\s*$/im;

class ChecklistTracker {
  constructor() {
    /** @type {Map<string, object>} messageId → tracker state */
    this._state = new Map();
  }

  /** Begin tracking a message's run. */
  start({ messageId, projectId, sessionId, tool, broadcastFn }) {
    if (!messageId) return;
    this._state.set(messageId, {
      projectId,
      sessionId,
      tool: tool || 'generic',
      broadcastFn: typeof broadcastFn === 'function' ? broadcastFn : null,
      steps: [],
      seq: 0,
      lineBuf: '',
      timer: null,
    });
  }

  /** Feed a raw output chunk; parse out any new steps. */
  ingestChunk(messageId, chunk) {
    const st = this._state.get(messageId);
    if (!st || !chunk) return;
    st.lineBuf += chunk;
    const nl = st.lineBuf.lastIndexOf('\n');
    if (nl === -1) return; // wait for a complete line
    const complete = st.lineBuf.slice(0, nl);
    st.lineBuf = st.lineBuf.slice(nl + 1);
    for (const line of complete.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { this._handleLine(st, trimmed); } catch { /* ignore malformed */ }
    }
  }

  /** Add or update a milestone step explicitly (used by the gateway). */
  note(messageId, label, status = 'active', detail = '') {
    const st = this._state.get(messageId);
    if (!st) return;
    this._addStep(st, { label, status, detail });
  }

  _handleLine(st, line) {
    const idx = line.indexOf('{');
    if (idx === -1) return;
    let json;
    try { json = JSON.parse(line.slice(idx)); } catch { return; }
    if (!json || typeof json !== 'object') return;

    // ── Codex exec --json ──
    if (json.type === 'item.completed' && json.item) {
      const item = json.item;
      if (item.type === 'agent_message' && item.text) {
        if (REPORT_START_RE.test(item.text)) { this._completeActive(st); return; }
        const label = firstLine(item.text);
        this._addStep(st, { label, status: 'active', detail: clip(item.text, DETAIL_MAX) });
        return;
      }
      if (item.type === 'command_execution' || item.type === 'local_shell_call' || item.command) {
        const cmd = item.command || item.cmd || item.action?.command;
        if (cmd) {
          const failed = typeof item.exit_code === 'number' ? item.exit_code !== 0 : /error|failed/i.test(item.aggregated_output || '');
          this._addStep(st, {
            label: `Ran \`${clip(String(Array.isArray(cmd) ? cmd.join(' ') : cmd), 80)}\``,
            status: failed ? 'fail' : 'done',
            detail: clip(item.aggregated_output || '', DETAIL_MAX),
          });
        }
        return;
      }
    }

    // ── Claude stream-json ──
    if (json.type === 'assistant' && json.message?.content) {
      for (const block of json.message.content) {
        if (block?.type === 'text' && block.text) {
          if (REPORT_START_RE.test(block.text)) { this._completeActive(st); continue; }
          this._addStep(st, { label: firstLine(block.text), status: 'active', detail: clip(block.text, DETAIL_MAX) });
        } else if (block?.type === 'tool_use') {
          this._addStep(st, { label: toolUseLabel(block), status: 'active', detail: '', toolId: block.id });
        }
      }
      return;
    }
    if (json.type === 'user' && json.message?.content) {
      for (const block of json.message.content) {
        if (block?.type === 'tool_result') {
          this._resolveTool(st, block.tool_use_id, block.is_error ? 'fail' : 'done');
        }
      }
    }
  }

  /** Mark the current active step done (e.g. when the report begins). */
  _completeActive(st) {
    for (const s of st.steps) if (s.status === 'active') s.status = 'done';
    this._scheduleBroadcast(st);
  }

  _resolveTool(st, toolId, status) {
    const s = [...st.steps].reverse().find((x) => x.toolId === toolId) || [...st.steps].reverse().find((x) => x.status === 'active');
    if (s) { s.status = status; this._scheduleBroadcast(st); }
  }

  _addStep(st, { label, status, detail, toolId }) {
    const clean = clip(stripMd(label), LABEL_MAX);
    if (!clean) return;
    // De-dupe consecutive identical labels.
    const last = st.steps[st.steps.length - 1];
    if (last && last.label === clean) {
      if (detail) last.detail = detail;
      if (status) last.status = status;
      this._scheduleBroadcast(st);
      return;
    }
    // A new active step closes the previous active one.
    if (status === 'active') for (const s of st.steps) if (s.status === 'active') s.status = 'done';
    st.steps.push({ id: ++st.seq, label: clean, status: status || 'info', detail: detail || '', toolId });
    if (st.steps.length > MAX_STEPS) st.steps.splice(0, st.steps.length - MAX_STEPS);
    this._scheduleBroadcast(st);
  }

  _scheduleBroadcast(st) {
    if (!st.broadcastFn || st.timer) return;
    st.timer = setTimeout(() => {
      st.timer = null;
      this._broadcast(st, false);
    }, BROADCAST_DEBOUNCE_MS);
  }

  _broadcast(st, done, messageId) {
    if (!st.broadcastFn) return;
    st.broadcastFn({
      type: 'chat-checks',
      projectId: st.projectId,
      sessionId: st.sessionId,
      messageId: messageId || st._messageId,
      done: !!done,
      checks: st.steps.map(({ id, label, status, detail }) => ({ id, label, status, detail })),
    });
  }

  /** Current snapshot (or empty array). */
  snapshot(messageId) {
    const st = this._state.get(messageId);
    return st ? st.steps.map(({ id, label, status, detail }) => ({ id, label, status, detail })) : [];
  }

  /**
   * Finalize: mark everything done, append the report's verification checks as
   * a distinct group, broadcast a final frame, and clean up. Returns the
   * verification checks (normalized) for the message metadata.
   */
  finalize(messageId, verificationChecks = []) {
    const st = this._state.get(messageId);
    const normalized = (verificationChecks || []).map((c) => ({
      label: clip(stripMd(c.label || ''), LABEL_MAX),
      status: c.status === 'pass' ? 'done' : c.status === 'fail' ? 'fail' : c.status === 'skip' ? 'skip' : 'info',
      detail: clip(c.result || '', DETAIL_MAX),
    })).filter((c) => c.label);

    if (st) {
      if (st.timer) { clearTimeout(st.timer); st.timer = null; }
      for (const s of st.steps) if (s.status === 'active') s.status = 'done';
      // Append verification as final, authoritative checks.
      normalized.forEach((c, i) => st.steps.push({ id: 1000 + i, label: c.label, status: c.status, detail: c.detail, verify: true }));
      st._messageId = messageId;
      this._broadcast(st, true, messageId);
      this._state.delete(messageId);
    }
    return normalized;
  }

  /** Tear down without finalizing (failure/abort). No-op if already gone. */
  abort(messageId) {
    const st = this._state.get(messageId);
    if (!st) return;
    if (st.timer) clearTimeout(st.timer);
    this._state.delete(messageId);
  }
}

// ── helpers ──

function clip(s, n) {
  const str = String(s || '').trim();
  return str.length > n ? str.slice(0, n - 1).trimEnd() + '…' : str;
}

function firstLine(text) {
  const line = String(text || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  // Prefer the first sentence if the line is long.
  const sentence = line.match(/^.*?[.!?](\s|$)/);
  return (sentence ? sentence[0] : line).trim();
}

function stripMd(s) {
  return String(s || '')
    .replace(/^[#>\-*\s]+/, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .trim();
}

function toolUseLabel(block) {
  const name = block.name || 'tool';
  const input = block.input || {};
  if (name === 'Bash' && input.command) return `Ran \`${clip(input.command, 80)}\``;
  const target = input.file_path || input.path || input.pattern || input.query || input.url || '';
  return target ? `${name}: ${clip(String(target), 70)}` : name;
}

export const checklistTracker = new ChecklistTracker();
