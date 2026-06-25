import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { computeMsUntilNextRun } from '../scheduler.js';

// 2026-01-01 Thursday 08:00:00 local time
const THU_0800 = new Date(2026, 0, 1, 8, 0, 0).getTime();

test('daily: time later today returns ms to today', () => {
  // 09:30 is 1.5h after 08:00
  const ms = computeMsUntilNextRun({ frequency: 'daily', timeOfDay: '09:30' }, THU_0800);
  assert.strictEqual(ms, 90 * 60 * 1000); // 5400000
});

test('daily: time already passed today returns ms to tomorrow', () => {
  // 07:00 already passed (08:00 now) → next is 07:00 tomorrow = 23h from now
  const ms = computeMsUntilNextRun({ frequency: 'daily', timeOfDay: '07:00' }, THU_0800);
  assert.strictEqual(ms, 23 * 60 * 60 * 1000); // 82800000
});

test('daily: exact same time pushes to tomorrow', () => {
  // 08:00 exactly = not in the future → tomorrow at 08:00 = 24h
  const ms = computeMsUntilNextRun({ frequency: 'daily', timeOfDay: '08:00' }, THU_0800);
  assert.strictEqual(ms, 24 * 60 * 60 * 1000); // 86400000
});

test('weekly: next weekday in future (Friday=5) from Thursday', () => {
  // Thursday 08:00, next Friday 09:00 = 25h
  const ms = computeMsUntilNextRun({ frequency: 'weekly', timeOfDay: '09:00', dayOfWeek: 5 }, THU_0800);
  assert.strictEqual(ms, 25 * 60 * 60 * 1000); // 90000000
});

test('weekly: same weekday time not yet passed returns ms to today', () => {
  // Thursday 08:00, target Thursday 10:00 = 2h
  const ms = computeMsUntilNextRun({ frequency: 'weekly', timeOfDay: '10:00', dayOfWeek: 4 }, THU_0800);
  assert.strictEqual(ms, 2 * 60 * 60 * 1000); // 7200000
});

test('weekly: same weekday time already passed → next week', () => {
  // Thursday 08:00, target Thursday 07:00 → next week Thursday 07:00 = 7*24h - 1h = 167h
  const ms = computeMsUntilNextRun({ frequency: 'weekly', timeOfDay: '07:00', dayOfWeek: 4 }, THU_0800);
  assert.strictEqual(ms, (7 * 24 - 1) * 60 * 60 * 1000); // 601200000
});

test('weekly: Sunday (0) from Thursday', () => {
  // Thursday 08:00 → Sunday 12:00 = 3 days + 4h = 76h
  const ms = computeMsUntilNextRun({ frequency: 'weekly', timeOfDay: '12:00', dayOfWeek: 0 }, THU_0800);
  assert.strictEqual(ms, (3 * 24 + 4) * 60 * 60 * 1000); // 273600000
});

test('always returns a positive value', () => {
  const ms = computeMsUntilNextRun({ frequency: 'daily', timeOfDay: '00:00' }, THU_0800);
  assert.ok(ms > 0, `Expected ms > 0, got ${ms}`);
});
