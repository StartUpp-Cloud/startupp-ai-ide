import assert from 'node:assert/strict';
import { workspaceChownCommand } from '../containerManager.js';

const cmd = workspaceChownCommand('sai-demo-abcd1234');
assert.match(cmd, /^docker exec -u root sai-demo-abcd1234 /);
assert.match(cmd, /chown -R dev:dev \/workspace \/home\/dev$/);

console.log('workspaceOwnership tests passed');
