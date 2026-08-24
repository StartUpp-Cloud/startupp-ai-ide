/**
 * One IDE WebSocket can watch many chat sessions at once.
 * Switching projects must not detach the previous session or live
 * progress is lost and the UI freezes on "Working".
 */

export function createChatSessionAttachState() {
  return {
    chatSessionClients: new Map(), // sessionId -> Set<ws>
    clientChatSessions: new Map(), // ws -> Set<sessionId>
  };
}

export function attachWsToChatSession(state, ws, chatSessionId) {
  if (!ws || !chatSessionId) return { attached: false, sessionCount: 0 };

  let sessions = state.clientChatSessions.get(ws);
  if (!sessions) {
    sessions = new Set();
    state.clientChatSessions.set(ws, sessions);
  }
  sessions.add(chatSessionId);

  let clients = state.chatSessionClients.get(chatSessionId);
  if (!clients) {
    clients = new Set();
    state.chatSessionClients.set(chatSessionId, clients);
  }
  clients.add(ws);

  return { attached: true, sessionCount: sessions.size };
}

export function detachWsFromChatSession(state, ws, chatSessionId) {
  if (!ws || !chatSessionId) return { detached: false };

  const sessions = state.clientChatSessions.get(ws);
  if (sessions) {
    sessions.delete(chatSessionId);
    if (sessions.size === 0) state.clientChatSessions.delete(ws);
  }

  const clients = state.chatSessionClients.get(chatSessionId);
  if (clients) {
    clients.delete(ws);
    if (clients.size === 0) state.chatSessionClients.delete(chatSessionId);
  }

  return { detached: true };
}

export function detachWsFromAllChatSessions(state, ws) {
  const sessions = state.clientChatSessions.get(ws);
  if (!sessions) return { detached: 0 };
  const ids = [...sessions];
  for (const sessionId of ids) {
    detachWsFromChatSession(state, ws, sessionId);
  }
  return { detached: ids.length };
}

export function listWsChatSessions(state, ws) {
  return [...(state.clientChatSessions.get(ws) || [])];
}
