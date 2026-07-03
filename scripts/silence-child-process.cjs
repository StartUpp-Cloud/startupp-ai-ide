/**
 * Windows console-window suppressor (preload).
 *
 * On Windows, every child_process spawn (execSync/exec/spawn/…) that isn't given
 * `windowsHide: true` flashes a console window. This codebase has ~40 such call
 * sites (git status/diff polling, availability probes, docker, schedulers, …),
 * and adding the flag to each is fragile. Instead we patch child_process ONCE,
 * before the ESM app graph is instantiated, so every named import
 * (`import { execSync } from 'child_process'`) snapshots the patched version.
 *
 * Wire it in as a Node preload: `node --require ./scripts/silence-child-process.cjs …`
 * (see package.json "start" and the PM2 node_args). No-op off Windows.
 */
'use strict';

if (process.platform === 'win32') {
  const cp = require('child_process');

  // Ensure the options object (which varies in position across the child_process
  // API) carries windowsHide:true, without disturbing positional args.
  const injectWindowsHide = (args) => {
    let end = args.length;
    if (typeof args[end - 1] === 'function') end--; // step over an optional callback
    const maybeOpts = args[end - 1];
    if (maybeOpts && typeof maybeOpts === 'object' && !Array.isArray(maybeOpts)) {
      if (maybeOpts.windowsHide === undefined) maybeOpts.windowsHide = true;
    } else {
      // No options object present — insert one (before the callback if any).
      args.splice(end, 0, { windowsHide: true });
    }
    return args;
  };

  for (const name of ['execSync', 'exec', 'execFile', 'execFileSync', 'spawn', 'spawnSync']) {
    const original = cp[name];
    if (typeof original !== 'function') continue;
    cp[name] = function (...args) {
      return original.apply(this, injectWindowsHide(args));
    };
  }
}
