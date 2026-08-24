/**
 * Stop must kill the IDE-side docker-exec client AND the process group
 * inside the project container. Killing only the local child often leaves
 * `codex exec` (and commands it spawned) running and billing tokens.
 */

import { execDockerCmd } from './dockerRoute.js';

export function extractInnerPid(text, marker) {
  if (!marker) return null;
  const escaped = String(marker).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(text || '').match(new RegExp(`${escaped}:(\\d+)`));
  const pid = match ? Number(match[1]) : NaN;
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function buildContainerKillArgs(containerName, innerPid) {
  const pid = Number(innerPid);
  return [
    'exec',
    String(containerName),
    'bash',
    '-lc',
    `kill -TERM -- -${pid} 2>/dev/null || kill -TERM ${pid} 2>/dev/null; `
      + `pkill -TERM -P ${pid} 2>/dev/null; `
      + `sleep 0.2; `
      + `kill -KILL -- -${pid} 2>/dev/null || kill -KILL ${pid} 2>/dev/null; `
      + `pkill -KILL -P ${pid} 2>/dev/null; `
      + `true`,
  ];
}

function killHostChild(child, { later = setTimeout } = {}) {
  if (!child) return;
  try { child.kill('SIGTERM'); } catch {}
  later(() => {
    try { if (!child.killed) child.kill('SIGKILL'); } catch {}
  }, 800);
}

export function killRegisteredAgentProcesses({
  processes = [],
  execFn = (cmd) => execDockerCmd(cmd, { timeout: 8000 }),
  later = setTimeout,
} = {}) {
  for (const handle of processes) {
    if (!handle) continue;
    killHostChild(handle.child, { later });
    if (handle.containerName && handle.innerPid) {
      const args = buildContainerKillArgs(handle.containerName, handle.innerPid);
      try {
        const result = execFn(`docker ${args.map((part) => (/\s/.test(part) ? `'${part.replace(/'/g, `'\\''`)}'` : part)).join(' ')}`);
        if (result && typeof result.then === 'function') result.catch(() => {});
      } catch {
        // Best-effort: the host docker-exec client is still SIGTERM'd above.
      }
    }
  }
}

export function createInnerPidMarker() {
  return `SAI_INNER_PID_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function stripInnerPidLines(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => !/SAI_INNER_PID_[A-Za-z0-9]+:\d+/.test(line))
    .join('\n');
}
