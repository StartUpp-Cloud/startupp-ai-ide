import assert from 'node:assert/strict';
import {
  CLI_TURN_IDLE_MS,
  CLI_TURN_MAX_MS,
  LONG_RUNNING_ASSISTANT_STALL_MS,
} from '../agentGateway.js';
import { jobManager } from '../jobManager.js';

const sixHours = 6 * 60 * 60 * 1000;
const twelveHours = 12 * 60 * 60 * 1000;

assert.ok(
  LONG_RUNNING_ASSISTANT_STALL_MS >= sixHours,
  'Claude/OpenCode CLI sessions should only be considered stalled after hours of silence',
);

assert.ok(
  CLI_TURN_IDLE_MS >= sixHours,
  'Codex/Cursor spawn turns should tolerate hours of quiet builds/tests without idle-killing',
);

assert.ok(
  CLI_TURN_MAX_MS >= twelveHours,
  'Codex/Cursor spawn turns should allow multi-hour coding sessions before any hard ceiling',
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
