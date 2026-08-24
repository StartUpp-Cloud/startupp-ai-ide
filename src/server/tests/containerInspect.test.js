import assert from 'node:assert/strict';
import { classifyContainerInspectError } from '../containerManager.js';

assert.equal(classifyContainerInspectError('Error: No such object: sai-websites-monorepo-fc50f78c'), 'missing');
assert.equal(classifyContainerInspectError('Error: No such container: sai-demo'), 'missing');
assert.equal(classifyContainerInspectError('docker command timed out after 8000ms'), 'timeout');
assert.equal(classifyContainerInspectError('docker command queued too long (9000ms)'), 'timeout');
assert.equal(classifyContainerInspectError('Cannot connect to the Docker daemon'), 'error');

console.log('containerInspect tests passed');
