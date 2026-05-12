import assert from 'node:assert/strict';
import { isUnsafeAutoConfirmPrompt, orchestratedAutoConfirm } from '../agentAutoConfirm.js';

const safePrompts = [
  'Do you want to run git push now?',
  'Approve deployment to production?',
  'There are pending changes. Continue?',
];

for (const prompt of safePrompts) {
  assert.equal(
    orchestratedAutoConfirm(prompt),
    'y',
    `Expected orchestrated safe prompt to be approved: ${prompt}`,
  );
}

const riskyPrompts = [
  'Force push to origin/main?',
  'Delete the production database?',
  'Expose this secret token?',
];

for (const prompt of riskyPrompts) {
  assert.equal(
    orchestratedAutoConfirm(prompt),
    null,
    `Expected risky prompt to require user confirmation: ${prompt}`,
  );
  assert.equal(
    isUnsafeAutoConfirmPrompt(prompt),
    true,
    `Expected risky prompt to be classified unsafe: ${prompt}`,
  );
}

assert.equal(
  orchestratedAutoConfirm('Which feature name should I use?'),
  null,
  'Subjective prompts should not receive orchestrated approval',
);

console.log('agentGatewayAutoConfirm tests passed');
