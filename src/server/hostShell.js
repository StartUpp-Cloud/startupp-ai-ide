/**
 * Host shell helpers.
 *
 * Host-runtime projects run directly on the machine the server runs on. On
 * Windows the default shell for child_process is cmd.exe, which does not
 * understand POSIX pipelines (`git ... | head`, `2>/dev/null`, single-quoted
 * paths, etc.) that this codebase was written against for Linux containers.
 *
 * These helpers route host commands through Git Bash on Windows so they behave
 * the same as inside a Linux container, and fall back to the default shell on
 * POSIX. This is the same Git Bash the interactive host terminals use.
 */

import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';

// Locate Git Bash on Windows. We deliberately avoid C:\Windows\System32\bash.exe
// (the WSL launcher — a different filesystem). Only Git-for-Windows' bash.
let _cachedGitBash; // undefined = unchecked, null = not found, string = path
export function findGitBash() {
  if (_cachedGitBash !== undefined) return _cachedGitBash;

  const envShell = process.env.IDE_HOST_SHELL;
  const candidates = [
    envShell && /bash\.exe$/i.test(envShell) ? envShell : null,
    process.env.GIT_INSTALL_ROOT ? `${process.env.GIT_INSTALL_ROOT}\\bin\\bash.exe` : null,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe` : null,
  ].filter(Boolean);

  for (const p of candidates) {
    try { if (fs.existsSync(p)) { _cachedGitBash = p; return p; } } catch { /* ignore */ }
  }
  _cachedGitBash = null;
  return null;
}

/**
 * Run a shell command on the host. On Windows, route it through Git Bash (so
 * POSIX pipelines behave like Linux); on POSIX use the default shell. Returns
 * stdout as a string. Throws on non-zero exit (like execSync).
 *
 * @param {string} cmd
 * @param {{cwd?: string, timeout?: number, maxBuffer?: number}} [opts]
 */
export function runHostShell(cmd, { cwd, timeout = 30000, maxBuffer = 10 * 1024 * 1024 } = {}) {
  const options = { cwd, encoding: 'utf-8', stdio: 'pipe', timeout, maxBuffer };
  if (os.platform() === 'win32') {
    const bash = findGitBash();
    if (bash) options.shell = bash; // Node runs `bash -c "<cmd>"`
  }
  return execSync(cmd, options);
}
