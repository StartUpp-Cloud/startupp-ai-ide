/**
 * Docker talks to the engine via the Unix socket (`/var/run/docker.sock`).
 * The IDE runs in Linux (the Compose service). There is no Windows docker.exe
 * route.
 *
 * All docker CLI goes through dockerBroker so a wedged engine cannot freeze
 * the HTTP event loop.
 */

import { spawn } from 'child_process';
import {
  dockerBroker,
  dockerEnv,
  runDockerCommand,
  startDockerWatchdog,
  refreshDockerAvailability,
} from './dockerBroker.js';
import { containerNodeShellPrelude } from './containerNode.js';

export const CONTAINER_DEV_HOME = '/home/dev';
export const CONTAINER_CLOUDFLARE_ENV = '/home/dev/.config/cloudflare.env';

/**
 * Interactive `docker exec` for a real Linux PTY (node-pty inside the IDE container).
 */
export function interactiveDockerExecArgs({
  extraEnv = [],
  workDir = '/workspace',
  containerName,
  command = ['bash', '-l'],
} = {}) {
  return [
    'exec', '-it',
    '-e', `HOME=${CONTAINER_DEV_HOME}`,
    '-e', 'TERM=xterm-256color',
    '-e', 'COLORTERM=truecolor',
    '-e', 'BROWSER=false',
    ...extraEnv,
    '-w', workDir,
    containerName,
    ...command,
  ];
}

/**
 * Non-PTY agent `docker exec` (stdin script). Interactive terminals use
 * `bash -l`, which sources ~/.bashrc including cloudflare.env. Agent runs
 * non-interactive `bash -s`; ~/.bashrc returns immediately, so Wrangler
 * never sees CLOUDFLARE_API_TOKEN and falls back to stale OAuth.
 */
export function agentDockerExecArgs({
  workDir = '/workspace',
  containerName,
} = {}) {
  return [
    'exec', '-i',
    '-e', `HOME=${CONTAINER_DEV_HOME}`,
    '-w', workDir,
    containerName,
    'setsid', '-w', 'bash', '-s',
  ];
}

/** Source nvm + Cloudflare token the same way a login shell would. */
export function containerAgentShellPrelude() {
  return `${containerNodeShellPrelude()}[ -f ${CONTAINER_CLOUDFLARE_ENV} ] && . ${CONTAINER_CLOUDFLARE_ENV}\n`;
}

export function isDockerAvailable(_force = false) {
  return dockerBroker.isDockerAvailable();
}

/** Identity — build/copy helpers no longer rewrite host paths. */
export function dockerCliPath(input) {
  return input;
}

function assertDockerReachable() {
  if (!dockerBroker.isDockerAvailable()) {
    throw new Error('Docker engine is not reachable. Start Docker on the host, then retry.');
  }
}

/**
 * Run a docker CLI command without blocking the HTTP event loop.
 * Returns a Promise<string>. Callers must await.
 */
export function execDockerCmd(cmd, opts = {}) {
  return execDockerCmdAsync(cmd, opts);
}

export async function execDockerCmdAsync(cmd, opts = {}) {
  assertDockerReachable();
  const stdout = await runDockerCommand(cmd, {
    timeout: opts.timeout,
    env: opts.env,
  });
  return stdout;
}

export function getDockerSpawnSpec(dockerArgs = []) {
  assertDockerReachable();
  return { cmd: 'docker', args: dockerArgs, cwd: undefined, env: dockerEnv() };
}

export function getDockerExecPtySpec(dockerArgs = []) {
  const spec = getDockerSpawnSpec(dockerArgs);
  return { shell: spec.cmd, args: spec.args, cwd: spec.cwd, env: spec.env };
}

function spawnDocker(args, { timeout = 300000, stdin } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      env: dockerEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    let settled = false;
    const settle = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      try { child.unref(); } catch { /* ignore */ }
      settle(new Error(`docker ${args[0]} timed out after ${timeout}ms`));
    }, timeout);

    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => settle(err));
    child.on('close', (code) => {
      if (code === 0) settle(null, { ok: true });
      else settle(new Error(stderr.trim() || `docker ${args.join(' ')} exited ${code}`));
    });

    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

/**
 * Build an image from Dockerfile text on stdin so the engine never needs a
 * host filesystem path for the IDE container's `/app/docker` tree.
 */
export function buildDockerImageFromDockerfile(tag, dockerfileContents, { label, labels = [], timeout = 300000 } = {}) {
  const args = ['build', '-t', tag];
  const allLabels = [...labels];
  if (label) allLabels.push(label);
  for (const item of allLabels) args.push('--label', item);
  args.push('-');
  return spawnDocker(args, { timeout, stdin: dockerfileContents }).then(() => ({ built: true, image: tag }));
}

export function pullDockerImage(ref, { timeout = 300000 } = {}) {
  return spawnDocker(['pull', ref], { timeout }).then(() => ({ pulled: true, image: ref }));
}

export async function tagDockerImage(source, target) {
  await runDockerCommand(`docker tag ${source} ${target}`, { timeout: 30000 });
  return { source, target };
}

export function getDockerRouteStatus() {
  const dockerAvailable = dockerBroker.isDockerAvailable();
  return {
    dockerAvailable,
    dockerRoute: dockerAvailable ? 'socket' : null,
    dockerOnWindows: false,
    inContainer: process.env.SAI_IN_CONTAINER === '1',
    ...dockerBroker.snapshot(),
  };
}

export function clearDockerRouteCache() {
  dockerBroker.invalidate();
}

export function getDockerRoute() {
  return dockerBroker.isDockerAvailable() ? 'socket' : null;
}

export function dockerCliEnv(base = process.env) {
  return dockerEnv(base);
}

export { startDockerWatchdog, refreshDockerAvailability };

/** @deprecated Unused — kept so accidental imports do not crash. */
export function findWindowsDockerExe() {
  return null;
}
