import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import {
  loadPersistedCodexAccountStatus,
  normalizeCodexAccountStatus,
  persistCodexAccountStatus,
  queryCodexAccountRateLimits,
} from '../codexAccountStatus.js';

const raw = {
  rateLimits: {
    limitId: 'codex',
    planType: 'prolite',
    primary: { usedPercent: 28, windowDurationMins: 10080, resetsAt: 1788030315 },
    secondary: { usedPercent: 9, windowDurationMins: 300, resetsAt: 1787437275 },
  },
  rateLimitsByLimitId: {
    codex_bengalfox: {
      limitName: 'GPT-5.3-Codex-Spark',
      primary: { usedPercent: 15, windowDurationMins: 300, resetsAt: 1787437275 },
    },
  },
  rateLimitResetCredits: { availableCount: 1 },
};

const status = normalizeCodexAccountStatus(raw, 1_700_000_000_000);
assert.equal(status.ok, true);
assert.equal(status.plan, 'prolite');
assert.equal(status.planLabel, 'Pro Lite');
assert.equal(status.resetCredits, 1);
assert.equal(status.windows[0].label, '5h');
assert.equal(status.windows[0].remainingPercent, 91);
assert.equal(status.windows[1].label, 'Weekly');
assert.equal(status.windows[1].remainingPercent, 72);
assert.equal(status.tightest.remainingPercent, 72);
assert.match(status.windows[0].resetsAt, /T/);
assert.equal(status.extra[0].label, 'GPT-5.3-Codex-Spark');

const dir = mkdtempSync(join(tmpdir(), 'codex-account-'));
const file = join(dir, 'status.json');
persistCodexAccountStatus(file, 'proj-1', status);
const loaded = loadPersistedCodexAccountStatus(file, 'proj-1');
assert.equal(loaded.plan, 'prolite');
assert.equal(JSON.parse(readFileSync(file, 'utf8'))['proj-1'].ok, true);

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.stdin = {
      writable: true,
      writes: [],
      write: (chunk) => {
        this.stdin.writes.push(String(chunk));
        const msg = JSON.parse(String(chunk).trim());
        if (msg.method === 'initialize') {
          queueMicrotask(() => this.stdout.emit('data', `${JSON.stringify({ id: msg.id, result: { userAgent: 'codex' } })}\n`));
        }
        if (msg.method === 'account/rateLimits/read') {
          queueMicrotask(() => this.stdout.emit('data', `${JSON.stringify({ id: msg.id, result: raw })}\n`));
        }
        return true;
      },
      end() {},
    };
    this.killed = false;
    queueMicrotask(() => this.emit('spawn'));
  }
  kill() { this.killed = true; }
}

const queried = await queryCodexAccountRateLimits({
  spawnFn: () => new FakeChild(),
  timeoutMs: 1000,
});
assert.equal(queried.ok, true);
assert.equal(queried.tightest.remainingPercent, 72);

console.log('codexAccountStatus tests passed');
