import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  createDockerBroker,
  DOCKER_MAX_CONCURRENT,
  DOCKER_PROBE_TIMEOUT_MS,
} from '../dockerBroker.js';

function hangingSpawn() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { child.killed = true; };
  child.unref = () => { child.unrefed = true; };
  return child;
}

const spawned = [];
const broker = createDockerBroker({
  spawnFn: () => {
    const child = hangingSpawn();
    spawned.push(child);
    return child;
  },
});

assert.equal(broker.isDockerAvailable(), true);
assert.equal(spawned.length, 0, 'availability cache must not spawn docker on the request path');

const started = Date.now();
await assert.rejects(
  () => broker.runCommand('docker info', { timeout: 80 }),
  /timed out/,
);
assert.ok(Date.now() - started < 1000, 'timeout must not wait on a wedged docker child');
assert.equal(spawned[0].killed, true);
assert.equal(spawned[0].unrefed, true);

const children = [];
const limited = createDockerBroker({
  spawnFn: () => {
    const child = hangingSpawn();
    children.push(child);
    return child;
  },
});
const jobs = Array.from({ length: DOCKER_MAX_CONCURRENT + 2 }, (_, i) =>
  limited.runCommand(`docker ps ${i}`, { timeout: 200 }).catch((err) => err.message),
);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(children.length, DOCKER_MAX_CONCURRENT);
const snapshot = limited.snapshot();
assert.equal(snapshot.running, DOCKER_MAX_CONCURRENT);
assert.ok(snapshot.queued >= 1);

await Promise.all(jobs);
assert.ok(DOCKER_PROBE_TIMEOUT_MS <= 5000);

const overflowed = createDockerBroker({
  spawnFn: hangingSpawn,
});
const overflowJobs = Array.from({ length: DOCKER_MAX_CONCURRENT + 30 }, (_, i) =>
  overflowed.runCommand(`docker overflow ${i}`, { timeout: 500 }).catch((err) => err.message),
);
const overflowResults = await Promise.all(overflowJobs);
assert.ok(overflowResults.some((msg) => /queue is full/.test(msg)));

console.log('dockerBroker tests passed');
