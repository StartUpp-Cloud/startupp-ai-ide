import assert from 'node:assert/strict';
import { IDE_SHELL_PROJECT_ID, isIdeShellProject } from '../ideShell.js';

assert.equal(IDE_SHELL_PROJECT_ID, 'ide');
assert.equal(isIdeShellProject('ide'), true);
assert.equal(isIdeShellProject('dcdb1319-db61-48c2-983e-3da9ca7592bd'), false);
assert.equal(isIdeShellProject(null), false);

console.log('ideShell tests passed');
