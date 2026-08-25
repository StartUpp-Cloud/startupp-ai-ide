import assert from 'node:assert/strict';
import { meaningfulProgressLabel } from '../checklistTracker.js';

assert.equal(meaningfulProgressLabel('Step 1'), '');
assert.equal(
  meaningfulProgressLabel('Step 1\nInspecting ChatMessage for URL rendering.'),
  'Inspecting ChatMessage for URL rendering.',
);
assert.equal(
  meaningfulProgressLabel('Step 2: Reading the orchestrator task titles.'),
  'Reading the orchestrator task titles.',
);
assert.match(meaningfulProgressLabel('I am checking the pull request comments.'), /checking the pull request/i);

console.log('checklistTracker tests passed');
