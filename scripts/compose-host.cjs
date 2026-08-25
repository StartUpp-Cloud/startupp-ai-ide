/**
 * Host-side IDE launcher.
 *
 * On Windows we never run `docker compose`. Compose/Desktop AI hooks can still
 * resolve Windows paths through WSL. Instead: docker.exe build + run over the
 * named pipe, using daemon BuildKit.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { seedHostAuthIntoIde, hostAuthMountArgs } = require('./hostAuthSeed.cjs');

const ROOT = path.resolve(__dirname, '..');
const WIN_PIPE = 'npipe:////./pipe/dockerDesktopLinuxEngine';
const CONTAINER = 'sai-ide';

function findWindowsDockerExe() {
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Docker', 'resources', 'bin', 'docker.exe'),
  ];
  for (const exe of candidates) {
    try { if (exe && fs.existsSync(exe)) return exe; } catch { /* ignore */ }
  }
  return 'docker.exe';
}

function hostDockerEnv(base = process.env, platform = os.platform()) {
  const env = {
    ...base,
    DOCKER_CLI_HINTS: 'false',
    DOCKER_SCAN_SUGGEST: 'false',
    // Docker VMM / Linux engine: use daemon BuildKit (classic builder is deprecated).
    DOCKER_BUILDKIT: '1',
    COMPOSE_BAKE: 'false',
    COMPOSE_DOCKER_CLI_BUILD: '0',
    COMPOSE_CONVERT_WINDOWS_PATHS: '0',
  };
  delete env.BUILDX_BUILDER;
  if (platform === 'win32') {
    env.DOCKER_HOST = base.SAI_DOCKER_HOST || base.DOCKER_HOST || WIN_PIPE;
    env.DOCKER_CONTEXT = 'default';
    env.DOCKER_CONFIG = path.join(ROOT, 'docker', 'cli-config');
  }
  return env;
}

function composeFiles({
  dev = false,
  bind = false,
  platform = os.platform(),
} = {}) {
  const files = [path.join(ROOT, 'compose.yaml')];
  if (dev) files.push(path.join(ROOT, 'compose.dev.yaml'));
  if (dev && (bind || platform !== 'win32')) {
    files.push(path.join(ROOT, 'compose.dev.bind.yaml'));
  }
  files.push(path.join(ROOT, platform === 'win32' ? 'compose.sock.windows.yaml' : 'compose.sock.yaml'));
  return files;
}

function startPlan() {
  return {
    pull: true,
    rebuild: true,
    run: true,
    preserveVolumes: ['sai-ide-data', 'sai-ide-logs', 'sai-ide-home'],
    removeVolumes: false,
  };
}

/** Apply pull/rebuild/keep-volumes policy to compose argv. Never adds -v. */
function applyStartPlanToComposeArgs(composeArgs, plan = startPlan()) {
  const args = [...(composeArgs && composeArgs.length ? composeArgs : ['up'])];
  const cmd = args[0] || 'up';
  if (plan.rebuild && cmd === 'up' && !args.includes('--build')) {
    args.push('--build');
  }
  if (plan.removeVolumes === false && cmd === 'down') {
    return args.filter((a) => a !== '-v' && a !== '--volumes');
  }
  return args;
}

function gitPullBestEffort() {
  const result = spawnSync('git', ['-C', ROOT, 'pull', '--ff-only'], {
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
  });
  if (result.status !== 0) {
    process.stderr.write(`git pull skipped: ${(result.stderr || result.stdout || 'not a git checkout').trim()}\n`);
    return false;
  }
  process.stderr.write((result.stdout || 'Already up to date.\n').trim() + '\n');
  return true;
}

function parseArgs(argv) {
  const args = [...argv];
  let dev = false;
  let bind = false;
  if (args[0] === 'dev') {
    dev = true;
    args.shift();
  }
  if (args.includes('--dev')) {
    dev = true;
    args.splice(args.indexOf('--dev'), 1);
  }
  if (args.includes('--bind')) {
    bind = true;
    args.splice(args.indexOf('--bind'), 1);
  }
  return { dev, bind, composeArgs: args.length ? args : ['up', '--build'] };
}

function assertSafeDockerArgs(args) {
  const list = Array.isArray(args) ? args : [];
  const cmd = list[0];
  if (cmd === 'rmi' || (cmd === 'image' && list[1] === 'rm')) {
    throw new Error('Refusing to remove Docker images. Remove images manually with docker image rm.');
  }
  if (cmd === 'volume' && (list[1] === 'rm' || list[1] === 'prune')) {
    throw new Error('Refusing to remove Docker volumes. Data stays in sai-ide-data / sai-ide-home.');
  }
  if (cmd === 'rm' && (list.includes('-v') || list.includes('--volumes'))) {
    throw new Error('Refusing docker rm -v. Volumes are never deleted by these commands.');
  }
  if (cmd === 'compose' && list.includes('down') && (list.includes('-v') || list.includes('--volumes'))) {
    throw new Error('Refusing compose down -v. Volumes are never deleted by these commands.');
  }
  return list;
}

