/**
 * Persistent ChatGPT/Codex account quota (not in-run progress).
 * Reads `account/rateLimits/read` from `codex app-server` and caches
 * a compact snapshot next to the IDE data dir.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDockerSpawnSpec } from './dockerRoute.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CODEX_ACCOUNT_STATUS_PATH = path.join(__dirname, '../../data/codex-account-status.json');
export const CODEX_BIN_IN_CONTAINER = '/home/dev/.npm-global/bin/codex';
const DEFAULT_TIMEOUT_MS = 20000;
const STALE_MS = 15 * 60 * 1000;
const inflight = new Map();

const PLAN_LABELS = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  prolite: 'Pro Lite',
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
};

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function toIso(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const used = n <= 1 && n > 0 && n !== 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(used)));
}

export function labelForWindowMinutes(mins) {
  const n = Number(mins);
  if (!Number.isFinite(n) || n <= 0) return 'Limit';
  if (n >= 60 * 24 * 6 && n <= 60 * 24 * 8) return 'Weekly';
  if (n >= 280 && n <= 320) return '5h';
  if (n >= 1400 && n <= 1500) return 'Daily';
  if (n >= 40000 && n <= 45000) return 'Monthly';
  if (n % (60 * 24) === 0) return `${n / (60 * 24)}d`;
  if (n % 60 === 0) return `${n / 60}h`;
  return `${n}m`;
}

function normalizeWindow(raw, fallbackId) {
  const obj = asObject(raw);
  if (!obj) return null;
  const usedPercent = clampPercent(obj.usedPercent ?? obj.used_percent);
  if (usedPercent == null) return null;
  const mins = obj.windowDurationMins ?? obj.window_duration_mins ?? obj.windowDurationMinutes;
  return {
    id: fallbackId,
    label: labelForWindowMinutes(mins),
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    windowDurationMins: Number.isFinite(Number(mins)) ? Number(mins) : null,
    resetsAt: toIso(obj.resetsAt ?? obj.resets_at),
  };
}

function planLabel(plan) {
  const key = String(plan || '').trim().toLowerCase();
  if (!key) return '';
  return PLAN_LABELS[key] || key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function pickRateLimits(raw) {
  const root = asObject(raw?.result) || asObject(raw);
  if (!root) return null;
  return asObject(root.rateLimits) || asObject(root.rate_limits) || null;
}

export function normalizeCodexAccountStatus(raw, fetchedAt = Date.now()) {
  const root = asObject(raw?.result) || asObject(raw) || {};
  const limits = pickRateLimits(raw);
  const primary = normalizeWindow(limits?.primary, 'primary');
  const secondary = normalizeWindow(limits?.secondary, 'secondary');
  const windows = [primary, secondary].filter(Boolean)
    .sort((a, b) => (a.windowDurationMins || 0) - (b.windowDurationMins || 0));
  const extra = Object.entries(asObject(root.rateLimitsByLimitId) || asObject(root.rate_limits_by_limit_id) || {})
    .filter(([id]) => id && id !== 'codex' && id !== limits?.limitId)
    .map(([id, snapshot]) => {
      const extraWindows = [
        normalizeWindow(snapshot?.primary, 'primary'),
        normalizeWindow(snapshot?.secondary, 'secondary'),
      ].filter(Boolean);
      return extraWindows.length ? {
        id,
        label: snapshot?.limitName || snapshot?.limit_name || id,
        windows: extraWindows,
      } : null;
    })
    .filter(Boolean);

  const credits = asObject(root.rateLimitResetCredits) || asObject(root.rate_limit_reset_credits);
  const plan = String(limits?.planType || limits?.plan_type || '').trim();
  const fetched = typeof fetchedAt === 'string' ? fetchedAt : new Date(fetchedAt).toISOString();
  const tightest = windows.slice().sort((a, b) => a.remainingPercent - b.remainingPercent)[0] || null;

  if (!windows.length) {
    return {
      ok: false,
      plan: plan || null,
      planLabel: planLabel(plan),
      windows: [],
      extra: [],
      tightest: null,
      resetCredits: Number(credits?.availableCount ?? credits?.available_count) || 0,
      fetchedAt: fetched,
      error: 'No Codex rate limits returned',
    };
  }

  return {
    ok: true,
    plan: plan || null,
    planLabel: planLabel(plan),
    windows,
    extra,
    tightest,
    resetCredits: Number(credits?.availableCount ?? credits?.available_count) || 0,
    fetchedAt: fetched,
    error: null,
  };
}

export function loadPersistedCodexAccountStatus(filePath, projectId) {
  if (!projectId) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const entry = asObject(data)?.[projectId];
    return entry?.ok || entry?.error ? entry : null;
  } catch {
    return null;
  }
}

export function persistCodexAccountStatus(filePath, projectId, status) {
  if (!projectId || !status) return status;
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    data = {};
  }
  if (!asObject(data)) data = {};
  data[projectId] = status;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
  return status;
}

export function isCodexAccountStatusFresh(status, now = Date.now()) {
  if (!status?.fetchedAt) return false;
  const at = Date.parse(status.fetchedAt);
  return Number.isFinite(at) && (now - at) < STALE_MS;
}

function sendRpc(child, payload) {
  if (!child?.stdin?.writable) throw new Error('codex app-server stdin is closed');
  child.stdin.write(`${JSON.stringify(payload)}\n`);
}

export function queryCodexAccountRateLimits({ spawnFn = spawn, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn();
    } catch (err) {
      reject(err);
      return;
    }

    let buf = '';
    const pending = new Map();
    let settled = false;
    const timer = setTimeout(() => finish(new Error(`Timed out after ${timeoutMs}ms reading Codex account status`)), timeoutMs);

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch {}
      if (err) reject(err);
      else resolve(value);
    };

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) return;
      let msg;
      try { msg = JSON.parse(trimmed); } catch { return; }
      if (msg?.id == null) return;
      const waiter = pending.get(msg.id);
      if (!waiter) return;
      pending.delete(msg.id);
      if (msg.error) {
        waiter.reject(new Error(msg.error.message || 'Codex account request failed'));
        return;
      }
      waiter.resolve(msg.result);
    };

    const request = (id, method, params) => new Promise((res, rej) => {
      pending.set(id, { resolve: res, reject: rej });
      sendRpc(child, params === undefined ? { method, id } : { method, id, params });
    });

    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    });
    child.stderr.on('data', () => {});
    child.on('error', (err) => finish(err));
    child.on('exit', (code) => {
      if (!settled) finish(new Error(`codex app-server exited (${code ?? 'unknown'})`));
    });

    Promise.resolve()
      .then(() => request(1, 'initialize', {
        clientInfo: { name: 'startupp_ai_ide', title: 'StartUpp AI IDE', version: '0.1.0' },
        capabilities: { experimentalApi: false, requestAttestation: false, optOutNotificationMethods: [] },
      }))
      .then(() => {
        sendRpc(child, { method: 'initialized' });
        return request(2, 'account/rateLimits/read');
      })
      .then((result) => finish(null, normalizeCodexAccountStatus(result)))
      .catch((err) => finish(err));
  });
}

function spawnCodexAppServer({ containerName } = {}) {
  if (containerName) {
    const spec = getDockerSpawnSpec([
      'exec', '-i', '-u', 'dev',
      '-e', 'HOME=/home/dev',
      '-e', `PATH=/home/dev/.npm-global/bin:/usr/local/bin:/usr/bin:/bin`,
      '-w', '/workspace',
      containerName,
      CODEX_BIN_IN_CONTAINER,
      'app-server',
      '--stdio',
    ]);
    return spawn(spec.cmd, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  }
  return spawn('codex', ['app-server', '--stdio'], {
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

export async function getCodexAccountStatus({
  projectId,
  containerName = null,
  refresh = false,
  storePath = CODEX_ACCOUNT_STATUS_PATH,
  spawnFn = null,
} = {}) {
  const cached = loadPersistedCodexAccountStatus(storePath, projectId);
  if (!refresh && cached && isCodexAccountStatusFresh(cached)) {
    return { ...cached, cached: true };
  }

  const key = `${projectId || containerName || 'default'}`;
  if (inflight.has(key)) return inflight.get(key);

  const pending = (async () => {
    try {
      const status = await queryCodexAccountRateLimits({
        spawnFn: spawnFn || (() => spawnCodexAppServer({ containerName })),
      });
      persistCodexAccountStatus(storePath, projectId, status);
      return { ...status, cached: false };
    } catch (err) {
      const failed = {
        ...(cached || normalizeCodexAccountStatus({})),
        ok: cached?.ok || false,
        error: err.message || 'Failed to read Codex account status',
        fetchedAt: cached?.fetchedAt || new Date().toISOString(),
        cached: !!cached,
      };
      if (!cached) persistCodexAccountStatus(storePath, projectId, failed);
      return failed;
    }
  })().finally(() => inflight.delete(key));

  inflight.set(key, pending);
  return pending;
}

export async function refreshAndBroadcastCodexAccountStatus({
  projectId,
  containerName,
  broadcastFn,
  sessionId = null,
} = {}) {
  const status = await getCodexAccountStatus({ projectId, containerName, refresh: true });
  if (typeof broadcastFn === 'function') {
    try {
      broadcastFn({
        type: 'codex-account-status',
        projectId,
        sessionId,
        status,
      });
    } catch {}
  }
  return status;
}
