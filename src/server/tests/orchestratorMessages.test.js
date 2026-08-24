import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRunFailureEventMessage,
  buildRunFailureResponse,
  buildThinFinalResponse,
  sanitizeAgentFailureDetail,
  selectFinalAgentMessage,
  stripInProgressNarration,
  buildStoppedRunResponse,
  compactChatReport,
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

const summaryHeadingFinal = buildThinFinalResponse({
  completed: [{
    task: { title: 'Part 1', status: 'completed' },
    result: { success: true, content: '## Summary\n\nInvitation flow is implemented with org permissions and read-only switching.' },
  }],
});
assert.match(summaryHeadingFinal, /Invitation flow is implemented/i);
assert.doesNotMatch(summaryHeadingFinal, /## Summary/);

const emptyFinal = buildThinFinalResponse({ completed: [], profile: { name: 'Renzo Dupont' } });
assert.match(emptyFinal, /^Renzo, the coding agent finished/i);

const progressOnly = stripInProgressNarration(
  "I'll check Wrangler authentication and the two repository states again, then run the guarded API release.",
);
assert.equal(progressOnly, '');

const mixedProgress = stripInProgressNarration([
  'The guarded API release succeeded: staging and production Workers deployed, production version acf275d2-a183-4e37-ac8b-2b56c36b4369, and the live health check confirms environment: production.',
  "I'm deploying the matching production Pages frontend now.",
].join(' '));
assert.match(mixedProgress, /acf275d2-a183-4e37-ac8b-2b56c36b4369/);
assert.doesNotMatch(mixedProgress, /I'm deploying|I am deploying|I'll /i);

const curlyProgress = stripInProgressNarration(
  'The API is released successfully, but the frontend production guard found one schema-drift blocker and stopped before publishing Pages.\n\nI’m checking the existing schema/migration history so I can make the smallest durable correction, then I’ll rerun the frontend release.',
);
assert.match(curlyProgress, /schema-drift blocker/);
assert.doesNotMatch(curlyProgress, /I’m checking|I'll rerun|I will rerun/i);

const selectedFinal = selectFinalAgentMessage([
  "I'll check Wrangler authentication, then run the guarded release if the environment is authorized.",
  'Wrangler authentication is now valid for the Startupp.ai account, and both repositories are clean. I’m starting the guarded API release now.',
  [
    'Deployment succeeded.',
    '',
    'API released to production:',
    '- Worker version: acf275d2-a183-4e37-ac8b-2b56c36b4369',
    '- openava.app returned HTTP 200',
    '',
    'I added `accounts.woopsocial_project_id` in server/db/schema.ts, verified coverage at 82/82, committed 4378713d, and pushed it to main.',
  ].join('\n'),
]);
assert.match(selectedFinal, /Deployment succeeded/);
assert.match(selectedFinal, /4378713d/);
assert.match(selectedFinal, /acf275d2-a183-4e37-ac8b-2b56c36b4369/);
assert.doesNotMatch(selectedFinal, /I'll check|I’m starting|I'm starting/i);

const progressThinFinal = buildThinFinalResponse({
  completed: [{
    task: { title: 'Complete user request', status: 'completed' },
    result: {
      success: true,
      content: "I'll rerun the release now.\n\nDeployment succeeded.\n\nWorker version acf275d2 is live and openava.app returned HTTP 200.",
    },
  }],
});
assert.match(progressThinFinal, /Deployment succeeded/);
assert.doesNotMatch(progressThinFinal, /I'll rerun/i);

const stoppedWithWork = buildStoppedRunResponse({
  partialContent: "I'll start the Pages deploy now.\n\nAPI Worker acf275d2 is live and openava.app returned HTTP 200.",
  completed: [{ title: 'Schema guard fix', content: 'Added accounts.woopsocial_project_id and pushed 4378713d.' }],
  changedFiles: [{ path: 'server/db/schema.ts', status: 'M' }],
});
assert.match(stoppedWithWork, /I stopped this run/i);
assert.match(stoppedWithWork, /acf275d2/);
assert.match(stoppedWithWork, /4378713d/);
assert.match(stoppedWithWork, /schema\.ts/);
assert.match(stoppedWithWork, /tell me what to do next/i);
assert.doesNotMatch(stoppedWithWork, /I'll start|Stopped by user/i);

const stoppedEmpty = buildStoppedRunResponse({ tool: 'codex' });
assert.match(stoppedEmpty, /I stopped this run/i);
assert.match(stoppedEmpty, /had not produced a usable report/i);
assert.match(stoppedEmpty, /tell me what to do next/i);
assert.doesNotMatch(stoppedEmpty, /Stopped by user/i);

const compactStructured = compactChatReport([
  "I'll inspect wrangler next.",
  '',
  '## Outcome',
  'API Worker acf275d2 is live and openava.app returned HTTP 200.',
  '',
  '## Details',
  '- Added `accounts.woopsocial_project_id` and pushed 4378713d.',
  '- Pages deploy: https://6dda18ac.startupp-ai-ui.pages.dev',
].join('\n'));
assert.match(compactStructured.body, /## Outcome/);
assert.match(compactStructured.body, /acf275d2/);
assert.doesNotMatch(compactStructured.body, /I'll inspect/i);
assert.match(compactStructured.detail, /I'll inspect|inspect wrangler/i);

const longNarrative = `${'The agent checked authentication and repository state. '.repeat(40)}\n\nThen it deployed the worker and confirmed health checks.`;
const compactLong = compactChatReport(longNarrative);
assert.equal(compactLong.compact, true);
assert.ok(compactLong.body.length < longNarrative.length);
assert.ok(compactLong.detail.length >= compactLong.body.length);

const orchestratorSource = readFileSync(resolve(__dirname, '../agentOrchestrator.js'), 'utf8');
assert.doesNotMatch(orchestratorSource, /llmProvider\.generateResponse/);
assert.doesNotMatch(orchestratorSource, /Create a safe task breakdown/);
assert.doesNotMatch(orchestratorSource, /Write the final user-facing response/);
assert.match(orchestratorSource, /<ide_orchestrator_handoff version="1">/);
assert.match(orchestratorSource, /session_continuity/);
assert.match(orchestratorSource, /user_profile_and_preferences/);
assert.match(orchestratorSource, /response_guidance/);
assert.match(orchestratorSource, /## Outcome/);
assert.match(orchestratorSource, /_postStoppedSummary/);
assert.match(orchestratorSource, /buildStoppedRunResponse/);

const terminalServerSource = readFileSync(resolve(__dirname, '../terminalServer.js'), 'utf8');
assert.doesNotMatch(terminalServerSource, /Stopped by user/);

console.log('orchestratorMessages tests passed');
