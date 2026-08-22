import assert from 'node:assert/strict';
import { interactiveDockerExecArgs, dockerCliPath, dockerCliEnv } from '../dockerRoute.js';

const execArgs = interactiveDockerExecArgs({
  containerName: 'sai-demo',
  workDir: '/workspace',
  command: ['bash', '-l'],
});
assert.deepEqual(execArgs.slice(0, 2), ['exec', '-it']);
assert.ok(execArgs.includes('bash'));
assert.ok(!execArgs.includes('script'));
assert.equal(execArgs[execArgs.indexOf('-w') + 1], '/workspace');
assert.equal(execArgs[execArgs.indexOf('-w') + 2], 'sai-demo');

assert.equal(dockerCliPath('/app/docker/Dockerfile.dev'), '/app/docker/Dockerfile.dev');
assert.equal(dockerCliEnv({ PATH: '/usr/bin' }).DOCKER_CLI_HINTS, 'false');

console.log('dockerRoute tests passed');
