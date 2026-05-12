import assert from 'node:assert/strict';
import {
  INTERRUPTED_RUN_ERROR,
  buildLivenessHeartbeatMessage,
  buildProgressMessageId,
  shouldEmitLivenessHeartbeat,
  shouldPersistProgressMessage,
  shouldSuppressAgentProgress,
} from '../orchestratorLiveness.js';
import {
  buildStreamingRecoveryContent,
  shouldRecoverStreamingMessage,
  streamingSilenceMs,
} from '../sessionRecovery.js';

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
  'Listening for the next signal from Investigate stalled child agent... 10s',
  'task heartbeat should include the active task and elapsed waiting duration',
);

assert.equal(
  buildLivenessHeartbeatMessage({ phase: 'planning', silenceMs: 4_000 }),
  'Charting the route through the fog... 4s',
  'planning heartbeat should keep one neutral waiting line moving',
);

assert.equal(
  buildLivenessHeartbeatMessage({ phase: 'synthesizing', silenceMs: 4_000 }),
  'Gathering the final threads... 4s',
  'synthesis heartbeat should show final-response progress instead of silence',
);

assert.equal(
  shouldPersistProgressMessage('run-heartbeat'),
  false,
  'heartbeat progress should be broadcast-only so waiting updates do not accumulate in chat history',
);

assert.equal(
  shouldPersistProgressMessage('task-started'),
  true,
  'meaningful task progress should still be persisted in chat history',
);

assert.equal(
  buildProgressMessageId({ eventType: 'run-heartbeat', runId: 'run-123', messageId: 'msg-1' }),
  'orchestrator-heartbeat-run-123',
  'heartbeat progress should reuse a stable visible message id for replacement',
);

assert.equal(
  buildProgressMessageId({ eventType: 'task-started', runId: 'run-123', messageId: 'msg-1' }),
  'msg-1',
  'non-heartbeat progress should keep unique message ids',
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

assert.equal(
  streamingSilenceMs({ now: Date.parse('2026-05-12T10:05:00.000Z'), streamStartedAt: '2026-05-12T10:00:00.000Z' }),
  300000,
  'streaming recovery should measure silence from stream start when no chunks exist',
);

assert.equal(
  shouldRecoverStreamingMessage({ now: Date.parse('2026-05-12T10:06:00.000Z'), streamStartedAt: '2026-05-12T10:00:00.000Z', staleMs: 300000 }),
  true,
  'stale zero-output streaming messages should be recoverable instead of hidden forever',
);

assert.match(
  buildStreamingRecoveryContent({ tool: 'claude', retrying: true }),
  /retrying the request automatically/i,
  'streaming recovery response should tell the session that the backend is retrying',
);

console.log('orchestratorLiveness tests passed');