function dockerRaw(docker, args, extra = {}) {
  const safe = assertSafeDockerArgs(args);
  return spawnSync(docker, safe, {
    cwd: ROOT,
    windowsHide: true,
    shell: false,
    ...extra,
  });
}

function dockerSync(docker, args, env) {
  const result = dockerRaw(docker, args, { env, encoding: 'utf8' });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(detail || `docker ${args.join(' ')} failed (${result.status})`);
  }
  return result.stdout || '';
}

function isUnsharedBindMountError(error) {
  const msg = String(error?.message || error || '');
  return /not shared from the host/i.test(msg) || /ETIMEDOUT/i.test(msg);
}

function withoutHostAuthMounts(runArgs) {
  const out = [];
  for (let i = 0; i < runArgs.length; i += 1) {
    if (runArgs[i] === '--mount' && String(runArgs[i + 1] || '').includes('/root/host-auth/')) {
      i += 1;
      continue;
    }
    out.push(runArgs[i]);
  }
  return out;
}

function imageExists(docker, env, image) {
  const out = spawnSync(docker, ['images', '-q', image], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
  });
  return out.status === 0 && Boolean(out.stdout && out.stdout.trim());
}

function ensureVolume(docker, env, name) {
  spawnSync(docker, ['volume', 'create', name], {
    cwd: ROOT,
    env,
    windowsHide: true,
    shell: false,
  });
}

function dockerBin(platform = os.platform()) {
  return platform === 'win32' ? findWindowsDockerExe() : 'docker';
}

function stopIdeContainer({ docker = dockerBin(), env = hostDockerEnv() } = {}) {
  dockerRaw(docker, ['stop', CONTAINER], { env });
  process.stderr.write('Container stopped. Image and volumes kept.\n');
}

function removeIdeContainer({ docker = dockerBin(), env = hostDockerEnv() } = {}) {
  dockerRaw(docker, ['rm', '-f', CONTAINER], { env });
  process.stderr.write('Container job removed. Images and volumes kept.\n');
}

function followIdeLogs({ docker = dockerBin(), env = hostDockerEnv() } = {}) {
  const child = spawn(docker, ['logs', '-f', CONTAINER], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
    windowsHide: true,
    shell: false,
  });
  child.on('exit', (code) => process.exit(code ?? 1));
}

function runWindowsNative({
  dev,
  composeArgs,
  detach = false,
  skipPull = false,
} = {}) {
  const docker = findWindowsDockerExe();
  const env = hostDockerEnv();
  const cmd = composeArgs[0] || 'up';
  const forceBuild = composeArgs.includes('--build') || cmd === 'build';
  const image = dev ? 'startupp-ai-ide:dev' : 'startupp-ai-ide:latest';
  const target = dev ? 'development' : 'production';

  const plan = startPlan();
  if (!skipPull && (cmd === 'up' || cmd === 'build' || cmd === 'restart')) {
    gitPullBestEffort();
  }

  if (cmd === 'stop') {
    stopIdeContainer({ docker, env });
    return;
  }

  if (cmd === 'down' || cmd === 'rm' || cmd === 'uninstall') {
    removeIdeContainer({ docker, env });
    return;
  }

  if (cmd === 'logs') {
    followIdeLogs({ docker, env });
    return;
  }

  if (plan.rebuild || forceBuild || cmd === 'build' || !imageExists(docker, env, image)) {
    process.stderr.write(`Building ${image} with docker.exe (BuildKit, named pipe)…\n`);
    dockerSync(docker, [
      'build',
      '--progress=plain',
      '--target', target,
      '-t', image,
      '-f', path.join('docker', 'Dockerfile.ide'),
      '.',
    ], env);
  }
  if (cmd === 'build') return;

  for (const name of startPlan().preserveVolumes) ensureVolume(docker, env, name);

  dockerRaw(docker, ['rm', '-f', CONTAINER], { env });

  const runArgs = [
    'run', '-d',
    '--name', CONTAINER,
    '--restart', 'unless-stopped',
    '-e', 'SAI_IN_CONTAINER=1',
    '-e', `NODE_ENV=${dev ? 'development' : 'production'}`,
    '-e', 'PORT=55590',
    '-e', 'HOST_AUTH_DIR=/root/host-auth',
    '-p', '55590:55590',
    '-v', 'sai-ide-data:/app/data',
    '-v', 'sai-ide-logs:/app/logs',
    '-v', 'sai-ide-home:/root',
    '-v', '/var/run/docker.sock:/var/run/docker.sock',
    '--add-host', 'host.docker.internal:host-gateway',
    ...hostAuthMountArgs({ home: os.homedir(), appData: process.env.APPDATA || '' }),
  ];
  if (dev) runArgs.push('-p', '5173:5173');
  runArgs.push(image);
  if (dev) runArgs.push('npm', 'run', 'dev');

  process.stderr.write(`Starting ${CONTAINER} via docker.exe run…\n`);
  try {
    dockerSync(docker, runArgs, env);
  } catch (error) {
    if (!isUnsharedBindMountError(error) || withoutHostAuthMounts(runArgs).length === runArgs.length) {
      throw error;
    }
    process.stderr.write('Wrangler host bind skipped (path is not in Docker Desktop File Sharing).\n');
    dockerRaw(docker, ['rm', '-f', CONTAINER], { env });
    dockerSync(docker, withoutHostAuthMounts(runArgs), env);
  }
  seedHostAuthWhenReady({ docker, env });

  if (detach) {
    process.stderr.write(`${CONTAINER} is up. Images were not deleted.\n`);
    return;
  }

  followIdeLogs({ docker, env });
}

