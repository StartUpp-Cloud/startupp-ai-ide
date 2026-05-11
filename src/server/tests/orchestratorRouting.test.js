import assert from 'node:assert/strict';
import { shouldOrchestrateRequest } from '../orchestratorRouting.js';

const orchestratedPrompts = [
  'Are there any local changes pending to be pushed and deployed?',
  'Check git status for local changes.',
  'Inspect the repository state before deploy.',
  'Were the latest changes pushed?',
];

for (const content of orchestratedPrompts) {
  assert.equal(
    shouldOrchestrateRequest({ mode: 'agent', content }),
    true,
    `Expected repository inspection prompt to orchestrate: ${content}`
  );
}

assert.equal(
  shouldOrchestrateRequest({ mode: 'plan', content: 'Check git status for local changes.' }),
  false,
  'Plan mode should remain planning-only and not start orchestration'
);

assert.equal(
  shouldOrchestrateRequest({ mode: 'agent', content: 'hello' }),
  false,
  'Simple chat should not orchestrate'
);

assert.equal(
  shouldOrchestrateRequest({ mode: 'agent', content: 'hello', executeReviewedPlan: true }),
  true,
  'Approved plans should orchestrate'
);

console.log('orchestratorRouting tests passed');
