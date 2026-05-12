import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isUnsafeAutoConfirmPrompt, orchestratedAutoConfirm } from '../agentAutoConfirm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  'Force push to main with --force-with-lease?',
  'Delete the production database?',
  'Run git reset --hard to discard the worktree?',
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

{
  const agentGatewaySource = readFileSync(resolve(__dirname, '../agentGateway.js'), 'utf8');
  assert.match(
    agentGatewaySource,
    /const autoResponse = unsafePrompt \? null : await this\._smartAutoConfirm\([\s\S]*?if \(autoResponse !== null\)[\s\S]*?agentShellPool\.write\(shellSessionId, 'n\\n'\)/,
    'Prompts unresolved by _smartAutoConfirm should be safely declined instead of leaving the shell waiting',
  );
}

console.log('agentGatewayAutoConfirm tests passed');
