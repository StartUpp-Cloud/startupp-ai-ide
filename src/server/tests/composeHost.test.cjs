const assert = require('node:assert/strict');
const path = require('node:path');
const {
  WIN_PIPE,
  hostDockerEnv,
  composeFiles,
  parseArgs,
  startPlan,
  applyStartPlanToComposeArgs,
  assertSafeDockerArgs,
} = require('../../../scripts/compose-host.cjs');

const env = hostDockerEnv({ PATH: 'C:\\Windows' }, 'win32');
assert.equal(env.DOCKER_HOST, WIN_PIPE);
assert.equal(env.DOCKER_CONTEXT, 'default');
assert.match(env.DOCKER_CONFIG, /docker[\\/]cli-config$/);
assert.equal(env.DOCKER_CLI_HINTS, 'false');
assert.equal(env.DOCKER_BUILDKIT, '1');
assert.equal(env.COMPOSE_BAKE, 'false');
assert.equal(env.BUILDX_BUILDER, undefined);

const linuxEnv = hostDockerEnv({ PATH: '/usr/bin' }, 'linux');
assert.equal(linuxEnv.DOCKER_HOST, undefined);
assert.equal(linuxEnv.DOCKER_BUILDKIT, '1');

const winFiles = composeFiles({ dev: true, platform: 'win32' });
assert.ok(winFiles.some((f) => f.endsWith('compose.sock.windows.yaml')));
assert.ok(!winFiles.some((f) => f.endsWith('compose.dev.bind.yaml')));
assert.ok(!winFiles.some((f) => f.endsWith(`${path.sep}compose.sock.yaml`)));

const winBind = composeFiles({ dev: true, bind: true, platform: 'win32' });
assert.ok(winBind.some((f) => f.endsWith('compose.dev.bind.yaml')));

const linuxDev = composeFiles({ dev: true, platform: 'linux' });
assert.ok(linuxDev.some((f) => f.endsWith('compose.dev.bind.yaml')));

const linuxFiles = composeFiles({ platform: 'linux' });
assert.ok(linuxFiles.some((f) => f.endsWith('compose.sock.yaml')));

assert.deepEqual(parseArgs([]), { dev: false, bind: false, composeArgs: ['up', '--build'] });
assert.deepEqual(parseArgs(['dev', 'up']), { dev: true, bind: false, composeArgs: ['up'] });

const plan = startPlan();
assert.equal(plan.pull, true);
assert.equal(plan.rebuild, true);
assert.equal(plan.removeVolumes, false);
assert.ok(plan.preserveVolumes.includes('sai-ide-data'));
assert.ok(plan.preserveVolumes.includes('sai-ide-home'));

assert.deepEqual(applyStartPlanToComposeArgs(['up']), ['up', '--build']);
assert.deepEqual(applyStartPlanToComposeArgs(['up', '--build']), ['up', '--build']);
assert.deepEqual(applyStartPlanToComposeArgs(['down', '-v', '--volumes']), ['down']);
assert.deepEqual(applyStartPlanToComposeArgs(['stop']), ['stop']);
assert.deepEqual(applyStartPlanToComposeArgs(['logs', '-f']), ['logs', '-f']);
assert.doesNotThrow(() => assertSafeDockerArgs(['stop', 'sai-ide']));
assert.throws(() => assertSafeDockerArgs(['rmi', 'startupp-ai-ide:latest']), /images/i);

console.log('composeHost tests passed');
