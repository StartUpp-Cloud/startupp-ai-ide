import assert from 'node:assert/strict';
import {
  buildApprovalRequest,
  classifyRunRisk,
  needsRunApproval,
  normalizeRunPolicy,
} from '../runPolicy.js';

const policy = normalizeRunPolicy({ allowedTools: ['read', 'shell'], filesystemScope: 'project' }, { tool: 'codex', projectRuntime: 'container' });
assert.deepEqual(policy.allowedTools, ['read', 'shell']);
assert.equal(policy.containerBoundary, 'project-container');
assert.equal(policy.approvalMode, 'on-risk');
assert.equal(classifyRunRisk('Explain the existing login flow').risk, 'safe');
assert.equal(classifyRunRisk('deploy the release').risk, 'high');
assert.equal(classifyRunRisk('delete production data').risk, 'critical');
assert.equal(needsRunApproval({ content: 'deploy the release', policy }).requiresApproval, true);
assert.equal(needsRunApproval({ content: 'deploy the release', policy: { ...policy, autoConfirmCommands: true } }).requiresApproval, false);

const approval = buildApprovalRequest({ runId: 'run-1', operation: 'deploy', policy, risk: 'high', reasons: ['external side effect'] });
assert.equal(approval.runId, 'run-1');
assert.equal(approval.status, 'pending');
assert.equal(approval.policy.approvalMode, 'on-risk');
assert.match(approval.id, /^[0-9a-f-]{36}$/);

console.log('runPolicy tests passed');

