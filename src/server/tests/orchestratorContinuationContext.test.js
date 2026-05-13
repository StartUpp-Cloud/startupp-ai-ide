import assert from 'node:assert/strict';
import {
  buildRecoveredRunContextForPrompt,
  isContinuationRequest,
} from '../agentOrchestrator.js';

assert.equal(isContinuationRequest('Please continue pushing the coding agent until completed.'), true);
assert.equal(isContinuationRequest('Can you summarize what changed?'), false);

const context = buildRecoveredRunContextForPrompt({
  currentRequest: 'Please continue pushing the coding agent until completed.',
  previousRun: {
    id: 'run_failed',
    status: 'failed',
    goal: 'Okay, proceed with the implementation.',
    error: 'Error: Aborted',
  },
  previousTask: {
    id: 'task_failed',
    title: 'Complete user request',
    prompt: [
      '<ide_orchestrator_handoff version="1">',
      '<recent_parent_conversation>',
      'user: Build the Analytics OS dashboard until it is done, pushed, and deployed.',
      'agent: Review found the app still shows placeholder organization/session copy instead of usable dashboard data.',
      'user: Okay, proceed with the implementation.',
      '</recent_parent_conversation>',
      '<assigned_task>',
      'Okay, proceed with the implementation.',
      '</assigned_task>',
      '</ide_orchestrator_handoff>',
    ].join('\n'),
  },
  events: [
    { eventType: 'agent-progress', createdAt: '2026-05-13T21:44:56.421Z', message: 'Complete user request: Reviewing the IntegrationWidget React component.' },
    { eventType: 'agent-progress', createdAt: '2026-05-13T21:51:27.670Z', message: 'Complete user request: Searching portal settings handlers and MCP resources.' },
    { eventType: 'task-failed', createdAt: '2026-05-13T21:53:07.482Z', message: 'Needs attention at Complete user request: Aborted' },
  ],
});

assert.match(context, /Resume the prior implementation objective/i);
assert.match(context, /Please continue pushing the coding agent until completed/i);
assert.match(context, /Build the Analytics OS dashboard until it is done, pushed, and deployed/i);
assert.match(context, /Searching portal settings handlers and MCP resources/i);
assert.match(context, /do not reduce this to a repository-cleanliness check/i);

console.log('orchestratorContinuationContext tests passed');
