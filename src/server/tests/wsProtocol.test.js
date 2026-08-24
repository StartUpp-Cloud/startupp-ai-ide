import assert from 'node:assert/strict';
import {
  createRequest,
  normalizeRequest,
  ProtocolState,
  createHello,
  isSideEffectingRequest,
} from '../../shared/wsProtocol.js';

const request = createRequest('chat-send', { content: 'hello' }, {
  requestId: 'req-1',
  idempotencyKey: 'idem-1',
});
assert.deepEqual(normalizeRequest(request), {
  type: 'chat-send',
  payload: { content: 'hello' },
  requestId: 'req-1',
  idempotencyKey: 'idem-1',
  protocolVersion: 1,
  enveloped: true,
});

const legacy = normalizeRequest({ type: 'ping', value: 1 });
assert.equal(legacy.type, 'ping');
assert.deepEqual(legacy.payload, { type: 'ping', value: 1 });
assert.equal(legacy.enveloped, false);
assert.equal(isSideEffectingRequest('chat-send'), true);
assert.equal(isSideEffectingRequest('ping'), false);

const state = new ProtocolState({ maxEvents: 2 });
assert.equal(state.nextEvent({ type: 'one' }, 'session-1').seq, 1);
assert.equal(state.nextEvent({ type: 'two' }, 'session-1').scopeVersion, 2);
assert.equal(state.nextEvent({ type: 'three' }, 'session-2').seq, 3);
assert.deepEqual(state.replaySince(1).events.map(event => event.type), ['two', 'three']);
assert.equal(state.replaySince(0).complete, false, 'expired sequence history requests a reconciliation');
assert.equal(createHello({ eventSeq: 3 }).protocolVersion, 1);

console.log('wsProtocol tests passed');
