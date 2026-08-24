import assert from 'node:assert/strict';
import { createCodexStatusTracker, extractJsonlEvents, ingestCodexStatusEvent } from '../codexStatus.js';

const idle = ingestCodexStatusEvent(undefined, { type: 'turn.started' });
assert.equal(idle.phase, 'running');
assert.equal(idle.label, 'Thinking');
assert.ok(idle.percent >= 6 && idle.percent < 20);

const withTodos = ingestCodexStatusEvent(idle, {
  type: 'item.updated',
  item: {
    type: 'todo_list',
    items: [
      { text: 'Scan repo', completed: true },
      { text: 'Edit files', completed: false },
      { text: 'Verify', completed: false },
    ],
  },
});
assert.equal(withTodos.todoDone, 1);
assert.equal(withTodos.todoTotal, 3);
assert.equal(withTodos.percent, 33);

const running = ingestCodexStatusEvent(withTodos, {
  type: 'item.started',
  item: { type: 'command_execution', command: 'npm test', status: 'in_progress' },
});
assert.match(running.label, /npm test/);

const done = ingestCodexStatusEvent(running, { type: 'turn.completed', usage: { input_tokens: 10 } });
assert.equal(done.phase, 'done');
assert.equal(done.percent, 100);
assert.equal(done.label, 'Done');

const tracker = createCodexStatusTracker();
assert.equal(tracker.snapshot().phase, 'idle');
tracker.ingest({ type: 'turn.started' });
const snap = tracker.ingest({
  type: 'item.completed',
  item: { type: 'file_change', changes: [{ path: 'src/app.js', kind: 'update' }] },
});
assert.match(snap.label, /app\.js/);
assert.ok(snap.percent > 6 && snap.percent < 100);

const split = extractJsonlEvents('{"type":"turn.started"}\n{"type":"item.started","item":{"type":"command_execution","command":"ls"}');
assert.equal(split.events.length, 1);
assert.equal(split.events[0].type, 'turn.started');
assert.match(split.remainder, /command_execution/);

console.log('codexStatus tests passed');
