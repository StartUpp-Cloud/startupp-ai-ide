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
//
// We PREFER `usr\bin\bash.exe` (the real MSYS2 bash, ~2.4 MB) over `bin\bash.exe`
// (a ~47 KB launcher that re-execs after console/tty setup). Under a console-less
// PM2 service on Windows, the launcher's terminal detection is exactly the kind of
// startup step that has intermittently failed with a cryptic `spawn … ENOENT`;
// the real bash has no such wrapper, so it is the more stable choice for the
// headless child_process spawns the agent CLIs use. Both accept the same args and
// resolve msys-2.0.dll from their own directory, so this is a safe swap.
let _cachedGitBash; // undefined = unchecked, null = not found, string = path
export function findGitBash() {
  if (_cachedGitBash !== undefined) return _cachedGitBash;

  const envShell = process.env.IDE_HOST_SHELL;
  const roots = [
    process.env.GIT_INSTALL_ROOT || null,
    'C:\\Program Files\\Git',
    'C:\\Program Files (x86)\\Git',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Programs\\Git` : null,
  ].filter(Boolean);

  const candidates = [
    envShell && /bash\.exe$/i.test(envShell) ? envShell : null,
    // Prefer the real bash (usr\bin) over the launcher (bin) for every root.
    ...roots.map((r) => `${r}\\usr\\bin\\bash.exe`),
    ...roots.map((r) => `${r}\\bin\\bash.exe`),
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
  // windowsHide prevents a console window from flashing on every invocation —
  // these run frequently (git status polling, availability probes, diffs).
  const options = { cwd, encoding: 'utf-8', stdio: 'pipe', timeout, maxBuffer, windowsHide: true };
  if (os.platform() === 'win32') {
    const bash = findGitBash();
    if (bash) options.shell = bash; // Node runs `bash -c "<cmd>"`
  }
  return execSync(cmd, options);
}
