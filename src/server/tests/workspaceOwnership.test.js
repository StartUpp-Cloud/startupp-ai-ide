import assert from 'node:assert/strict';
import {
  PROJECT_CONTAINER_RESTART_POLICY,
  buildCreateContainerCommand,
  workspaceChownCommand,
} from '../containerManager.js';

const cmd = workspaceChownCommand('sai-demo-abcd1234');
assert.match(cmd, /^docker exec -u root sai-demo-abcd1234 /);
assert.match(cmd, /chown -R dev:dev \/workspace \/home\/dev$/);

const create = buildCreateContainerCommand({
  containerName: 'sai-demo-abcd1234',
  homeVolume: 'sai-demo-abcd1234-home',
  workspaceVolume: 'sai-demo-abcd1234-workspace',
  projectId: 'abcd1234-5678',
  gitUrl: 'https://example.com/repo.git',
  image: 'sai-dev:local',
});
assert.match(create, /docker create/);
assert.match(create, /--restart unless-stopped/);
assert.match(create, /--name sai-demo-abcd1234/);
assert.equal(PROJECT_CONTAINER_RESTART_POLICY, 'unless-stopped');

console.log('workspaceOwnership tests passed');
