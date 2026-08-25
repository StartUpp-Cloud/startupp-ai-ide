import assert from 'node:assert/strict';
import {
  buildApprovalRequest,
  classifyRunRisk,
  needsRunApproval,
  normalizeRunPolicy,
  RUN_POLICY_VERSION,
} from '../runPolicy.js';

const policy = normalizeRunPolicy({ allowedTools: ['read', 'shell'], filesystemScope: 'project' }, { tool: 'codex', projectRuntime: 'container' });
assert.deepEqual(policy.allowedTools, ['read', 'shell']);
assert.equal(policy.containerBoundary, 'project-container');
assert.equal(policy.approvalMode, 'never');
assert.equal(policy.autoConfirmCommands, true);
assert.equal(policy.version, RUN_POLICY_VERSION);

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

// Legacy sticky session policy must migrate away from constant approvals.
const legacySticky = normalizeRunPolicy({
  version: 1,
  approvalMode: 'on-risk',
  autoConfirmCommands: false,
});
assert.equal(legacySticky.approvalMode, 'never');
assert.equal(legacySticky.autoConfirmCommands, true);
assert.equal(
  needsRunApproval({
    content: 'Please check production build release and the regular dev release cycle',
    policy: { version: 1, approvalMode: 'on-risk', autoConfirmCommands: false },
  }).requiresApproval,
  false,
);

assert.equal(
  needsRunApproval({
    content: 'delete production data',
    policy: { approvalMode: 'on-risk', explicitApprovalPolicy: true, version: RUN_POLICY_VERSION },
  }).requiresApproval,
  true,
  'explicit on-risk must still pause critical ops',
);
assert.equal(
  needsRunApproval({
    content: 'deploy to production tonight',
    policy: { approvalMode: 'on-risk', explicitApprovalPolicy: true, version: RUN_POLICY_VERSION, autoConfirmCommands: false },
  }).requiresApproval,
  false,
  'on-risk should not pause non-critical high-risk work',
);

const approval = buildApprovalRequest({ runId: 'run-1', operation: 'wipe production', policy, risk: 'critical', reasons: ['destructive'] });
assert.equal(approval.runId, 'run-1');
assert.equal(approval.status, 'pending');
assert.equal(approval.policy.approvalMode, 'never');
assert.match(approval.id, /^[0-9a-f-]{36}$/);

console.log('runPolicy tests passed');
