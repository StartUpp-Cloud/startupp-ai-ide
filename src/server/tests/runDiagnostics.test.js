import assert from 'node:assert/strict';
import { buildDiagnostics, buildRunObservation } from '../runDiagnostics.js';

const run = {
  id: 'run-1', projectId: 'project-1', sessionId: 'session-1', status: 'running', phase: 'executing',
  goal: 'Implement and verify the feature', tool: 'codex', updatedAt: new Date(1000).toISOString(),
  data: { policy: { filesystemScope: 'project' } },
};
const observation = buildRunObservation(run, [
  { id: 'task-1', title: 'Implement', status: 'completed', attempt: 1, maxAttempts: 3, result: 'done' },
], [
  { eventType: 'task-complete', level: 'info', message: 'Implemented the feature', createdAt: new Date(1000).toISOString() },
]);
assert.equal(observation.run.id, 'run-1');
assert.equal(observation.tasks[0].result, 'done');
assert.equal(observation.events[0].message, 'Implemented the feature');
assert.equal(observation.run.policy.filesystemScope, 'project');

const diagnostics = buildDiagnostics({
  health: { uptime: 4 },
  docker: { dockerAvailable: true },
  runs: [run, { ...run, id: 'run-2', status: 'completed' }],
  sessions: [{ id: 'session-1', status: 'open' }],
  activities: [
    { id: 'a-1', type: 'approval-granted', title: 'Approval granted', timestamp: new Date().toISOString() },
    { id: 'a-2', type: 'step-retried', title: 'Retrying task', timestamp: new Date().toISOString() },
  ],
  now: 120000,
});
assert.equal(diagnostics.status, 'warning', 'a run silent for more than a minute is visible to operators');
assert.equal(diagnostics.summary.activeRuns, 1);
assert.equal(diagnostics.summary.staleRuns, 1);
assert.equal(diagnostics.summary.openSessions, 1);
assert.equal(diagnostics.approvals[0].title, 'Approval granted');
assert.equal(diagnostics.summary.recentRetries, 1);

console.log('runDiagnostics tests passed');
