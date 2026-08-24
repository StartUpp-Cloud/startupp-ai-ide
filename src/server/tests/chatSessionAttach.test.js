import assert from 'node:assert/strict';
import {
  attachWsToChatSession,
  createChatSessionAttachState,
  detachWsFromAllChatSessions,
  detachWsFromChatSession,
  listWsChatSessions,
} from '../chatSessionAttach.js';

const ws = { id: 'ide' };
const other = { id: 'other' };
const state = createChatSessionAttachState();

attachWsToChatSession(state, ws, 'websites');
attachWsToChatSession(state, ws, 'honeygrid');

assert.deepEqual(listWsChatSessions(state, ws).sort(), ['honeygrid', 'websites']);
assert.equal(state.chatSessionClients.get('websites').has(ws), true);
assert.equal(state.chatSessionClients.get('honeygrid').has(ws), true);

attachWsToChatSession(state, other, 'websites');
assert.equal(state.chatSessionClients.get('websites').size, 2);

detachWsFromChatSession(state, ws, 'honeygrid');
assert.deepEqual(listWsChatSessions(state, ws), ['websites']);
assert.equal(state.chatSessionClients.has('honeygrid'), false);
assert.equal(state.chatSessionClients.get('websites').has(ws), true);

detachWsFromAllChatSessions(state, ws);
assert.deepEqual(listWsChatSessions(state, ws), []);
assert.equal(state.chatSessionClients.get('websites').has(other), true);

console.log('chatSessionAttach tests passed');
