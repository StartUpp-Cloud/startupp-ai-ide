/**
 * Focused tests for session status persistence logic.
 *
 * Validates:
 * - Status field validation (only 'open' / 'closed' accepted)
 * - Session restoration filter (open + pinned sessions restored on load)
 * - Status reconciliation (openTabs drives expected server status)
 *
 * These are pure-logic tests that don't require a live SQLite database.
 */
import assert from 'node:assert/strict';

// --- Status validation (mirrors chat.js PATCH handler logic) ---

function validateStatus(rawStatus) {
  const valid = ['open', 'closed'];
  const status = String(rawStatus).toLowerCase();
  return valid.includes(status) ? status : null;
}

assert.equal(validateStatus('open'), 'open', 'accepts open');
assert.equal(validateStatus('closed'), 'closed', 'accepts closed');
assert.equal(validateStatus('Open'), 'open', 'normalizes case');
assert.equal(validateStatus('CLOSED'), 'closed', 'normalizes uppercase');
assert.equal(validateStatus('paused'), null, 'rejects unknown status');
assert.equal(validateStatus(''), null, 'rejects empty string');
assert.equal(validateStatus(undefined), null, 'rejects undefined');
assert.equal(validateStatus(null), null, 'rejects null');
assert.equal(validateStatus(42), null, 'rejects number');

console.log('  ✓ status validation');

// --- Session restoration filter (mirrors ChatPanel load logic) ---

function restoreOpenTabs(sessions) {
  const openIds = sessions.filter(s => s.status === 'open' || s.pinned).map(s => s.id);
  if (sessions.length === 0) return [];
  const mostRecentId = sessions[0].id;
  if (openIds.length > 0) {
    return openIds.includes(mostRecentId) ? openIds : [mostRecentId, ...openIds];
  }
  return [mostRecentId];
}

// All closed, none pinned → only most recent
assert.deepEqual(
  restoreOpenTabs([
    { id: 'a', status: 'closed', pinned: false },
    { id: 'b', status: 'closed', pinned: false },
  ]),
  ['a'],
  'restores only most recent when all closed and none pinned',
);

// One open → restores it
assert.deepEqual(
  restoreOpenTabs([
    { id: 'a', status: 'closed', pinned: false },
    { id: 'b', status: 'open', pinned: false },
  ]),
  ['a', 'b'],
  'restores open session plus most recent',
);

// Pinned but closed → still restored
assert.deepEqual(
  restoreOpenTabs([
    { id: 'a', status: 'closed', pinned: false },
    { id: 'b', status: 'closed', pinned: true },
  ]),
  ['a', 'b'],
  'restores pinned session even when status is closed',
);

// Most recent is open → no duplicate
assert.deepEqual(
  restoreOpenTabs([
    { id: 'a', status: 'open', pinned: false },
    { id: 'b', status: 'closed', pinned: false },
  ]),
  ['a'],
  'does not duplicate most recent when it is already open',
);

// Multiple open + pinned
assert.deepEqual(
  restoreOpenTabs([
    { id: 'a', status: 'open', pinned: true },
    { id: 'b', status: 'open', pinned: false },
    { id: 'c', status: 'closed', pinned: true },
    { id: 'd', status: 'closed', pinned: false },
  ]),
  ['a', 'b', 'c'],
  'restores all open and pinned sessions',
);

// Empty list
assert.deepEqual(restoreOpenTabs([]), [], 'handles empty session list');

console.log('  ✓ session restoration filter');

// --- Status reconciliation (mirrors syncSessions corrective logic) ---

function computeStatusCorrections(serverSessions, openTabIds) {
  const openTabs = new Set(openTabIds);
  const corrections = [];
  for (const session of serverSessions) {
    if (session.pending) continue;
    const expected = openTabs.has(session.id) ? 'open' : 'closed';
    if (session.status !== expected) {
      corrections.push({ id: session.id, status: expected });
    }
  }
  return corrections;
}

// No corrections needed
assert.deepEqual(
  computeStatusCorrections(
    [{ id: 'a', status: 'open' }, { id: 'b', status: 'closed' }],
    ['a'],
  ),
  [],
  'no corrections when status matches openTabs',
);

// Server says open but tab is closed locally
assert.deepEqual(
  computeStatusCorrections(
    [{ id: 'a', status: 'open' }, { id: 'b', status: 'open' }],
    ['a'],
  ),
  [{ id: 'b', status: 'closed' }],
  'corrects server open→closed when tab not in openTabs',
);

// Server says closed but tab is open locally
assert.deepEqual(
  computeStatusCorrections(
    [{ id: 'a', status: 'closed' }, { id: 'b', status: 'closed' }],
    ['a', 'b'],
  ),
  [{ id: 'a', status: 'open' }, { id: 'b', status: 'open' }],
  'corrects server closed→open when tabs are in openTabs',
);

// Pending sessions are skipped
assert.deepEqual(
  computeStatusCorrections(
    [{ id: 'a', status: 'closed', pending: true }],
    ['a'],
  ),
  [],
  'skips pending sessions during reconciliation',
);

// Sessions without status (undefined) get corrected
assert.deepEqual(
  computeStatusCorrections(
    [{ id: 'a', status: undefined }],
    ['a'],
  ),
  [{ id: 'a', status: 'open' }],
  'corrects undefined status to open when tab is open',
);

console.log('  ✓ status reconciliation');

console.log('sessionStatus tests passed');
