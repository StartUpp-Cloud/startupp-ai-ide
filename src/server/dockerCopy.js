/**
 * Copy files into a sibling container through the Docker API, not `docker cp`.
 *
 * `docker cp /path` is resolved on the *engine* host. When the IDE itself is a
 * container, those paths do not exist on the host, so we stream a tar over
 * `docker exec -i`.
 *
 * Docker is spawned (never spawnSync) so a wedged engine cannot freeze HTTP.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { execDockerCmdAsync, dockerCliEnv } from './dockerRoute.js';

export function posixQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Destination directory inside the container (POSIX).
 * @param {string} destPath
 */
export function containerDestDir(destPath) {
  const dest = String(destPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const slash = dest.lastIndexOf('/');
  return slash <= 0 ? '/' : dest.slice(0, slash);
}

/**
 * Stream a local file or directory into a container path.
 * @param {string} localPath
 * @param {string} containerName
 * @param {string} destPath
 * @param {{ timeout?: number }} [opts]
 */
export async function copyIntoContainer(localPath, containerName, destPath, { timeout = 30000 } = {}) {
  if (!fs.existsSync(localPath)) {
    throw new Error(`Path not found: ${localPath}`);
  }
  if (!containerName) throw new Error('containerName is required');

  const dest = String(destPath).replace(/\\/g, '/');
  const stat = fs.statSync(localPath);

  if (stat.isDirectory()) {
    await execDockerCmdAsync(`docker exec ${containerName} mkdir -p ${posixQuote(dest)}`);
    await pipeTar({
      tarArgs: ['-C', localPath, '-cf', '-', '.'],
      execArgs: ['exec', '-i', containerName, 'tar', '-xf', '-', '-C', dest],
      timeout,
    });
    return dest;
  }

  const destDir = containerDestDir(dest);
  const destName = dest.split('/').filter(Boolean).pop();
  const srcDir = path.dirname(localPath);
  const srcName = path.basename(localPath);

  await execDockerCmdAsync(`docker exec ${containerName} mkdir -p ${posixQuote(destDir)}`);
  await pipeTar({
    tarArgs: ['-C', srcDir, '-cf', '-', srcName],
    execArgs: ['exec', '-i', containerName, 'tar', '-xf', '-', '-C', destDir],
    timeout,
  });

  if (srcName !== destName) {
    await execDockerCmdAsync(
      `docker exec ${containerName} mv ${posixQuote(`${destDir}/${srcName}`)} ${posixQuote(dest)}`,
    );
  }
  return dest;
}

function pipeTar({ tarArgs, execArgs, timeout }) {
  return new Promise((resolve, reject) => {
    const tar = spawn('tar', tarArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const docker = spawn('docker', execArgs, {
      env: dockerCliEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    tar.stdout.pipe(docker.stdin);

    let tarErr = '';
    let dockerErr = '';
    let settled = false;

    const settle = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };

    const timer = setTimeout(() => {
      try { tar.kill('SIGKILL'); } catch { /* ignore */ }
      try { docker.kill('SIGKILL'); } catch { /* ignore */ }
      try { docker.unref(); } catch { /* ignore */ }
      settle(new Error(`docker copy timed out after ${timeout}ms`));
    }, timeout);

    if (tar.stderr) tar.stderr.on('data', (chunk) => { tarErr += chunk; });
    if (docker.stderr) docker.stderr.on('data', (chunk) => { dockerErr += chunk; });
    tar.on('error', (err) => settle(err));
    docker.on('error', (err) => settle(err));
    tar.on('close', (code) => {
      if (code !== 0 && code !== null) {
        try { docker.kill('SIGKILL'); } catch { /* ignore */ }
        settle(new Error(String(tarErr || `tar exited ${code}`)));
      }
    });
    docker.on('close', (code) => {
      if (code === 0) settle(null);
      else settle(new Error(String(dockerErr || tarErr || `docker exec tar exited ${code}`)));
    });
  });
}
