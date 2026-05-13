import assert from 'node:assert/strict';
import { LONG_RUNNING_ASSISTANT_STALL_MS } from '../agentGateway.js';
import { jobManager } from '../jobManager.js';

const sixHours = 6 * 60 * 60 * 1000;

assert.ok(
  LONG_RUNNING_ASSISTANT_STALL_MS >= sixHours,
  'Claude/OpenCode CLI sessions should only be considered stalled after hours of silence',
);

assert.ok(
  jobManager.config.activityTimeoutMs >= sixHours,
  'Job activity timeout should allow assistants to run quietly for hours',
);

assert.equal(
  jobManager.config.hardTimeoutMs,
  null,
  'Active assistant jobs should not have a wall-clock hard timeout',
);

console.log('longRunningAssistants tests passed');
