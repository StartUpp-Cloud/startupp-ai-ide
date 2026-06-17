/**
 * steeringInbox — lets the user keep typing while a run is in flight.
 *
 * Instead of spawning a duplicate run/turn, messages sent while a session is
 * busy are parked here and folded into the SAME run at a safe boundary (between
 * turns / before a diligence nudge) — the same mechanism as nudging, but sourced
 * from the user. User steers take priority over auto-nudges.
 *
 * Two urgencies:
 *  - 'normal'  → queue and fold in at the next boundary (no wasted work).
 *  - 'urgent'  → a clear correction ("stop", "actually no, do X"); the caller
 *                aborts the current turn and redirects immediately.
 *
 * Persisted in LowDB so a restart doesn't drop queued steers (the resume path
 * drains them when the run continues).
 */

import { getDB } from './db.js';

const MAX_PER_SESSION = 25;

// Clear corrections that justify interrupting the current turn rather than
// waiting for a boundary. Anchored to the start so it matches intent, not
// incidental mentions ("don't worry, also add…" is not urgent).
const URGENT_RE = /^\s*(stop|wait|hold on|hold up|cancel|abort|nvm|never ?mind|scratch that|forget (that|it)|change of plans?|belay that|actually[ ,]|no[ ,.]|nope[ ,.]|instead[ ,]|do not |don'?t )/i;

export function classifySteerUrgency(text) {
  return URGENT_RE.test(String(text || '')) ? 'urgent' : 'normal';
}

function inbox(db) {
  if (!db.data.steeringInbox) db.data.steeringInbox = {};
  return db.data.steeringInbox;
}

/** Park a message for the active run on this session. */
export function addSteer(sessionId, content, { urgent = false } = {}) {
  if (!sessionId || !content) return null;
  const db = getDB();
  const box = inbox(db);
  const list = box[sessionId] || [];
  const entry = { content: String(content), urgent: !!urgent, at: Date.now() };
  list.push(entry);
  box[sessionId] = list.slice(-MAX_PER_SESSION);
  db.write?.().catch?.(() => {});
  return entry;
}

export function hasSteers(sessionId) {
  if (!sessionId) return false;
  try { return (getDB().data?.steeringInbox?.[sessionId]?.length || 0) > 0; } catch { return false; }
}

export function peekSteers(sessionId) {
  if (!sessionId) return [];
  try { return [...(getDB().data?.steeringInbox?.[sessionId] || [])]; } catch { return []; }
}

/** Return and remove all queued steers for a session. */
export function drainSteers(sessionId) {
  if (!sessionId) return [];
  const db = getDB();
  const box = inbox(db);
  const list = box[sessionId] || [];
  if (!list.length) return [];
  box[sessionId] = [];
  db.write?.().catch?.(() => {});
  return list;
}

/**
 * Build the prompt block that folds drained steers into the next same-session
 * turn. Frames them as authoritative, latest-wins user instructions.
 */
export function buildSteerPrompt(steers = []) {
  const items = steers.map((s) => (typeof s === 'string' ? s : s.content)).filter(Boolean);
  if (!items.length) return '';
  return [
    '[USER FOLLOW-UP MESSAGES — the user sent these while you were working. Incorporate them into what you are doing now.',
    'If any of them change, correct, or re-prioritize the current direction, the LATEST instruction wins. Address them as part of completing the task; do not ask the user to repeat them.]',
    ...items.map((m, i) => `${i + 1}. ${m}`),
  ].join('\n');
}
