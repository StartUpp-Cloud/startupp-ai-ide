/**
 * Copy files into a sibling container through the Docker API, not `docker cp`.
 *
 * `docker cp /path` is resolved on the *engine* host. When the IDE itself is a
 * container, those paths do not exist on the host, so we stream a tar over
 * `docker exec -i`.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { execDockerCmd } from './dockerRoute.js';

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
export function copyIntoContainer(localPath, containerName, destPath, { timeout = 30000 } = {}) {
  if (!fs.existsSync(localPath)) {
    throw new Error(`Path not found: ${localPath}`);
  }
  if (!containerName) throw new Error('containerName is required');

  const dest = String(destPath).replace(/\\/g, '/');
  const stat = fs.statSync(localPath);

  if (stat.isDirectory()) {
    execDockerCmd(`docker exec ${containerName} mkdir -p ${posixQuote(dest)}`);
    pipeTar({
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

  execDockerCmd(`docker exec ${containerName} mkdir -p ${posixQuote(destDir)}`);
  pipeTar({
    tarArgs: ['-C', srcDir, '-cf', '-', srcName],
    execArgs: ['exec', '-i', containerName, 'tar', '-xf', '-', '-C', destDir],
    timeout,
  });

  if (srcName !== destName) {
    execDockerCmd(
      `docker exec ${containerName} mv ${posixQuote(`${destDir}/${srcName}`)} ${posixQuote(dest)}`,
    );
  }
  return dest;
}

function pipeTar({ tarArgs, execArgs, timeout }) {
  const archive = spawnSync('tar', tarArgs, {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
    timeout,
    windowsHide: true,
  });
  if (archive.status !== 0) {
    throw new Error(String(archive.stderr || archive.error || 'tar failed'));
  }

  const load = spawnSync('docker', execArgs, {
    input: archive.stdout,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
    timeout,
    windowsHide: true,
  });
  if (load.status !== 0) {
    throw new Error(String(load.stderr || load.error || 'docker exec tar failed'));
  }
}
