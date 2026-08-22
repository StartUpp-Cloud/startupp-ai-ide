/**
 * Docker talks to the engine via the Unix socket (`/var/run/docker.sock`).
 * The IDE runs in Linux (the Compose service). There is no Windows docker.exe
 * route.
 */

import { execFileSync, execSync, exec as execCallback, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(execCallback);

let _available;
let _cachedAt = 0;
const ROUTE_TTL_MS = 8000;

function dockerEnv(base = process.env) {
  return {
    ...base,
    DOCKER_CLI_HINTS: 'false',
    DOCKER_SCAN_SUGGEST: 'false',
  };
}

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
    '-e', 'TERM=xterm-256color',
    '-e', 'COLORTERM=truecolor',
    '-e', 'BROWSER=false',
    ...extraEnv,
    '-w', workDir,
    containerName,
    ...command,
  ];
}

function probeDocker() {
  try {
    execFileSync('docker', ['info'], {
      stdio: 'pipe',
      timeout: 15000,
      env: dockerEnv(),
    });
    return true;
  } catch {
    return false;
  }
}

export function isDockerAvailable(force = false) {
  if (force || Date.now() - _cachedAt > ROUTE_TTL_MS) {
    _available = undefined;
  }
  if (_available !== undefined) return _available;
  _available = probeDocker();
  _cachedAt = Date.now();
  return _available;
}

/** Identity — build/copy helpers no longer rewrite host paths. */
export function dockerCliPath(input) {
  return input;
}

export function execDockerCmd(cmd, opts = {}) {
  if (!isDockerAvailable()) {
    throw new Error('Docker engine is not reachable. Start Docker on the host, then retry.');
  }

  return execSync(cmd, {
    encoding: 'utf-8',
    stdio: opts.stdio || 'pipe',
    timeout: opts.timeout,
    maxBuffer: opts.maxBuffer || 10 * 1024 * 1024,
    env: dockerEnv(opts.env || process.env),
    shell: true,
    ...opts,
  });
}

export async function execDockerCmdAsync(cmd, opts = {}) {
  if (!isDockerAvailable()) {
    throw new Error('Docker engine is not reachable. Start Docker on the host, then retry.');
  }

  const { stdout } = await execAsync(cmd, {
    encoding: 'utf-8',
    maxBuffer: opts.maxBuffer || 10 * 1024 * 1024,
    timeout: opts.timeout,
    env: dockerEnv(opts.env || process.env),
    shell: true,
    ...opts,
  });
  return stdout;
}

export function getDockerSpawnSpec(dockerArgs = []) {
  if (!isDockerAvailable()) {
    throw new Error('Docker engine is not reachable. Start Docker on the host, then retry.');
  }
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
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`docker ${args[0]} timed out after ${timeout}ms`));
    }, timeout);

    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true });
      else reject(new Error(stderr.trim() || `docker ${args.join(' ')} exited ${code}`));
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

export function tagDockerImage(source, target) {
  execFileSync('docker', ['tag', source, target], {
    stdio: 'pipe',
    env: dockerEnv(),
  });
  return { source, target };
}

export function getDockerRouteStatus() {
  const dockerAvailable = isDockerAvailable();
  return {
    dockerAvailable,
    dockerRoute: dockerAvailable ? 'socket' : null,
    dockerOnWindows: false,
    inContainer: process.env.SAI_IN_CONTAINER === '1',
  };
}

export function clearDockerRouteCache() {
  _available = undefined;
  _cachedAt = 0;
}

// Back-compat names used by older call sites / tests.
export function getDockerRoute() {
  return isDockerAvailable() ? 'socket' : null;
}

export function dockerCliEnv(base = process.env) {
  return dockerEnv(base);
}

/** @deprecated Unused — kept so accidental imports do not crash. */
export function findWindowsDockerExe() {
  return null;
}
