#!/usr/bin/env node
/**
 * IDE container entrypoint. Ensures the host Docker socket is mounted,
 * then installs bind-mount deps if needed and execs the given command.
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

function fail(message) {
  console.error(message);
  process.exit(1);
}

try {
  if (!statSync('/var/run/docker.sock').isSocket()) {
    fail('Docker socket is not a socket at /var/run/docker.sock.\nStart the IDE with: npm run pm2:start -- --dev');
  }
} catch {
  fail('Docker socket is not mounted at /var/run/docker.sock.\nStart the IDE with: npm run pm2:start -- --dev');
}

if (!existsSync('/app/node_modules/express')) {
  console.log('Installing IDE dependencies…');
  const r = spawnSync('npm', ['install', '--no-fund', '--no-audit'], { stdio: 'inherit', cwd: '/app' });
  if (r.status !== 0) fail('npm install failed');
}
if (!existsSync('/app/src/client/node_modules/react')) {
  console.log('Installing client dependencies…');
  const r = spawnSync('npm', ['install', '--no-fund', '--no-audit'], {
    stdio: 'inherit',
    cwd: '/app/src/client',
  });
  if (r.status !== 0) fail('client npm install failed');
}

mkdirSync('/app/data', { recursive: true });
mkdirSync('/app/logs', { recursive: true });

const args = process.argv.slice(2);
if (args.length === 0) fail('No command given to ide-entrypoint');

const child = spawn(args[0], args.slice(1), {
  stdio: 'inherit',
  cwd: '/app',
  env: process.env,
});
const forward = (signal) => {
  try { child.kill(signal); } catch { /* already gone */ }
};
process.on('SIGTERM', () => forward('SIGTERM'));
process.on('SIGINT', () => forward('SIGINT'));
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
