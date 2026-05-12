import assert from 'node:assert/strict';
import {
  INTERRUPTED_RUN_ERROR,
  buildLivenessHeartbeatMessage,
  shouldEmitLivenessHeartbeat,
  shouldSuppressAgentProgress,
} from '../orchestratorLiveness.js';

assert.match(
  INTERRUPTED_RUN_ERROR,
  /interrupted before it could send a final response/i,
  'interrupted orchestrator runs should fail with a useful terminal result instead of returning nothing',
);

assert.match(
  INTERRUPTED_RUN_ERROR,
  /persisted events or retry/i,
  'interrupted-run result should tell the user where to recover or what to retry',
);

assert.equal(
  shouldEmitLivenessHeartbeat({ now: 10_000, lastActivityAt: 6_500, staleMs: 4_000 }),
  false,
  'fresh child-agent activity should not emit a heartbeat',
);

assert.equal(
  shouldEmitLivenessHeartbeat({ now: 10_000, lastActivityAt: 5_000, staleMs: 4_000 }),
  true,
  'stale child-agent silence should emit a heartbeat while the run is viewed',
);

assert.equal(
  buildLivenessHeartbeatMessage({ taskTitle: 'Investigate stalled child agent', phase: 'executing', silenceMs: 10_200 }),
  'Task still running: Investigate stalled child agent; no new agent output for 10s.',
  'task heartbeat should include the active task and silence duration',
);

assert.equal(
  buildLivenessHeartbeatMessage({ phase: 'planning', silenceMs: 4_000 }),
  'Still planning agent tasks; no new agent output for 4s.',
  'planning heartbeat should be explicit when no child task exists yet',
);

assert.equal(
  buildLivenessHeartbeatMessage({ phase: 'synthesizing', silenceMs: 4_000 }),
  'Still synthesizing final response; no new agent output for 4s.',
  'synthesis heartbeat should show final-response progress instead of silence',
);

assert.equal(
  shouldSuppressAgentProgress('Working: coding assistant is using a tool...'),
  true,
  'generic filler progress should be suppressed when no useful detail exists',
);

assert.equal(
  shouldSuppressAgentProgress('Reading src/server/agentOrchestrator.js'),
  false,
  'specific progress details should still be emitted',
);

console.log('orchestratorLiveness tests passed');
