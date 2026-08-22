import assert from 'node:assert/strict';
import { stripTerminalQueryResponses } from './terminalControlFilter.js';

assert.equal(stripTerminalQueryResponses('y'), 'y');
assert.equal(stripTerminalQueryResponses('\r'), '\r');
assert.equal(stripTerminalQueryResponses('\x1b[?1;0c'), '');
assert.equal(stripTerminalQueryResponses('\x1b[24;80R'), '\x1b[24;80R');
assert.equal(stripTerminalQueryResponses('\x1b[6n'), '\x1b[6n');
assert.equal(stripTerminalQueryResponses('\x1b[24;80Ry'), '\x1b[24;80Ry');

console.log('terminalControlFilter tests passed');
