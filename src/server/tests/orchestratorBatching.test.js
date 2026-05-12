import assert from 'node:assert/strict';
import { batchTasks } from '../orchestratorBatching.js';

// Helper: create a minimal task stub
const task = (id, type, parallelSafe = false) => ({ id, taskType: type, parallelSafe, title: `task-${id}` });

// --- Empty input ---
assert.deepEqual(batchTasks([]), [], 'Empty task list produces no batches');

// --- All parallel-safe research tasks → single parallel batch ---
{
  const tasks = [
    task('r1', 'research', true),
    task('r2', 'research', true),
    task('r3', 'research', true),
  ];
  const batches = batchTasks(tasks);
  assert.equal(batches.length, 1, 'Contiguous parallelSafe tasks should form one batch');
  assert.equal(batches[0].parallel, true, 'Batch should be marked parallel');
  assert.equal(batches[0].tasks.length, 3, 'All three research tasks should be in the batch');
  assert.deepEqual(
    batches[0].tasks.map(t => t.id),
    ['r1', 'r2', 'r3'],
    'Task order preserved inside parallel batch',
  );
}

// --- All serial tasks → one batch per task ---
{
  const tasks = [
    task('i1', 'implementation', false),
    task('i2', 'implementation', false),
    task('v1', 'verification', false),
  ];
  const batches = batchTasks(tasks);
  assert.equal(batches.length, 3, 'Each non-parallelSafe task should be its own batch');
  for (const b of batches) {
    assert.equal(b.parallel, false, 'Serial batch should not be parallel');
    assert.equal(b.tasks.length, 1, 'Serial batch should contain exactly one task');
  }
  assert.deepEqual(
    batches.map(b => b.tasks[0].id),
    ['i1', 'i2', 'v1'],
    'Serial tasks preserve their original order',
  );
}

// --- Mixed: parallel research → serial impl → serial verification ---
{
  const tasks = [
    task('r1', 'research', true),
    task('r2', 'research', true),
    task('i1', 'implementation', false),
    task('v1', 'verification', false),
  ];
  const batches = batchTasks(tasks);
  assert.equal(batches.length, 3, 'Mixed list: 1 parallel batch + 2 serial batches');
  assert.equal(batches[0].parallel, true);
  assert.deepEqual(batches[0].tasks.map(t => t.id), ['r1', 'r2']);
  assert.equal(batches[1].parallel, false);
  assert.equal(batches[1].tasks[0].id, 'i1');
  assert.equal(batches[2].parallel, false);
  assert.equal(batches[2].tasks[0].id, 'v1');
}

// --- Mixed: serial → parallel → serial (sandwich) ---
{
  const tasks = [
    task('i1', 'implementation', false),
    task('r1', 'research', true),
    task('r2', 'research', true),
    task('r3', 'research', true),
    task('v1', 'verification', false),
  ];
  const batches = batchTasks(tasks);
  assert.equal(batches.length, 3, 'Sandwich: serial + parallel + serial = 3 batches');
  assert.equal(batches[0].parallel, false);
  assert.equal(batches[0].tasks[0].id, 'i1');
  assert.equal(batches[1].parallel, true);
  assert.equal(batches[1].tasks.length, 3);
  assert.deepEqual(batches[1].tasks.map(t => t.id), ['r1', 'r2', 'r3']);
  assert.equal(batches[2].parallel, false);
  assert.equal(batches[2].tasks[0].id, 'v1');
}

// --- Multiple disjoint parallel groups separated by serial tasks ---
{
  const tasks = [
    task('r1', 'research', true),
    task('r2', 'research', true),
    task('i1', 'implementation', false),
    task('r3', 'research', true),
    task('r4', 'research', true),
    task('v1', 'verification', false),
  ];
  const batches = batchTasks(tasks);
  assert.equal(batches.length, 4, 'Two parallel groups + two serial = 4 batches');
  assert.equal(batches[0].parallel, true);
  assert.deepEqual(batches[0].tasks.map(t => t.id), ['r1', 'r2']);
  assert.equal(batches[1].parallel, false);
  assert.equal(batches[1].tasks[0].id, 'i1');
  assert.equal(batches[2].parallel, true);
  assert.deepEqual(batches[2].tasks.map(t => t.id), ['r3', 'r4']);
  assert.equal(batches[3].parallel, false);
  assert.equal(batches[3].tasks[0].id, 'v1');
}

// --- Contiguous research-only batches do not cross implementation/verification gates ---
{
  const tasks = [
    task('r1', 'research', true),
    task('r2', 'research', true),
    task('i1', 'implementation', true),
    task('r3', 'research', true),
    task('v1', 'verification', true),
    task('r4', 'research', true),
  ];
  const batches = batchTasks(tasks);
  assert.deepEqual(
    batches.map(batch => ({ parallel: batch.parallel, ids: batch.tasks.map(t => t.id) })),
    [
      { parallel: true, ids: ['r1', 'r2'] },
      { parallel: false, ids: ['i1'] },
      { parallel: true, ids: ['r3'] },
      { parallel: false, ids: ['v1'] },
      { parallel: true, ids: ['r4'] },
    ],
    'Implementation and verification tasks must stay serial even if marked parallelSafe',
  );
}

