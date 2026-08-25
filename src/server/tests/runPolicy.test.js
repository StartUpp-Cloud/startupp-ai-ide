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
assert.equal(policy.approvalMode, 'never');
assert.equal(policy.autoConfirmCommands, true);

assert.equal(classifyRunRisk('Explain the existing login flow').risk, 'safe');
assert.equal(classifyRunRisk('Write a production rollout plan and migrate the schema').risk, 'medium');
assert.equal(classifyRunRisk('deploy the release to staging').risk, 'medium');
assert.equal(classifyRunRisk('deploy to production tonight').risk, 'high');
assert.equal(classifyRunRisk('delete production data').risk, 'critical');
assert.equal(classifyRunRisk('git push --force origin main').risk, 'critical');

assert.equal(
  needsRunApproval({ content: 'deploy to production tonight', policy }).requiresApproval,
  false,
  'default never mode must not pause common orchestrated work',
);
assert.equal(
  needsRunApproval({ content: 'Write a production rollout plan', policy }).requiresApproval,
  false,
);
assert.equal(
  needsRunApproval({
    content: 'deploy to production tonight',
    policy: { ...policy, approvalMode: 'on-risk', autoConfirmCommands: true },
  }).requiresApproval,
  false,
  'on-risk + autoConfirm should not pause high-risk work',
);
assert.equal(
  needsRunApproval({
    content: 'delete production data',
    policy: { ...policy, approvalMode: 'on-risk' },
  }).requiresApproval,
  true,
  'on-risk must still pause critical ops',
);
assert.equal(
  needsRunApproval({
    content: 'deploy to production tonight',
    policy: { ...policy, approvalMode: 'on-risk', autoConfirmCommands: false },
  }).requiresApproval,
  true,
);

const approval = buildApprovalRequest({ runId: 'run-1', operation: 'wipe production', policy, risk: 'critical', reasons: ['destructive'] });
assert.equal(approval.runId, 'run-1');
assert.equal(approval.status, 'pending');
assert.equal(approval.policy.approvalMode, 'never');
assert.match(approval.id, /^[0-9a-f-]{36}$/);

console.log('runPolicy tests passed');
