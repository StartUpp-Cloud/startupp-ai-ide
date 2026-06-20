/**
 * worktreeManager — isolated git worktrees for parallel sub-agents.
 *
 * Each parallel sub-agent works on its OWN branch in its OWN worktree directory,
 * so concurrent edits can never clobber each other even when they touch the same
 * files. A later consolidate step merges the branches back into the base,
 * resolving conflicts. This is what makes harness-level parallelism safe.
 *
 * All git runs inside the project's container via containerManager.execInContainer.
 * Everything is best-effort and returns a clear ok/err so the caller can fall
 * back to safe serial execution.
 */

import { containerManager } from './containerManager.js';

const WORKTREE_ROOT = '/workspace/.worktrees';

function sh(s) {
  return String(s || '').replace(/'/g, `'\\''`);
}

export function safeBranchName(name) {
  return String(name || 'part').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'part';
}

/** Resolve the repo root inside the container (the dir whose child is .git). */
export async function resolveRepoRoot(containerName, repoPath = null) {
  if (repoPath) return repoPath.replace(/\/+$/, '');
  const found = await containerManager.execInContainerAsync(
    containerName,
    `cd /workspace && (git rev-parse --show-toplevel 2>/dev/null || find /workspace -maxdepth 2 -name .git -printf '%h\\n' -quit 2>/dev/null)`,
  );
  const root = String(found || '').trim().split('\n').filter(Boolean)[0];
  return (root || '/workspace').replace(/\/+$/, '');
}

/**
 * Resolve the git root + base ref the worktrees should branch off. `workDir` is
 * the parent agent's working directory (which may itself be a per-session
 * worktree) — worktree commands run from there and new branches fork off its
 * current branch, so the later `git merge` back into it is consistent. Git
 * worktree operations work from any worktree of the repo.
 */
export async function resolveBaseRef(containerName, workDir = '/workspace') {
  const root = (workDir || '/workspace').replace(/\/+$/, '');
  const ref = await containerManager.execInContainerAsync(
    containerName,
    `cd '${sh(root)}' && (git symbolic-ref --short HEAD 2>/dev/null || git rev-parse HEAD 2>/dev/null)`,
  );
  return { root, base: String(ref || '').trim() || 'HEAD' };
}

/**
 * Create a fresh worktree on a NEW branch off `base`. Idempotent: removes any
 * stale worktree/branch at the same name first.
 * @returns {Promise<{ ok: boolean, path: string, branch: string, root: string, output: string }>}
 */
export async function createWorktree({ containerName, root, base, branch }) {
  const safe = safeBranchName(branch);
  const path = `${WORKTREE_ROOT}/${safe}`;
  const cmd = [
    `cd '${sh(root)}'`,
    `git worktree remove '${sh(path)}' --force 2>/dev/null || true`,
    `git branch -D '${sh(safe)}' 2>/dev/null || true`,
    `mkdir -p '${sh(WORKTREE_ROOT)}'`,
    `git worktree add -b '${sh(safe)}' '${sh(path)}' '${sh(base)}' 2>&1`,
  ].join(' && ');
  const output = await containerManager.execInContainerAsync(containerName, cmd, { timeout: 60000 });
  const ok = output != null && /(Preparing worktree|HEAD is now at|Checking out files|^$)/m.test(String(output)) && !/fatal:|error:/i.test(String(output));
  if (ok) {
    await containerManager.execInContainerAsync(containerName, `chown -R dev:dev '${sh(path)}' 2>/dev/null || true`).catch(() => {});
  }
  return { ok, path, branch: safe, root, output: String(output || '') };
}

/** Remove a worktree (and prune). Best-effort. */
export async function removeWorktree({ containerName, root, path }) {
  await containerManager.execInContainerAsync(
    containerName,
    `cd '${sh(root)}' && (git worktree remove '${sh(path)}' --force 2>/dev/null || true) && git worktree prune 2>/dev/null || true`,
  ).catch(() => {});
}

/** Remove several worktrees by path. */
export async function removeWorktrees({ containerName, root, paths = [] }) {
  for (const path of paths) {
    if (path) await removeWorktree({ containerName, root, path });
  }
}
