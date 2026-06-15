import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { agentGateway } from '../agentGateway.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

assert.equal(
  agentGateway._parseStreamEvent(JSON.stringify({ type: 'turn.started' })),
  'Thinking...',
  'Codex turn start should produce live progress',
);

assert.equal(
  agentGateway._parseStreamEvent(JSON.stringify({
    type: 'item.completed',
    item: { type: 'tool_call', name: 'exec_command', input: { cmd: 'npm test' } },
  })),
  'Running: `{' + '\"cmd\":\"npm test\"' + '}`',
  'Codex command tool calls should be surfaced as running progress',
);

assert.equal(
  agentGateway._parseStreamEvent(JSON.stringify({
    type: 'item.completed',
    item: { type: 'tool_call', name: 'apply_patch', input: '*** Update File: src/server/agentGateway.js' },
  })),
  'Editing: `src/server/agentGateway.js`',
  'Codex edit tool calls should be surfaced as editing progress',
);

const parsed = agentGateway._parseCodexJsonOutput([
  JSON.stringify({ type: 'thread.started', thread_id: 'codex-thread-1' }),
  JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Implemented and verified.' } }),
  JSON.stringify({ type: 'turn.completed' }),
].join('\n'), 'codex exec --json test');

assert.equal(parsed.sessionId, 'codex-thread-1');
assert.equal(parsed.isError, false);
assert.equal(parsed.text, 'Implemented and verified.');

const gatewaySource = readFileSync(resolve(__dirname, '../agentGateway.js'), 'utf8');
assert.match(gatewaySource, /CODEX EXECUTION STANDARD/);
assert.match(gatewaySource, /CODEX QUALITY LOOP/);
assert.match(gatewaySource, /_buildCodexQualityArgs/);
assert.match(gatewaySource, /reasoning_effort=\$\{this\._quoteCliArg\(effort\)\}/);
assert.match(gatewaySource, /const effort = assistantSettings\?\.effort \|\| 'xhigh'/);

console.log('agentGatewayCodex tests passed');
