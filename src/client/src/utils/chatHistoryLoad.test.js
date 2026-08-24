import assert from 'node:assert/strict';
import {
  chronologicalMessages,
  conversationEmptyState,
  isAbortLikeError,
  shouldRefetchWithoutSince,
} from './chatHistoryLoad.js';

assert.equal(isAbortLikeError({ name: 'AbortError' }), true);
assert.equal(isAbortLikeError({ code: 20 }), true);
assert.equal(isAbortLikeError({ name: 'TypeError' }), false);
assert.equal(isAbortLikeError(null), false);

assert.deepEqual(
  chronologicalMessages({ messages: [{ id: 'new' }, { id: 'old' }] }).map((m) => m.id),
  ['old', 'new'],
);
assert.deepEqual(chronologicalMessages({}), []);
assert.deepEqual(chronologicalMessages({ messages: null }), []);

assert.equal(shouldRefetchWithoutSince({ messages: [], total: 225, sessionMessageCount: 225 }), true);
assert.equal(shouldRefetchWithoutSince({ messages: [], total: 0, sessionMessageCount: 7 }), true);
assert.equal(shouldRefetchWithoutSince({ messages: [{ id: '1' }], total: 225 }), false);
assert.equal(shouldRefetchWithoutSince({ messages: [], total: 0, sessionMessageCount: 0 }), false);

assert.equal(conversationEmptyState({ loading: true }), 'loading');
assert.equal(conversationEmptyState({ searching: true }), 'no-results');
assert.equal(conversationEmptyState({ error: 'fail', messageCount: 0 }), 'reload');
assert.equal(conversationEmptyState({ messageCount: 225, loadedCount: 0 }), 'reload');
assert.equal(conversationEmptyState({ isMainThread: true }), 'main-empty');
assert.equal(conversationEmptyState({ isMainThread: false }), 'start');

console.log('chatHistoryLoad tests passed');
