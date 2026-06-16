import assert from 'node:assert/strict';
import { shouldOrchestrateRequest } from '../orchestratorRouting.js';

// Genuinely multi-step requests SHOULD orchestrate.
const orchestratedPrompts = [
  'First implement the API endpoint, then add tests, and finally deploy.',
  'Refactor the auth module. After that, migrate the database.',
  '1. Set up the schema\n2. Write the migration\n3. Run it',
  '- Add the feature flag\n- Wire it into the UI\n- Ship behind the flag',
];

for (const content of orchestratedPrompts) {
  assert.equal(
    shouldOrchestrateRequest({ mode: 'agent', content }),
    true,
    `Expected multi-step prompt to orchestrate: ${content}`
  );
}

// Single operational commands should NOT orchestrate — they run as a normal
// diligence-backed turn (no noisy one-task orchestrator wrapper).
const singleStepPrompts = [
  'You are approved to deploy to dev-1, please do so and report back.',
  'Check git status for local changes.',
  'Inspect the repository state before deploy.',
  'Were the latest changes pushed?',
  'Fix the login bug.',
  'Run the test suite.',
];

for (const content of singleStepPrompts) {
  assert.equal(
    shouldOrchestrateRequest({ mode: 'agent', content }),
    false,
    `Expected single command to run as a normal turn, not orchestrate: ${content}`
  );
}

assert.equal(
  shouldOrchestrateRequest({ mode: 'plan', content: 'First do X, then do Y, then deploy.' }),
  false,
  'Plan mode should remain planning-only and not start orchestration'
);

assert.equal(
  shouldOrchestrateRequest({ mode: 'agent', content: 'hello' }),
  false,
  'Simple chat should not orchestrate'
);

assert.equal(
  shouldOrchestrateRequest({ mode: 'agent', content: 'Can you explain closures conceptually?' }),
  false,
  'Conceptual questions should be answered directly, not orchestrated'
);

assert.equal(
  shouldOrchestrateRequest({ mode: 'autonomous', content: 'hello' }),
  true,
  'Autonomous mode should always route through the orchestrator'
);

assert.equal(
  shouldOrchestrateRequest({ mode: 'agent', content: 'hello', executeReviewedPlan: true }),
  true,
  'Approved plans should orchestrate'
);

console.log('orchestratorRouting tests passed');
