import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferSkillTags, skillMatchesTags } from '../orchestratorContextPack.js';

assert.deepEqual(inferSkillTags('Please improve the orchestrator prompt and collapse long messages.'), []);
assert.ok(!inferSkillTags('improve this prompt').includes('git'), 'substring "pr" in prompt must not select git');
assert.ok(inferSkillTags('Open a pull request for the chat UI changes.').includes('git'));
assert.ok(inferSkillTags('Open a pull request for the chat UI changes.').includes('frontend'));
assert.ok(inferSkillTags('Fix the flaky React component test.').includes('testing'));
assert.ok(inferSkillTags('Fix the flaky React component test.').includes('react'));

assert.equal(
  skillMatchesTags({ id: 'frontend-design-pro', name: 'Frontend Design Pro', category: 'frontend' }, ['frontend']),
  true,
);
assert.equal(
  skillMatchesTags({ id: 'git-workflow', name: 'Git Workflow', category: 'devops' }, ['git']),
  true,
);
assert.equal(
  skillMatchesTags({ id: 'frontend-design-pro', name: 'Frontend Design Pro', category: 'frontend' }, ['git']),
  false,
);

const orchestratorSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../agentOrchestrator.js'), 'utf8');
assert.match(orchestratorSource, /inferSkillTags\(run\.goal\)/);
assert.match(orchestratorSource, /matchingOnly:\s*true/);

const gatewaySource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../agentGateway.js'), 'utf8');
assert.match(gatewaySource, /orchestrated:\s*orchestrated/);
assert.match(gatewaySource, /assistantSettings\?\.orchestrated/);

console.log('orchestratorContextPack tests passed');
