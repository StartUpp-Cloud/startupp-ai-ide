import assert from 'node:assert/strict';
import { parseCodexExecOutput } from '../llmProvider.js';

const output = [
  JSON.stringify({ type: 'thread.started', thread_id: 'orch-1' }),
  JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Use the existing auth helper.' } }),
  JSON.stringify({ type: 'turn.completed', usage: { total_tokens: 42 } }),
].join('\n');

const parsed = parseCodexExecOutput(output);
assert.equal(parsed.response, 'Use the existing auth helper.');
assert.equal(parsed.tokensUsed, 42);
assert.equal(parsed.error, '');

const errored = parseCodexExecOutput(JSON.stringify({ type: 'error', message: 'rate limited' }));
assert.equal(errored.error, 'rate limited');

console.log('parseCodexExecOutput tests passed');