// --- Single parallelSafe task still gets a parallel batch (Promise.all of 1 is fine) ---
{
  const batches = batchTasks([task('r1', 'research', true)]);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].parallel, true);
  assert.equal(batches[0].tasks.length, 1);
}

// --- Single serial task ---
{
  const batches = batchTasks([task('i1', 'implementation', false)]);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].parallel, false);
  assert.equal(batches[0].tasks.length, 1);
}

// --- parallelSafe only applies to research/investigation task types ---
{
  const tasks = [
    task('r1', 'research', true),
    task('i1', 'implementation', true),
    task('v1', 'verification', true),
    task('rv1', 'review', true),
    task('w1', 'write', true),
    task('g1', 'general', true),
    task('r2', 'research', true),
  ];
  const batches = batchTasks(tasks);
  assert.equal(batches.length, 7, 'Only research/investigation tasks may run in parallel');
  assert.equal(batches[0].parallel, true);
  assert.deepEqual(batches[0].tasks.map(t => t.id), ['r1']);
  for (const batch of batches.slice(1, 6)) {
    assert.equal(batch.parallel, false, 'Flagged non-research task should stay serial');
    assert.equal(batch.tasks.length, 1);
  }
  assert.equal(batches[6].parallel, true);
  assert.deepEqual(batches[6].tasks.map(t => t.id), ['r2']);
}

// --- Investigation tasks can also form explicit parallel batches ---
{
  const tasks = [
    task('inv1', 'investigation', true),
    task('inv2', 'investigation', true),
  ];
  const batches = batchTasks(tasks);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].parallel, true);
  assert.deepEqual(batches[0].tasks.map(t => t.id), ['inv1', 'inv2']);
}

// --- Parallel execution simulation: confirm concurrent start ---
{
  const started = [];
  const tasks = [
    task('r1', 'research', true),
    task('r2', 'research', true),
    task('r3', 'research', true),
  ];
  const batches = batchTasks(tasks);
  assert.equal(batches[0].parallel, true);

  // Simulate Promise.all execution: all tasks should start before any resolves
  const promises = batches[0].tasks.map(t => {
    started.push(t.id);
    return new Promise(resolve => setTimeout(() => resolve(t.id), 10));
  });
  // All three started synchronously before awaiting
  assert.equal(started.length, 3, 'All parallelSafe tasks should start concurrently');
  assert.deepEqual(started, ['r1', 'r2', 'r3']);
  const results = await Promise.all(promises);
  assert.deepEqual(results, ['r1', 'r2', 'r3'], 'All parallel tasks resolve');
}

// --- Serial execution simulation: confirm sequential ordering ---
{
  const order = [];
  const tasks = [
    task('i1', 'implementation', false),
    task('i2', 'implementation', false),
  ];
  const batches = batchTasks(tasks);
  // Each serial batch should execute one at a time
  for (const batch of batches) {
    assert.equal(batch.parallel, false);
    for (const t of batch.tasks) {
      order.push(t.id);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  assert.deepEqual(order, ['i1', 'i2'], 'Serial tasks execute in order');
}

// --- Mixed execution simulation: parallel batch completes before serial starts ---
{
  const timeline = [];
  const tasks = [
    task('r1', 'research', true),
    task('r2', 'research', true),
    task('i1', 'implementation', false),
  ];
  const batches = batchTasks(tasks);

  for (const batch of batches) {
    if (batch.parallel) {
      const promises = batch.tasks.map(t => {
        timeline.push({ id: t.id, event: 'start' });
        return new Promise(resolve => setTimeout(() => {
          timeline.push({ id: t.id, event: 'end' });
          resolve();
        }, 10));
      });
      await Promise.all(promises);
    } else {
      const t = batch.tasks[0];
      timeline.push({ id: t.id, event: 'start' });
      await new Promise(resolve => setTimeout(resolve, 5));
      timeline.push({ id: t.id, event: 'end' });
    }
  }

  // Both research tasks start before either ends (concurrent)
  const r1Start = timeline.findIndex(e => e.id === 'r1' && e.event === 'start');
  const r2Start = timeline.findIndex(e => e.id === 'r2' && e.event === 'start');
  const r1End = timeline.findIndex(e => e.id === 'r1' && e.event === 'end');
  const i1Start = timeline.findIndex(e => e.id === 'i1' && e.event === 'start');

  assert.ok(r2Start < r1End, 'r2 should start before r1 ends (concurrent)');
  assert.ok(i1Start > r1End, 'Implementation task should start after parallel batch completes');
}

console.log('orchestratorBatching tests passed');
