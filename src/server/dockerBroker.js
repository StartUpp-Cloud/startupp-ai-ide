/**
 * Non-blocking Docker CLI runner.
 *
 * The HTTP process must never `execSync`/`execFileSync` docker. When the
 * engine socket wedges (common on Docker Desktop), those calls freeze the
 * whole API — including /api/health. This broker:
 *   - runs docker via `spawn` (event loop stays free)
 *   - caps concurrency
 *   - times out and unrefs hung children (D-state cannot block Node)
 *   - caches availability so status polls are instant
 */

import { spawn } from 'node:child_process';

export const DOCKER_PROBE_TIMEOUT_MS = 4000;
export const DOCKER_COMMAND_TIMEOUT_MS = 20000;
export const DOCKER_MAX_CONCURRENT = 4;
export const DOCKER_MAX_QUEUE = 24;
export const DOCKER_AVAILABILITY_TTL_MS = 15000;

export function dockerEnv(base = process.env) {
  return {
    ...base,
    DOCKER_CLI_HINTS: 'false',
    DOCKER_SCAN_SUGGEST: 'false',
  };
}

/**
 * @param {{ spawnFn?: typeof spawn, nowFn?: () => number }} [deps]
 */
export function createDockerBroker(deps = {}) {
  const spawnFn = deps.spawnFn || spawn;
  const nowFn = deps.nowFn || Date.now;

  let available = true;
  let cachedAt = 0;
  let probing = false;
  let watchdog = null;
  let running = 0;
  const queue = [];

  function snapshot() {
    return {
      dockerAvailable: available,
      cachedAt,
      probing,
      running,
      queued: queue.length,
    };
  }

  function isDockerAvailable() {
    return available;
  }

  function setAvailable(value) {
    available = Boolean(value);
    cachedAt = nowFn();
  }

  function invalidate() {
    cachedAt = 0;
  }

  function enqueue(fn, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (queue.length >= DOCKER_MAX_QUEUE) {
        reject(new Error('docker command queue is full'));
        return;
      }
      const job = {
        fn,
        resolve,
        reject,
        timeoutMs,
        enqueuedAt: nowFn(),
      };
      queue.push(job);
      pump();
    });
  }

  function pump() {
    while (running < DOCKER_MAX_CONCURRENT && queue.length > 0) {
      const job = queue.shift();
      const waited = nowFn() - job.enqueuedAt;
      if (waited >= job.timeoutMs) {
        job.reject(new Error(`docker command queued too long (${waited}ms)`));
        continue;
      }
      running += 1;
      Promise.resolve()
        .then(() => job.fn())
        .then(job.resolve, job.reject)
        .finally(() => {
          running -= 1;
          pump();
        });
    }
  }

  function spawnShell(cmd, { timeout = DOCKER_COMMAND_TIMEOUT_MS, env } = {}) {
    const timeoutMs = Math.max(250, Number(timeout) || DOCKER_COMMAND_TIMEOUT_MS);
    return new Promise((resolve, reject) => {
      const child = spawnFn('sh', ['-c', cmd], {
        env: dockerEnv(env),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;

      const settle = (err, out = '') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(out);
      };

      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        try { child.unref(); } catch { /* ignore */ }
        settle(new Error(`docker command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      if (child.stdout) {
        if (typeof child.stdout.setEncoding === 'function') child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => { stdout += chunk; });
      }
      if (child.stderr) {
        if (typeof child.stderr.setEncoding === 'function') child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => { stderr += chunk; });
      }
      child.on('error', (err) => settle(err));
      child.on('close', (code) => {
        if (code === 0) settle(null, stdout);
        else settle(new Error((stderr || stdout || `exit ${code}`).trim()));
      });
    });
  }

  function runCommand(cmd, opts = {}) {
    const timeout = opts.timeout || DOCKER_COMMAND_TIMEOUT_MS;
    return enqueue(() => spawnShell(cmd, { timeout, env: opts.env }), timeout);
  }

  async function refreshAvailability({ force = false } = {}) {
    if (probing) return available;
    if (!force && cachedAt && (nowFn() - cachedAt) < DOCKER_AVAILABILITY_TTL_MS) {
      return available;
    }
    probing = true;
    try {
      await runCommand('docker info', { timeout: DOCKER_PROBE_TIMEOUT_MS });
      setAvailable(true);
    } catch {
      setAvailable(false);
    } finally {
      probing = false;
    }
    return available;
  }

  function startWatchdog() {
    if (watchdog) return;
    refreshAvailability({ force: true }).catch(() => {});
    watchdog = setInterval(() => {
      refreshAvailability({ force: true }).catch(() => {});
    }, DOCKER_AVAILABILITY_TTL_MS);
    watchdog.unref();
  }

  function stopWatchdog() {
    if (watchdog) {
      clearInterval(watchdog);
      watchdog = null;
    }
  }

  return {
    dockerEnv,
    snapshot,
    isDockerAvailable,
    setAvailable,
    invalidate,
    runCommand,
    refreshAvailability,
    startWatchdog,
    stopWatchdog,
  };
}

export const dockerBroker = createDockerBroker();
export const isDockerAvailableCached = () => dockerBroker.isDockerAvailable();
export const refreshDockerAvailability = (opts) => dockerBroker.refreshAvailability(opts);
export const runDockerCommand = (cmd, opts) => dockerBroker.runCommand(cmd, opts);
export const startDockerWatchdog = () => dockerBroker.startWatchdog();
export const getDockerBrokerSnapshot = () => dockerBroker.snapshot();
