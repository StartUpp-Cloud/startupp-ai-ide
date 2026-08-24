import assert from 'node:assert/strict';
import {
  interactiveDockerExecArgs,
  agentDockerExecArgs,
  containerAgentShellPrelude,
  CONTAINER_CLOUDFLARE_ENV,
  dockerCliPath,
  dockerCliEnv,
  isDockerAvailable,
  getDockerRouteStatus,
} from '../dockerRoute.js';

const execArgs = interactiveDockerExecArgs({
  containerName: 'sai-demo',
  workDir: '/workspace',
  command: ['bash', '-l'],
});
assert.deepEqual(execArgs.slice(0, 2), ['exec', '-it']);
assert.equal(execArgs[execArgs.indexOf('-e') + 1], 'HOME=/home/dev');
assert.ok(execArgs.includes('bash'));
assert.ok(!execArgs.includes('script'));
assert.equal(execArgs[execArgs.indexOf('-w') + 1], '/workspace');
assert.equal(execArgs[execArgs.indexOf('-w') + 2], 'sai-demo');

const agentArgs = agentDockerExecArgs({
  containerName: 'sai-openava',
  workDir: '/workspace/openava.app',
});
assert.deepEqual(agentArgs.slice(0, 2), ['exec', '-i']);
assert.ok(!agentArgs.includes('-it'));
assert.equal(agentArgs[agentArgs.indexOf('-e') + 1], 'HOME=/home/dev');
assert.equal(agentArgs[agentArgs.indexOf('-w') + 1], '/workspace/openava.app');
assert.equal(agentArgs[agentArgs.indexOf('-w') + 2], 'sai-openava');
assert.deepEqual(agentArgs.slice(-4), ['setsid', '-w', 'bash', '-s']);

const prelude = containerAgentShellPrelude();
assert.match(prelude, new RegExp(CONTAINER_CLOUDFLARE_ENV.replace(/\./g, '\\.')));
assert.match(prelude, /\[ -f .* \] && \./);

assert.equal(dockerCliPath('/app/docker/Dockerfile.dev'), '/app/docker/Dockerfile.dev');
assert.equal(dockerCliEnv({ PATH: '/usr/bin' }).DOCKER_CLI_HINTS, 'false');
assert.equal(typeof isDockerAvailable(), 'boolean');
assert.equal(getDockerRouteStatus().dockerAvailable, isDockerAvailable());

console.log('dockerRoute tests passed');
