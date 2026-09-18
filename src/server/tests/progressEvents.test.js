import assert from 'node:assert/strict';
import { classifyProgress } from '../../shared/progressEvents.js';

assert.equal(classifyProgress('Reading: `src/server/agentGateway.js`').kind, 'read');
assert.equal(classifyProgress('Reading: `src/server/agentGateway.js`').summary, 'Read src/server/agentGateway.js');

assert.equal(classifyProgress('Editing: `src/client/src/components/ChatMessage.jsx`').kind, 'edit');
assert.match(classifyProgress('Editing: `src/client/src/components/ChatMessage.jsx`').summary, /^Edit /);

assert.equal(classifyProgress('Running: `npm test`').kind, 'test');
assert.equal(classifyProgress('Running: `ls -la`').kind, 'run');
assert.equal(classifyProgress('Searching: AskUserQuestion').kind, 'search');
assert.equal(classifyProgress('Thinking...').kind, 'think');
assert.equal(classifyProgress('The coding agent needs your input before it can continue.').kind, 'blocked');
assert.equal(classifyProgress('Sending to claude...').kind, 'other');

console.log('progressEvents tests passed');
