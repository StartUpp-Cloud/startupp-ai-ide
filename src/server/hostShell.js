/**
 * POSIX host-shell helpers.
 *
 * "Host" means the IDE container. All commands are Linux bash.
 */

import { execSync } from 'child_process';

export function findGitBash() {
  return null;
}

/**
 * Run a POSIX shell command. Returns stdout as a string.
 * @param {string} cmd
 * @param {{cwd?: string, timeout?: number, maxBuffer?: number}} [opts]
 */
export function runHostShell(cmd, { cwd, timeout = 30000, maxBuffer = 10 * 1024 * 1024 } = {}) {
  return execSync(cmd, {
    cwd,
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout,
    maxBuffer,
    shell: '/bin/bash',
  });
}

/**
 * Shell + args for an interactive host PTY (utility/local terminals).
 */
export function getHostPtyConfig({ cwd } = {}) {
  return { shell: process.env.SHELL || '/bin/bash', args: ['-l'], cwd };
}

/**
 * Spawn spec for feeding a POSIX script on stdin (`bash -s`).
 */
export function getHostBashStdinSpec({ cwd } = {}) {
  return { cmd: '/bin/bash', args: ['-s'], cwd };
}
