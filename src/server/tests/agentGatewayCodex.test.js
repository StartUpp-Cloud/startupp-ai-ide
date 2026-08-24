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
  'SAI_INNER_PID_mt4v38gznbqa:1166',
  JSON.stringify({ type: 'thread.started', thread_id: 'codex-thread-1' }),
  JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', content: 'Implemented and verified.' } }),
  JSON.stringify({ type: 'turn.completed' }),
].join('\n'), 'codex exec --json test');

assert.equal(parsed.sessionId, 'codex-thread-1');
assert.equal(parsed.isError, false);
assert.equal(parsed.text, 'Implemented and verified.');

const narrated = agentGateway._parseCodexJsonOutput([
  JSON.stringify({ type: 'thread.started', thread_id: 'codex-thread-3' }),
  JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: "I'll check Wrangler authentication, then run the guarded release." } }),
  JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: "Wrangler authentication is valid. I'm starting the guarded API release now." } }),
  JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Deployment succeeded.\n\nWorker version acf275d2 is live and openava.app returned HTTP 200.\n\nI added the missing schema column and pushed 4378713d.' } }),
  JSON.stringify({ type: 'turn.completed' }),
].join('\n'), 'codex exec --json test');
assert.equal(narrated.isError, false);
assert.match(narrated.text, /Deployment succeeded/);
assert.match(narrated.text, /4378713d/);
assert.doesNotMatch(narrated.text, /I'll check|I'm starting/i);

const rejected = agentGateway._parseCodexJsonOutput([
  JSON.stringify({ type: 'thread.started', thread_id: 'codex-thread-2' }),
  JSON.stringify({ type: 'error', message: JSON.stringify({ type: 'error', error: { message: "The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account." } }) }),
].join('\n'), 'codex exec --json test');
assert.equal(rejected.isError, true);
assert.match(rejected.text, /not supported when using Codex with a ChatGPT account/);

const gatewaySource = readFileSync(resolve(__dirname, '../agentGateway.js'), 'utf8');
assert.match(gatewaySource, /CODEX EXECUTION STANDARD/);
assert.match(gatewaySource, /CODEX EXECUTION STANDARD/);
assert.match(gatewaySource, /_buildCodexQualityArgs/);
assert.match(gatewaySource, /reasoning_effort=\$\{this\._quoteCliArg\(effort\)\}/);
assert.match(gatewaySource, /const effort = assistantSettings\?\.effort \|\| 'xhigh'/);
assert.match(gatewaySource, /getHostBashStdinSpec/);
assert.match(gatewaySource, /assistant-run-status/);
assert.match(gatewaySource, /createCodexStatusTracker/);
assert.match(gatewaySource, /killRegisteredAgentProcesses/);
assert.match(gatewaySource, /agentDockerExecArgs/);
assert.match(gatewaySource, /containerAgentShellPrelude/);
assert.match(gatewaySource, /selectFinalAgentMessage/);
assert.match(gatewaySource, /past-tense report|## Outcome/);
assert.match(gatewaySource, /_finalizeStoppedTurn/);
assert.match(gatewaySource, /aborted: true/);
assert.doesNotMatch(gatewaySource, /resolve\(\{ success: false, aborted: true, displayOutput: '' \}\)/);

console.log('agentGatewayCodex tests passed');
