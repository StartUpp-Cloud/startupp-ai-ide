import assert from 'node:assert/strict';
import {
  deriveTaskTitle,
  heuristicDecomposeGoal,
  stripGenericStepPrefix,
} from '../orchestratorTaskTitles.js';

assert.equal(stripGenericStepPrefix('Step 1: Add login form'), 'Add login form');
assert.equal(deriveTaskTitle('Step 1'), 'Work on request (1)');
assert.equal(deriveTaskTitle('Step 1: Add the login form'), 'Add the login form');
assert.equal(deriveTaskTitle('Part 2 — Wire the API client'), 'Wire the API client');
assert.match(deriveTaskTitle('fix the flaky checkout test that fails on empty carts'), /Fix the flaky checkout test/i);

const listed = heuristicDecomposeGoal([
  'Please do the following:',
  '1. Add a GitHub link renderer',
  '2. Collapse long user messages',
  '3. Remove the mobile toggle',
].join('\n'));

assert.ok(listed);
assert.equal(listed.length, 3);
assert.equal(listed[0].title, 'Add a GitHub link renderer');
assert.equal(listed[1].title, 'Collapse long user messages');
assert.equal(listed[2].title, 'Remove the mobile toggle');
assert.doesNotMatch(listed.map((item) => item.title).join(' '), /Step \d|Part \d/);

assert.equal(heuristicDecomposeGoal('Just fix the bug in auth.'), null);

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const orchestratorSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../agentOrchestrator.js'), 'utf8');
assert.match(orchestratorSource, /heuristicDecomposeGoal/);
assert.match(orchestratorSource, /deriveTaskTitle/);
assert.doesNotMatch(orchestratorSource, /title: `Part \$\{i \+ 1\}`/);
assert.doesNotMatch(orchestratorSource, /title: 'Complete user request'/);

console.log('orchestratorTaskTitles tests passed');
