/**
 * Helpers for loading a chat session's message history.
 * A failed or aborted request must not be treated as an empty conversation.
 */

export function isAbortLikeError(error) {
  return error?.name === 'AbortError' || error?.code === 20;
}

/**
 * API returns newest-first. The transcript renders oldest-first.
 * @param {{ messages?: unknown }} payload
 */
export function chronologicalMessages(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  return [...messages].reverse();
}

/**
 * Latest page should not use `since`. If the windowed query hid every row
 * while the session still has a message count, refetch without the cutoff.
 */
export function shouldRefetchWithoutSince({ messages, total, sessionMessageCount } = {}) {
  const loaded = Array.isArray(messages) ? messages.length : 0;
  const expected = Math.max(Number(total) || 0, Number(sessionMessageCount) || 0);
  return loaded === 0 && expected > 0;
}

/**
 * @returns {'loading' | 'no-results' | 'reload' | 'main-empty' | 'start'}
 */
export function conversationEmptyState({
  loading,
  error,
  messageCount,
  loadedCount,
  isMainThread,
  searching,
} = {}) {
  if (loading) return 'loading';
  if (searching) return 'no-results';
  const expected = Math.max(Number(messageCount) || 0, Number(loadedCount) || 0);
  if (error || expected > 0) return 'reload';
  return isMainThread ? 'main-empty' : 'start';
}
