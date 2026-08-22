const assert = require('node:assert/strict');
const {
  planPm2Action,
  parsePm2Args,
  PM2_ACTIONS,
} = require('../../../scripts/pm2-host.cjs');
const { assertSafeDockerArgs } = require('../../../scripts/compose-host.cjs');

assert.deepEqual([...PM2_ACTIONS].sort(), ['logs', 'restart', 'start', 'status', 'stop', 'uninstall']);

const start = planPm2Action('start');
assert.equal(start.gitPull, true);
assert.equal(start.build, true);
assert.equal(start.start, true);
assert.equal(start.detach, true);
assert.equal(start.removeImage, false);
assert.equal(start.removeVolumes, false);

const restart = planPm2Action('restart');
assert.equal(restart.gitPull, true);
assert.equal(restart.build, true);
assert.equal(restart.start, true);
assert.equal(restart.removeImage, false);
assert.equal(restart.removeVolumes, false);

const stop = planPm2Action('stop');
assert.equal(stop.gitPull, false);
assert.equal(stop.build, false);
assert.equal(stop.start, false);
assert.equal(stop.stop, true);
assert.equal(stop.removeContainer, false);
assert.equal(stop.removeImage, false);
assert.equal(stop.removeVolumes, false);

const uninstall = planPm2Action('uninstall');
assert.equal(uninstall.stop, true);
assert.equal(uninstall.removeContainer, true);
assert.equal(uninstall.removeImage, false);
assert.equal(uninstall.removeVolumes, false);
assert.equal(uninstall.build, false);

assert.throws(() => planPm2Action('prune'), /Unknown/);

assert.deepEqual(parsePm2Args(['start', '--dev']), {
  action: 'start',
  dev: true,
  bind: false,
  composeArgs: ['up', '--build'],
});
assert.deepEqual(parsePm2Args(['stop']), {
  action: 'stop',
  dev: false,
  bind: false,
  composeArgs: ['up', '--build'],
});

assert.doesNotThrow(() => assertSafeDockerArgs(['rm', '-f', 'sai-ide']));
assert.doesNotThrow(() => assertSafeDockerArgs(['stop', 'sai-ide']));
assert.doesNotThrow(() => assertSafeDockerArgs(['run', '-d', '-v', 'sai-ide-data:/app/data', 'startupp-ai-ide:latest']));
assert.doesNotThrow(() => assertSafeDockerArgs(['compose', 'down']));
assert.throws(() => assertSafeDockerArgs(['rmi', 'startupp-ai-ide:latest']), /images/i);
assert.throws(() => assertSafeDockerArgs(['image', 'rm', 'startupp-ai-ide:latest']), /images/i);
assert.throws(() => assertSafeDockerArgs(['volume', 'rm', 'sai-ide-data']), /volumes/i);
assert.throws(() => assertSafeDockerArgs(['rm', '-v', 'sai-ide']), /volumes/i);
assert.throws(() => assertSafeDockerArgs(['compose', 'down', '-v']), /volumes/i);
assert.throws(() => assertSafeDockerArgs(['compose', 'down', '--volumes']), /volumes/i);

console.log('pm2Host tests passed');
