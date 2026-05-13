import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRunFailureEventMessage,
  buildRunFailureResponse,
  buildThinFinalResponse,
  sanitizeAgentFailureDetail,
} from '../orchestratorMessages.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const rawOpencodeFailure = [
  'Autonomous run failed: "sessionID":"ses_1de27a633ffenLGtH2ouoiWCYu","type":"step-finish","tokens":{"total":87047}}',
  '{"type":"step_start","part":{"type":"step-start"}}',
  '{"type":"text","part":{"type":"text","text":"I found the code path."}}',
  'Error: OpenCode could not find this Ollama model in its provider config. Model "\\s*[" is not registered. Restart the project container to refresh the model list, then try again.',
].join('\n');

const sanitized = sanitizeAgentFailureDetail(rawOpencodeFailure);
assert.doesNotMatch(sanitized, /"type":"step|"sessionID"|tokens/i);

const userMessage = buildRunFailureResponse({
  status: 'blocked',
  taskTitle: 'Complete user request',
  error: rawOpencodeFailure,
  tool: 'opencode',
  model: '\\s*[',
  retryable: false,
  profile: { name: 'Renzo Dupont', tone: 'casual' },
});
assert.match(userMessage, /^Renzo, I paused this run/i);
assert.match(userMessage, /selected model/i);
assert.match(userMessage, /restart the project container/i);
assert.doesNotMatch(userMessage, /Autonomous run failed|"type":"step|"sessionID"|\\s\*\[/i);

const eventMessage = buildRunFailureEventMessage({
  status: 'blocked',
  taskTitle: 'Complete user request',
  error: rawOpencodeFailure,
  tool: 'opencode',
  retryable: false,
});
assert.match(eventMessage, /^Paused at Complete user request:/);
assert.doesNotMatch(eventMessage, /Autonomous run failed|"type":"step|"sessionID"/i);

const thinFinal = buildThinFinalResponse({
  completed: [{
    task: { title: 'Complete user request', status: 'completed' },
    result: { success: true, content: 'Implemented the requested change and verified it.' },
  }],
});
assert.equal(thinFinal, 'Implemented the requested change and verified it.');

const emptyFinal = buildThinFinalResponse({ completed: [], profile: { name: 'Renzo Dupont' } });
assert.match(emptyFinal, /^Renzo, the coding agent finished/i);

const orchestratorSource = readFileSync(resolve(__dirname, '../agentOrchestrator.js'), 'utf8');
assert.doesNotMatch(orchestratorSource, /llmProvider\.generateResponse/);
assert.doesNotMatch(orchestratorSource, /Create a safe task breakdown/);
assert.doesNotMatch(orchestratorSource, /Write the final user-facing response/);
assert.match(orchestratorSource, /<ide_orchestrator_handoff version="1">/);
assert.match(orchestratorSource, /session_continuity/);
assert.match(orchestratorSource, /user_profile_and_preferences/);
assert.match(orchestratorSource, /response_guidance/);

console.log('orchestratorMessages tests passed');