function seedHostAuthWhenReady({ docker, env, attempts = 30, delayMs = 2000 } = {}) {
  let left = attempts;
  const tick = () => {
    const inspect = dockerRaw(docker, ['inspect', '-f', '{{.State.Running}}', CONTAINER], { env, encoding: 'utf8' });
    if (inspect.status === 0 && String(inspect.stdout || '').trim() === 'true') {
      try {
        seedHostAuthIntoIde({ docker, env, container: CONTAINER });
      } catch (error) {
        process.stderr.write(`host auth seed skipped: ${error.message || error}\n`);
      }
      return;
    }
    left -= 1;
    if (left <= 0) return;
    setTimeout(tick, delayMs);
  };
  setTimeout(tick, 400);
}

function runCompose({
  dev,
  bind,
  composeArgs,
  skipPull = false,
  sync = false,
} = {}) {
  if (!skipPull) gitPullBestEffort();
  const files = composeFiles({ dev, bind });
  const docker = 'docker';
  const plan = startPlan();
  const safeArgs = applyStartPlanToComposeArgs(composeArgs, plan);
  if (composeArgs.includes('-v') || composeArgs.includes('--volumes')) {
    console.error('Refusing to remove volumes. Project data stays in sai-ide-data / sai-ide-home.');
  }
  const args = assertSafeDockerArgs(['compose', ...files.flatMap((f) => ['-f', f]), ...safeArgs]);
  if (sync) {
    const result = dockerRaw(docker, args, { env: hostDockerEnv(), stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
    seedHostAuthWhenReady({ docker, env: hostDockerEnv() });
    return;
  }
  const child = spawn(docker, args, {
    cwd: ROOT,
    env: hostDockerEnv(),
    stdio: 'inherit',
    windowsHide: true,
    shell: false,
  });
  seedHostAuthWhenReady({ docker, env: hostDockerEnv() });
  child.on('exit', (code) => process.exit(code ?? 1));
}

function launchIde({
  dev = false,
  bind = false,
  detach = false,
  skipPull = false,
  platform = os.platform(),
} = {}) {
  if (platform === 'win32') {
    runWindowsNative({
      dev,
      composeArgs: ['up', '--build'],
      detach,
      skipPull,
    });
    return;
  }
  runCompose({
    dev,
    bind,
    composeArgs: detach ? ['up', '-d', '--build'] : ['up', '--build'],
    skipPull,
    sync: detach,
  });
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (os.platform() === 'win32') {
    try {
      runWindowsNative(parsed);
    } catch (err) {
      console.error(err.message || err);
      process.exit(1);
    }
    return;
  }
  runCompose(parsed);
}

module.exports = {
  WIN_PIPE,
  CONTAINER,
  findWindowsDockerExe,
  hostDockerEnv,
  composeFiles,
  parseArgs,
  startPlan,
  applyStartPlanToComposeArgs,
  gitPullBestEffort,
  assertSafeDockerArgs,
  dockerBin,
  stopIdeContainer,
  removeIdeContainer,
  followIdeLogs,
  launchIde,
  runWindowsNative,
  runCompose,
  isUnsharedBindMountError,
  withoutHostAuthMounts,
};

if (require.main === module) main();
