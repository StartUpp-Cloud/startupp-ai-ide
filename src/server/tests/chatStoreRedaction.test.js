import assert from 'node:assert/strict';
import { redactSecrets, safeJson } from '../chatStore.js';

const STYTCH_MESSAGE = "You need to redeploy quickly. Please include this in our .env.local because it's needed for stytch for dev: VITE_STYCH_PUBLIC_TOKEN=public-token-test-92c238e3-4017-4a8e-9f58-6bae1eb0e42f";

const metadata = {
  mode: 'agent',
  attachments: [],
  clientMessageId: 'client-1756826640000-abc123',
  goalContract: { content: STYTCH_MESSAGE },
  tool: 'codex',
  model: 'gpt-5.6-luna',
};

assert.equal(typeof redactSecrets(STYTCH_MESSAGE), 'string');
assert.match(redactSecrets(STYTCH_MESSAGE), /REDACTED/);

assert.doesNotThrow(() => safeJson(metadata));
const redacted = safeJson(metadata);
assert.equal(redacted.tool, 'codex');
assert.equal(redacted.model, 'gpt-5.6-luna');
assert.equal(redacted.clientMessageId, 'client-1756826640000-abc123');
assert.match(redacted.goalContract.content, /REDACTED/);
assert.equal(redacted.goalContract.content.includes('public-token-test-92c238e3'), false);

assert.equal(safeJson(null), null);
assert.deepEqual(safeJson({ note: 'no secrets here' }), { note: 'no secrets here' });

console.log('chatStoreRedaction tests passed');
