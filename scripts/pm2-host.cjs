/**
 * Host lifecycle for the IDE container job.
 *
 * start    — pull latest, install (build/create) and start
 * restart  — pull latest, rebuild, restart
 * stop     — stop the running process/container
 * uninstall — remove the job/container only
 *
 * Never deletes images or volumes. Remove those manually.
 */
const { spawnSync } = require('child_process');
const os = require('os');
const {
  CONTAINER,
  parseArgs,
  gitPullBestEffort,
  dockerBin,
  hostDockerEnv,
  stopIdeContainer,
  removeIdeContainer,
  followIdeLogs,
  launchIde,
} = require('./compose-host.cjs');

const PM2_ACTIONS = new Set(['start', 'restart', 'stop', 'uninstall', 'status', 'logs']);

function planPm2Action(action) {
  const name = String(action || '').trim();
  if (!PM2_ACTIONS.has(name)) {
    throw new Error(`Unknown pm2 action: ${name}. Use start, restart, stop, or uninstall.`);
  }
  const base = {
    action: name,
    gitPull: false,
    build: false,
    start: false,
    stop: false,
    removeContainer: false,
    removeImage: false,
    removeVolumes: false,
    detach: true,
  };
  if (name === 'start') {
    return { ...base, gitPull: true, build: true, start: true, removeContainer: true };
  }
  if (name === 'restart') {
    return { ...base, gitPull: true, build: true, start: true, stop: true, removeContainer: true };
  }
  if (name === 'stop') {
    return { ...base, stop: true };
  }
  if (name === 'uninstall') {
    return { ...base, stop: true, removeContainer: true };
  }
  return base;
}

function parsePm2Args(argv) {
  const args = [...argv];
  const action = args.shift();
  if (!action || !PM2_ACTIONS.has(action)) {
    throw new Error('Usage: npm run pm2:start|pm2:restart|pm2:stop|pm2:uninstall [-- --dev]');
  }
  return { action, ...parseArgs(args) };
}

function printUrls(dev) {
  process.stderr.write(
    dev
      ? 'IDE: http://localhost:5173  (API: http://localhost:55590)\n'
      : 'IDE: http://localhost:55590\n',
  );
}

function removeLegacyHostPm2Job() {
  const result = spawnSync('pm2', ['delete', 'ai-ide-api'], {
    encoding: 'utf8',
    windowsHide: true,
    shell: os.platform() === 'win32',
  });
  if (result.status === 0) {
    process.stderr.write('Removed leftover host PM2 job ai-ide-api.\n');
  }
}

function printStatus() {
  const docker = dockerBin();
  const env = hostDockerEnv();
  const result = spawnSync(
    docker,
    ['ps', '-a', '--filter', `name=^${CONTAINER}$`, '--format', 'table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}'],
    { encoding: 'utf8', env, windowsHide: true, shell: false },
  );
  process.stdout.write((result.stdout || '').trim() + '\n');
  if (result.status !== 0) {
    process.stderr.write((result.stderr || 'Could not read container status.').trim() + '\n');
    process.exit(result.status ?? 1);
  }
}

function runPm2Action({ action, dev, bind }) {
  const plan = planPm2Action(action);

  if (action === 'status') {
    printStatus();
    return plan;
  }
  if (action === 'logs') {
    followIdeLogs();
    return plan;
  }

  if (plan.gitPull) gitPullBestEffort();

  if (plan.start) {
    launchIde({ dev, bind, detach: true, skipPull: true });
    printUrls(dev);
    return plan;
  }

  if (plan.removeContainer) {
    removeIdeContainer();
    removeLegacyHostPm2Job();
    return plan;
  }

  if (plan.stop) {
    stopIdeContainer();
  }
  return plan;
}

function main() {
  try {
    const parsed = parsePm2Args(process.argv.slice(2));
    runPm2Action(parsed);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

module.exports = {
  PM2_ACTIONS,
  planPm2Action,
  parsePm2Args,
  runPm2Action,
};

if (require.main === module) main();
