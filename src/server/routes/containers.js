import { Router } from "express";
import { execSync as rawExecSync } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";
import multer from "multer";
import { containerManager } from "../containerManager.js";
import { getDB } from "../db.js";

const router = Router();

// Multer for temporary upload to host before docker cp
const tmpUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 50 * 1024 * 1024 } });

const CACHE_TTLS = {
  gitRoot: 30_000,
  repos: 30_000,
  branches: 15_000,
  branchesWithPrs: 45_000,
  statusPr: 60_000,
};

const routeCache = new Map();
const inFlightCache = new Map();

function containerCachePrefix(name) {
  return `container:${name}:`;
}

function containerCacheKey(name, scope, ...parts) {
  return `${containerCachePrefix(name)}${scope}:${JSON.stringify(parts)}`;
}

function getCache(key) {
  const entry = routeCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    routeCache.delete(key);
    return undefined;
  }
  return entry.value;
}

function setCache(key, value, ttlMs) {
  routeCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

async function getCached(key, ttlMs, loader, { force = false } = {}) {
  if (!force) {
    const cached = getCache(key);
    if (cached !== undefined) return cached;
    const inFlight = inFlightCache.get(key);
    if (inFlight) return inFlight;
  }

  const promise = loader()
    .then(value => setCache(key, value, ttlMs))
    .finally(() => inFlightCache.delete(key));
  inFlightCache.set(key, promise);
  return promise;
}

function invalidateContainerCache(name) {
  const prefix = containerCachePrefix(name);
  for (const key of routeCache.keys()) {
    if (key.startsWith(prefix)) routeCache.delete(key);
  }
  for (const key of inFlightCache.keys()) {
    if (key.startsWith(prefix)) inFlightCache.delete(key);
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

function isRefreshRequest(req) {
  return req.query.refresh === "1" || req.query.refresh === "true";
}

async function describeWorkspaceRepo(containerName, dir) {
  const folderName = dir === "/workspace" ? "workspace" : dir.split("/").pop();

  const [isGitRaw, pkgContent, hasPnpmRaw, hasYarnRaw, hasDockerfileRaw, hasComposeRaw, hasVercelRaw, hasNetlifyRaw] = await Promise.all([
    containerManager.execInContainerAsync(containerName, `test -e '${dir}/.git' && echo yes`),
    containerManager.execInContainerAsync(containerName, `cat '${dir}/package.json' 2>/dev/null`),
    containerManager.execInContainerAsync(containerName, `test -f '${dir}/pnpm-lock.yaml' && echo yes`),
    containerManager.execInContainerAsync(containerName, `test -f '${dir}/yarn.lock' && echo yes`),
    containerManager.execInContainerAsync(containerName, `test -f '${dir}/Dockerfile' && echo yes`),
    containerManager.execInContainerAsync(containerName, `test -f '${dir}/docker-compose.yml' -o -f '${dir}/compose.yml' && echo yes`),
    containerManager.execInContainerAsync(containerName, `test -f '${dir}/vercel.json' && echo yes`),
    containerManager.execInContainerAsync(containerName, `test -f '${dir}/netlify.toml' && echo yes`),
  ]);

  const isGit = isGitRaw === "yes";
  let branch = null;
  let hasChanges = false;

  if (isGit) {
    const [branchRaw, gitStatus] = await Promise.all([
      containerManager.execInContainerAsync(containerName, `cd '${dir}' && git branch --show-current 2>/dev/null`),
      containerManager.execInContainerAsync(containerName, `cd '${dir}' && git status --porcelain 2>/dev/null`),
    ]);
    branch = branchRaw || null;
    hasChanges = !!(gitStatus && gitStatus.trim());
  }

  let scripts = {};
  try {
    if (pkgContent) {
      const pkg = JSON.parse(pkgContent);
      scripts = pkg.scripts || {};
    }
  } catch { /* invalid package.json */ }

  let packageManager = "npm";
  if (hasPnpmRaw === "yes") packageManager = "pnpm";
  else if (hasYarnRaw === "yes") packageManager = "yarn";

  const deployScripts = Object.keys(scripts).filter(script => /^(deploy|release|publish|ship)(:|$)|deploy|release/i.test(script));

  return {
    path: dir,
    name: folderName,
    isGitRepo: isGit,
    branch,
    hasChanges,
    scripts,
    packageManager,
    hasPackageJson: !!pkgContent,
    hasDockerfile: hasDockerfileRaw === "yes",
    hasCompose: hasComposeRaw === "yes",
    hasVercel: hasVercelRaw === "yes",
    hasNetlify: hasNetlifyRaw === "yes",
    deployScripts,
  };
}

/**
 * GET /api/containers/status
 * Check Docker availability and dev image status
 */
router.get("/status", (req, res) => {
  try {
    const dockerAvailable = containerManager.isDockerAvailable();
    let imageReady = false;

    if (dockerAvailable) {
      try {
        // Use enhanced PATH so Docker is found on macOS (Docker Desktop, Homebrew)
        const extraPaths = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"].join(path.delimiter);
        const envWithDocker = { ...process.env, PATH: `${process.env.PATH || ""}${path.delimiter}${extraPaths}` };
        const images = rawExecSync("docker images -q startupp-ai-ide-dev:latest", {
          encoding: "utf-8",
          env: envWithDocker,
        }).trim();
        imageReady = images.length > 0;
      } catch {
        imageReady = false;
      }
    }

    // Detect server OS for install instructions
    const platform = os.platform(); // 'linux', 'darwin', 'win32'
    const arch = os.arch(); // 'x64', 'arm64'

    res.json({
      dockerAvailable,
      imageReady,
      serverOS: platform,
      serverArch: arch,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/containers
 * List all IDE-managed containers
 */
router.get("/", (req, res) => {
  try {
    const containers = containerManager.listContainers();
    res.json({ containers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/containers/build-image
 * Build the dev container image
 */
router.post("/build-image", async (req, res) => {
  try {
    const result = await containerManager.buildImage();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/containers
 * Create a new container for a project
 * Body: { projectId, name, gitUrl, env, ports }
 */
router.post("/", async (req, res) => {
  try {
    const { projectId, name, gitUrl, env, ports } = req.body;

    if (!projectId || !name) {
      return res
        .status(400)
        .json({ error: "projectId and name are required" });
    }

    const result = await containerManager.createContainer({
      projectId,
      name,
      gitUrl,
      env,
      ports,
    });

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/containers/:name/start
 * Start a stopped container
 */
router.post("/:name/start", (req, res) => {
  try {
    const success = containerManager.startContainer(req.params.name);
    if (success) {
      res.json({ status: "started", container: req.params.name });
    } else {
      res.status(404).json({ error: "Container not found or failed to start" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/containers/:name/stop
 * Stop a running container
 */
router.post("/:name/stop", (req, res) => {
  try {
    const success = containerManager.stopContainer(req.params.name);
    if (success) {
      res.json({ status: "stopped", container: req.params.name });
    } else {
      res
        .status(404)
        .json({ error: "Container not found or failed to stop" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/containers/:name/restart
 * Restart a container (stop + start)
 */
router.post("/:name/restart", (req, res) => {
  try {
    const { timeout } = req.body;
    const success = containerManager.restartContainer(
      req.params.name,
      timeout || 10
    );
    if (success) {
      res.json({ status: "restarted", container: req.params.name });
    } else {
      res
        .status(404)
        .json({ error: "Container not found or failed to restart" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/containers/:name/recreate
 * Recreate a container from project data — volumes (code + auth) are preserved.
 * Use this to apply new Docker config (networking, env vars) without losing anything.
 */
router.post("/:name/recreate", async (req, res) => {
  try {
    const { name } = req.params;

    // Look up the project that owns this container
    const db = getDB();
    const project = (db.data.projects || []).find(p => p.containerName === name);
    if (!project) {
      return res.status(404).json({ error: "No project found for this container" });
    }

    const result = await containerManager.recreateContainer(project);
    res.json({ status: "recreated", container: result.containerName, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/containers/:name
 * Remove a container and its volumes
 */
router.delete("/:name", (req, res) => {
  try {
    const success = containerManager.removeContainer(req.params.name);
    if (success) {
      res.json({ status: "removed", container: req.params.name });
    } else {
      res
        .status(404)
        .json({ error: "Container not found or failed to remove" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/containers/:name/status
 * Get a single container's status
 */
router.get("/:name/status", (req, res) => {
  try {
    const status = containerManager.getContainerStatus(req.params.name);
    if (status) {
      res.json({ container: req.params.name, status });
    } else {
      res.status(404).json({ error: "Container not found" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/containers/:name/exec
 * Execute a command inside a container
 * Body: { command, timeout? }
 */
router.post("/:name/exec", (req, res) => {
  try {
    const { command, timeout } = req.body;

    if (!command) {
      return res.status(400).json({ error: "command is required" });
    }

    // Verify container is running first
    const status = containerManager.getContainerStatus(req.params.name);
    if (!status) {
      return res.status(404).json({ error: "Container not found" });
    }
    if (status !== "running") {
      return res
        .status(409)
        .json({ error: `Container is not running (status: ${status})` });
    }

    const output = containerManager.execInContainer(
      req.params.name,
      command,
      { timeout: timeout || 30000 },
    );

    res.json({
      container: req.params.name,
      command,
      output,
      success: output !== null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/containers/:name/repos
 * List repos inside the container with their git branch and detected scripts
 */
router.get("/:name/repos", async (req, res) => {
  try {
    const { name } = req.params;
    const status = await containerManager.getContainerStatusAsync(name);
    if (!status) return res.status(404).json({ error: "Container not found" });
    if (status !== "running") return res.status(400).json({ error: "Container is not running" });

    const repos = await getCached(
      containerCacheKey(name, "repos"),
      CACHE_TTLS.repos,
      async () => {
        const workspaceRepo = await describeWorkspaceRepo(name, "/workspace");
        if (workspaceRepo.isGitRepo || workspaceRepo.hasPackageJson) return [workspaceRepo];

        // List directories in /workspace
        const dirsOutput = await containerManager.execInContainerAsync(name, "ls -d /workspace/*/ 2>/dev/null");
        if (!dirsOutput) return [];

        const dirs = dirsOutput.split("\n").filter(Boolean).map(d => d.replace(/\/$/, ""));

        return mapLimit(dirs, 4, async (dir) => describeWorkspaceRepo(name, dir));
      },
      { force: isRefreshRequest(req) },
    );

    res.json({ repos });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GIT BRANCHES & WORKTREES
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/containers/:name/branches
 * List git branches with PR status and author info for categorization.
 * Query: ?repoPath=/workspace/my-repo (default: auto-detect single repo or /workspace)
 */
router.get("/:name/branches", async (req, res) => {
  try {
    const { name } = req.params;
    const status = await containerManager.getContainerStatusAsync(name);
    if (!status) return res.status(404).json({ error: "Container not found" });
    if (status !== "running") return res.status(409).json({ error: "Container is not running" });

    const includePr = req.query.includePr !== "0" && req.query.includePr !== "false";
    const includeRemote = req.query.includeRemote !== "0" && req.query.includeRemote !== "false";
    const requestedRepoPath = req.query.repoPath || "auto";
    const cacheKey = containerCacheKey(name, "branches", requestedRepoPath, includePr, includeRemote);
    const data = await getCached(
      cacheKey,
      includePr ? CACHE_TTLS.branchesWithPrs : CACHE_TTLS.branches,
      async () => {
        const exec = (cmd, timeout = 10000) => containerManager.execInContainerAsync(name, cmd, { timeout });

        // Determine repo path — detect actual git root if not specified
        const repoPath = req.query.repoPath || await findGitRootAsync(name);

        const [currentRaw, gitUserRaw, gitEmailRaw, rawBranches, rawRemote] = await Promise.all([
          exec(`cd '${repoPath}' && git branch --show-current 2>/dev/null`),
          exec(`cd '${repoPath}' && git config user.name 2>/dev/null`),
          exec(`cd '${repoPath}' && git config user.email 2>/dev/null`),
          exec(`cd '${repoPath}' && git branch --list --format='%(refname:short)|%(authorname)|%(authoremail)|%(creatordate:iso8601)' 2>/dev/null`),
          includeRemote
            ? exec(`cd '${repoPath}' && git branch -r --format='%(refname:short)' 2>/dev/null`)
            : Promise.resolve(null),
        ]);

        const current = currentRaw?.trim() || null;
        const gitUser = gitUserRaw?.trim() || null;
        const gitEmail = gitEmailRaw?.trim() || null;
        const localBranches = rawBranches
          ? rawBranches.split("\n").filter(Boolean).map(line => {
            const [branchName, author, email, date] = line.split("|").map(s => s?.trim());
            return { name: branchName, author: author || null, email: email || null, date: date || null };
          })
          : [];

        const localSet = new Set(localBranches.map(b => b.name));
        const remoteBranches = rawRemote
          ? rawRemote.split("\n").filter(Boolean).map(b => b.trim())
              .filter(b => !b.includes("HEAD"))
              .map(b => b.replace(/^origin\//, ""))
              .filter(b => !localSet.has(b))
          : [];

        // Fetch PR status only for the enriched request; the UI opens with a fast branch-only response.
        let prMap = {};
        if (includePr) {
          try {
            const prJson = await exec(
              `cd '${repoPath}' && gh pr list --state all --limit 100 --json headRefName,number,state,author,title 2>/dev/null`,
            );
            if (prJson) {
              const prs = JSON.parse(prJson.trim());
              for (const pr of prs) {
                prMap[pr.headRefName] = {
                  number: pr.number,
                  state: pr.state, // OPEN, CLOSED, MERGED
                  title: pr.title,
                  author: pr.author?.login || null,
                };
              }
            }
          } catch { /* gh not installed or not authenticated */ }
        }

        const enriched = localBranches.map(b => ({
          ...b,
          pr: prMap[b.name] || null,
          isMine: !!(gitUser && b.author && b.author === gitUser) ||
                  !!(gitEmail && b.email && b.email.includes(gitEmail)),
        }));

        return { repoPath, current, branches: enriched, remoteBranches, gitUser, prEnriched: includePr, remoteEnriched: includeRemote };
      },
      { force: isRefreshRequest(req) },
    );

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/containers/:name/worktree
 * Ensure a working directory exists for a branch inside the container.
 * If the branch is already checked out somewhere, returns that path.
 * Otherwise creates a new git worktree.
 *
 * Body: { branch, repoPath? }
 * Returns: { worktreePath, created, branch }
 */
router.post("/:name/worktree", (req, res) => {
  try {
    const { name } = req.params;
    const { branch, repoPath } = req.body;

    if (!branch) return res.status(400).json({ error: "branch is required" });

    const status = containerManager.getContainerStatus(name);
    if (!status) return res.status(404).json({ error: "Container not found" });
    if (status !== "running") return res.status(409).json({ error: "Container is not running" });

    const exec = (cmd, timeout = 10000) => containerManager.execInContainer(name, cmd, { timeout });
    const effectiveRepoPath = repoPath || findGitRoot(name);

    // Sanitize branch name for directory path
    const safeBranch = branch.replace(/[^a-zA-Z0-9._-]/g, "-");
    const worktreePath = `/workspace/.worktrees/${safeBranch}`;

    // ── Step 1: Check if the branch is already checked out anywhere ──
    // Collect all worktree paths, then verify the ACTUAL current branch at each
    const wtListRaw = exec(`cd '${effectiveRepoPath}' && git worktree list --porcelain 2>/dev/null; true`);
    if (wtListRaw) {
      const wtPaths = [];
      for (const line of wtListRaw.split("\n")) {
        if (line.startsWith("worktree ")) {
          wtPaths.push(line.slice(9).trim());
        }
      }
      // Check each worktree's actual current branch (not the registered ref)
      for (const wtPath of wtPaths) {
        const actualBranch = exec(`cd '${wtPath}' && git branch --show-current 2>/dev/null`)?.trim();
        if (actualBranch === branch) {
          return res.json({ worktreePath: wtPath, created: false, branch, reused: true, repoPath: effectiveRepoPath });
        }
      }
    }

    // ── Step 2: Check if our expected worktree path already exists ──
    const exists = exec(`test -d '${worktreePath}' && echo yes`)?.trim() === "yes";
    if (exists) {
      const wtBranch = exec(`cd '${worktreePath}' && git branch --show-current 2>/dev/null`)?.trim();
      if (wtBranch === branch) {
        return res.json({ worktreePath, created: false, branch: wtBranch, repoPath: effectiveRepoPath });
      }
      // Exists but wrong branch — remove and recreate
      exec(`cd '${effectiveRepoPath}' && git worktree remove '${worktreePath}' --force 2>/dev/null`);
    }

    // ── Step 3: Create a new worktree ──
    exec(`mkdir -p /workspace/.worktrees`, 5000);

    // Check if branch exists locally or on remote
    const localExists = exec(
      `cd '${effectiveRepoPath}' && git show-ref --verify --quiet refs/heads/${branch} && echo yes`,
    )?.trim() === "yes";

    const remoteExists = !localExists && exec(
      `cd '${effectiveRepoPath}' && git show-ref --verify --quiet refs/remotes/origin/${branch} && echo yes`,
    )?.trim() === "yes";

    let addCmd;
    if (localExists) {
      addCmd = `cd '${effectiveRepoPath}' && git worktree add '${worktreePath}' '${branch}' 2>&1; true`;
    } else if (remoteExists) {
      addCmd = `cd '${effectiveRepoPath}' && git worktree add '${worktreePath}' -b '${branch}' 'origin/${branch}' 2>&1; true`;
    } else {
      addCmd = `cd '${effectiveRepoPath}' && git worktree add -b '${branch}' '${worktreePath}' 2>&1; true`;
    }

    const output = exec(addCmd, 30000) || "";

    // Verify the worktree was actually created
    const verified = exec(`test -d '${worktreePath}' && echo yes`)?.trim() === "yes";

    if (!verified) {
      let detail = output.trim();
      if (detail.includes("already checked out")) {
        detail = `Branch '${branch}' is already checked out elsewhere but could not be located. Try running 'git worktree prune' in the container.`;
      } else if (!detail || detail.includes("usage:")) {
        detail = `git worktree add failed. The branch may not exist or there may be a naming conflict.`;
      }
      return res.status(500).json({
        error: `Cannot create worktree for '${branch}'`,
        detail,
        repoPath: effectiveRepoPath,
      });
    }

    // Fix ownership
    containerManager.execInContainer(name,
      `chown -R dev:dev '${worktreePath}' 2>/dev/null`,
      { timeout: 10000 },
    );

    invalidateContainerCache(name);
    res.json({ worktreePath, created: true, branch, output, repoPath: effectiveRepoPath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GIT ACTIONS (pull, status, commit+push, PR)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Helper: find the actual git repo root inside the container.
 * Handles the common case where the repo is in a subdirectory of /workspace.
 */
function findGitRoot(name) {
  const cacheKey = containerCacheKey(name, "git-root");
  const cached = getCache(cacheKey);
  if (cached !== undefined) return cached;

  const workDir = containerManager.getWorkDir(name) || "/workspace";
  // Check if workDir itself is a git repo
  const hasGit = containerManager.execInContainer(name,
    `test -e '${workDir}/.git' && echo yes`,
    { timeout: 5000 },
  )?.trim();
  if (hasGit === "yes") return setCache(cacheKey, workDir, CACHE_TTLS.gitRoot);

  // workDir is /workspace but no .git there — scan subdirectories for a git repo
  const gitDir = containerManager.execInContainer(name,
    `find /workspace -maxdepth 2 -name .git -print -quit 2>/dev/null`,
    { timeout: 5000 },
  )?.trim();
  if (gitDir) {
    // Return the parent of .git (the repo root)
    return setCache(cacheKey, gitDir.replace(/\/\.git$/, ""), CACHE_TTLS.gitRoot);
  }

  return setCache(cacheKey, workDir, CACHE_TTLS.gitRoot);
}

async function findGitRootAsync(name) {
  return getCached(containerCacheKey(name, "git-root"), CACHE_TTLS.gitRoot, async () => {
    const workDir = containerManager.getWorkDir(name) || "/workspace";
    const hasGit = (await containerManager.execInContainerAsync(name,
      `test -e '${workDir}/.git' && echo yes`,
      { timeout: 5000 },
    ))?.trim();
    if (hasGit === "yes") return workDir;

    const gitDir = (await containerManager.execInContainerAsync(name,
      `find /workspace -maxdepth 2 -name .git -print -quit 2>/dev/null`,
      { timeout: 5000 },
    ))?.trim();
    if (gitDir) return gitDir.replace(/\/\.git$/, "");

    return workDir;
  });
}

/** Helper: resolve effective repo path for git actions (worktree-aware) */
function resolveGitPath(name, query) {
  if (query.worktreePath) return query.worktreePath;
  if (query.repoPath) return query.repoPath;
  return findGitRoot(name);
}

async function resolveGitPathAsync(name, query) {
  if (query.worktreePath) return query.worktreePath;
  if (query.repoPath) return query.repoPath;
  return findGitRootAsync(name);
}

/** Helper: validate container is running */
function requireRunning(name) {
  const status = containerManager.getContainerStatus(name);
  if (!status) return { error: "Container not found", code: 404 };
  if (status !== "running") return { error: "Container is not running", code: 409 };
  return null;
}

async function requireRunningAsync(name) {
  const status = await containerManager.getContainerStatusAsync(name);
  if (!status) return { error: "Container not found", code: 404 };
  if (status !== "running") return { error: "Container is not running", code: 409 };
  return null;
}

/**
 * GET /api/containers/:name/git-status
 * Get branch status: current branch, dirty files, ahead/behind, PR status.
 * Query: ?worktreePath=...&repoPath=...
 */
router.get("/:name/git-status", async (req, res) => {
  try {
    const { name } = req.params;
    const err = await requireRunningAsync(name);
    if (err) return res.status(err.code).json({ error: err.error });

    const gitPath = await resolveGitPathAsync(name, req.query);
    const exec = (cmd, timeout = 10000) => containerManager.execInContainerAsync(name, cmd, { timeout });

    const [branchRaw, statusRawResult, trackingRaw] = await Promise.all([
      exec(`cd '${gitPath}' && git branch --show-current 2>/dev/null`),
      exec(`cd '${gitPath}' && git status --porcelain 2>/dev/null`),
      exec(`cd '${gitPath}' && git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null`),
    ]);

    const branch = branchRaw?.trim() || null;
    const statusRaw = statusRawResult || "";
    const dirty = statusRaw.trim().split("\n").filter(Boolean);
    const staged = dirty.filter(l => /^[MADRC]/.test(l)).length;
    const unstaged = dirty.filter(l => /^.[MDRC?]/.test(l) || /^\?\?/.test(l)).length;

    // Ahead/behind remote
    let ahead = 0, behind = 0;
    const tracking = trackingRaw?.trim();
    if (tracking) {
      const ab = (await exec(`cd '${gitPath}' && git rev-list --left-right --count '${tracking}...HEAD' 2>/dev/null`))?.trim();
      if (ab) {
        const [b, a] = ab.split(/\s+/).map(Number);
        behind = b || 0;
        ahead = a || 0;
      }
    }

    // Check for GitHub PR via gh CLI (if installed)
    let pr = null;
    const includePr = req.query.includePr !== "0" && req.query.includePr !== "false";
    if (includePr && branch) {
      pr = await getCached(
        containerCacheKey(name, "status-pr", gitPath, branch),
        CACHE_TTLS.statusPr,
        async () => {
          try {
            const prJson = await exec(`cd '${gitPath}' && gh pr view --json number,title,state,url 2>/dev/null`, 5000);
            return prJson ? JSON.parse(prJson.trim()) : null;
          } catch {
            return null;
          }
        },
        { force: isRefreshRequest(req) },
      );
    }

    res.json({ branch, dirty: dirty.length, staged, unstaged, ahead, behind, tracking: tracking || null, pr, prEnriched: includePr, repoPath: gitPath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/containers/:name/git-pull
 * Pull latest changes.
 * Body: { worktreePath?, repoPath? }
 */
router.post("/:name/git-pull", (req, res) => {
  try {
    const { name } = req.params;
    const err = requireRunning(name);
    if (err) return res.status(err.code).json({ error: err.error });

    const gitPath = resolveGitPath(name, req.body);
    const output = containerManager.execInContainer(name,
      `cd '${gitPath}' && git pull --ff-only 2>&1`,
      { timeout: 30000 },
    );
    invalidateContainerCache(name);
    res.json({ output: output || "Already up to date." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/containers/:name/git-commit-push
 * Stage all, commit with auto-generated message, and push.
 * Body: { worktreePath?, repoPath?, message? }
 * If message is omitted, generates one from the diff.
 */
router.post("/:name/git-commit-push", async (req, res) => {
  try {
    const { name } = req.params;
    const err = requireRunning(name);
    if (err) return res.status(err.code).json({ error: err.error });

    const gitPath = resolveGitPath(name, req.body);
    const exec = (cmd, timeout = 15000) => containerManager.execInContainer(name, cmd, { timeout });

    // Stage everything
    exec(`cd '${gitPath}' && git add -A`);

    // Check if there's anything to commit
    const staged = exec(`cd '${gitPath}' && git diff --cached --stat 2>/dev/null`)?.trim();
    if (!staged) return res.status(400).json({ error: "Nothing to commit" });

    // Generate commit message if not provided
    let message = req.body.message?.trim();
    if (!message) {
      const diffSummary = exec(`cd '${gitPath}' && git diff --cached --stat 2>/dev/null`)?.trim() || "";
      const diffContent = exec(`cd '${gitPath}' && git diff --cached --no-color 2>/dev/null | head -200`)?.trim() || "";
      const branch = exec(`cd '${gitPath}' && git branch --show-current 2>/dev/null`)?.trim() || "unknown";

      // Try LLM-generated message
      try {
        const { default: llmProvider } = await import("../llmProvider.js");
        const prompt = `Generate a concise git commit message (max 72 chars for title, optional body after blank line) for these changes on branch '${branch}':\n\n${diffSummary}\n\n${diffContent}`;
        const generated = await llmProvider.generateText(prompt, { maxTokens: 150 });
        message = generated?.trim();
      } catch { /* LLM unavailable */ }

      if (!message) {
        // Fallback: generate from diff stat
        const files = staged.split("\n").filter(l => l.includes("|")).map(l => l.trim().split(/\s+/)[0]);
        message = `Update ${files.slice(0, 3).join(", ")}${files.length > 3 ? ` and ${files.length - 3} more` : ""}`;
      }
    }

    // Commit
    const safeMsg = message.replace(/'/g, "'\\''");
    exec(`cd '${gitPath}' && git commit -m '${safeMsg}'`, 15000);

    // Push
    const branch = exec(`cd '${gitPath}' && git branch --show-current 2>/dev/null`)?.trim();
    const pushOutput = exec(`cd '${gitPath}' && git push -u origin '${branch}' 2>&1`, 30000) || "";

    invalidateContainerCache(name);
    res.json({ message, branch, pushOutput, staged });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/containers/:name/git-create-pr
 * Create a GitHub PR for the current branch using gh CLI.
 * Body: { worktreePath?, repoPath?, title?, body? }
 */
router.post("/:name/git-create-pr", async (req, res) => {
  try {
    const { name } = req.params;
    const err = requireRunning(name);
    if (err) return res.status(err.code).json({ error: err.error });

    const gitPath = resolveGitPath(name, req.body);
    const exec = (cmd, timeout = 15000) => containerManager.execInContainer(name, cmd, { timeout });

    const branch = exec(`cd '${gitPath}' && git branch --show-current 2>/dev/null`)?.trim();
    if (!branch || ["main", "master"].includes(branch)) {
      return res.status(400).json({ error: "Cannot create PR from main/master" });
    }

    // Generate title/body if not provided
    let title = req.body.title?.trim();
    let body = req.body.body?.trim();

    if (!title) {
      // Get log of commits not on main
      const baseBranch = exec(`cd '${gitPath}' && git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||'`)?.trim() || "main";
      const log = exec(`cd '${gitPath}' && git log '${baseBranch}..HEAD' --oneline 2>/dev/null`)?.trim() || "";
      const diffStat = exec(`cd '${gitPath}' && git diff '${baseBranch}...HEAD' --stat 2>/dev/null`)?.trim() || "";

      try {
        const { default: llmProvider } = await import("../llmProvider.js");
        const prompt = `Generate a GitHub PR title (max 70 chars) and a markdown body with a ## Summary section (2-3 bullet points) for branch '${branch}':\n\nCommits:\n${log}\n\nChanges:\n${diffStat}`;
        const generated = await llmProvider.generateText(prompt, { maxTokens: 300 });
        if (generated) {
          const lines = generated.trim().split("\n");
          title = lines[0].replace(/^#+\s*/, "").trim();
          body = lines.slice(1).join("\n").trim() || undefined;
        }
      } catch { /* LLM unavailable */ }

      if (!title) title = branch.replace(/[-_/]/g, " ").replace(/^\w/, c => c.toUpperCase());
    }

    const safeTitle = title.replace(/'/g, "'\\''");
    const safeBody = (body || `Branch: ${branch}`).replace(/'/g, "'\\''");

    const prOutput = exec(
      `cd '${gitPath}' && gh pr create --title '${safeTitle}' --body '${safeBody}' 2>&1`,
      30000,
    );

    // Try to parse the PR URL from output
    const urlMatch = prOutput?.match(/https:\/\/github\.com\/[^\s]+/);

    invalidateContainerCache(name);
    res.json({ title, body, output: prOutput, url: urlMatch?.[0] || null, branch });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/containers/:name/git-merge-pr
 * Merge an open PR for the current branch using gh CLI.
 * Body: { worktreePath?, repoPath?, method? (merge|squash|rebase) }
 */
router.post("/:name/git-merge-pr", (req, res) => {
  try {
    const { name } = req.params;
    const err = requireRunning(name);
    if (err) return res.status(err.code).json({ error: err.error });

    const gitPath = resolveGitPath(name, req.body);
    const method = req.body.method || "squash";
    const exec = (cmd, timeout = 15000) => containerManager.execInContainer(name, cmd, { timeout });

    const output = exec(
      `cd '${gitPath}' && gh pr merge --${method} --delete-branch 2>&1`,
      30000,
    );

    invalidateContainerCache(name);
    res.json({ output, method });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/containers/:name/worktree-cleanup
 * Remove a git worktree and optionally delete the local branch.
 * Body: { branch }
 */
router.post("/:name/worktree-cleanup", (req, res) => {
  try {
    const { name } = req.params;
    const { branch } = req.body;
    if (!branch) return res.status(400).json({ error: "branch is required" });

    const err = requireRunning(name);
    if (err) return res.status(err.code).json({ error: err.error });

    const safeBranch = branch.replace(/[^a-zA-Z0-9._-]/g, "-");
    const wtPath = `/workspace/.worktrees/${safeBranch}`;
    const repoPath = findGitRoot(name);
    const exec = (cmd, timeout = 10000) => containerManager.execInContainer(name, cmd, { timeout });

    // Remove the worktree
    exec(`cd '${repoPath}' && git worktree remove '${wtPath}' --force 2>/dev/null`);

    // Delete the local branch (safe — git refuses if it has unmerged changes)
    exec(`cd '${repoPath}' && git branch -d '${branch}' 2>/dev/null`);

    // Prune worktree metadata
    exec(`cd '${repoPath}' && git worktree prune 2>/dev/null`);

    invalidateContainerCache(name);
    res.json({ cleaned: true, branch, worktreePath: wtPath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/containers/:name/files
 * List files in a directory with git status indicators.
 * Query: ?path=/workspace/repo&depth=1
 * Returns: { path, files: [{ name, type, gitStatus, size }] }
 */
router.get("/:name/files", (req, res) => {
  try {
    const { name } = req.params;
    const err = requireRunning(name);
    if (err) return res.status(err.code).json({ error: err.error });

    const dirPath = req.query.path || findGitRoot(name);
    const depth = Math.min(parseInt(req.query.depth) || 1, 3);

    const exec = (cmd, timeout = 10000) => containerManager.execInContainer(name, cmd, { timeout });

    // List files/dirs at path (with type and size)
    const lsOutput = exec(
      `find '${dirPath}' -maxdepth ${depth} -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.git' -not -name '.git' -printf '%y|%s|%P\\n' 2>/dev/null | head -500`,
    );

    const entries = [];
    if (lsOutput) {
      for (const line of lsOutput.split("\n").filter(Boolean)) {
        const [typeChar, size, relativePath] = line.split("|");
        if (!relativePath) continue; // skip root dir itself
        entries.push({
          name: relativePath,
          type: typeChar === "d" ? "directory" : "file",
          size: parseInt(size) || 0,
        });
      }
    }

    // Get git status for the directory
    const gitStatusRaw = exec(`cd '${dirPath}' && git status --porcelain --untracked-files=normal 2>/dev/null`);
    const gitMap = {};
    if (gitStatusRaw) {
      for (const line of gitStatusRaw.split("\n").filter(Boolean)) {
        const status = line.slice(0, 2);
        const filePath = line.slice(3).trim().replace(/^"(.*)"$/, "$1"); // handle quoted paths
        let label;
        if (status === "??") label = "untracked";
        else if (status.startsWith("A") || status.startsWith("M") || status[1] === "M") label = "modified";
        else if (status.startsWith("D") || status[1] === "D") label = "deleted";
        else if (status.startsWith("R")) label = "renamed";
        else label = "modified";
        gitMap[filePath] = label;
      }
    }

    // Enrich entries with git status
    const filesWithStatus = entries.map(e => ({
      ...e,
      gitStatus: gitMap[e.name] || (e.type === "directory" ? null : "tracked"),
    }));

    // Sort: directories first, then by name. Untracked/modified float up.
    filesWithStatus.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      const aWeight = (a.gitStatus === "untracked" || a.gitStatus === "modified") ? 0 : 1;
      const bWeight = (b.gitStatus === "untracked" || b.gitStatus === "modified") ? 0 : 1;
      if (aWeight !== bWeight) return aWeight - bWeight;
      return a.name.localeCompare(b.name);
    });

    res.json({ path: dirPath, files: filesWithStatus, gitStatusCount: Object.keys(gitMap).length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// SSH KEY MANAGEMENT
// ──────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/containers/:name/ssh-keys
 * Upload SSH key files into the container's ~/.ssh directory with correct permissions.
 * Accepts multipart files (private key, public key, config, known_hosts, etc.).
 */
router.post("/:name/ssh-keys", tmpUpload.array("files", 10), (req, res) => {
  try {
    const { name } = req.params;
    const err = requireRunning(name);
    if (err) return res.status(err.code).json({ error: err.error });

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const exec = (cmd, timeout = 5000) => containerManager.execInContainer(name, cmd, { timeout });

    // Ensure ~/.ssh directory exists with correct permissions
    exec(`mkdir -p /home/dev/.ssh && chmod 700 /home/dev/.ssh && chown dev:dev /home/dev/.ssh`);

    const extraPaths = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"].join(path.delimiter);
    const envWithDocker = { ...process.env, PATH: `${process.env.PATH || ""}${path.delimiter}${extraPaths}` };

    const uploaded = [];
    for (const file of req.files) {
      const destPath = `/home/dev/.ssh/${file.originalname}`;
      try {
        rawExecSync(`docker cp '${file.path}' '${name}:${destPath}'`, {
          encoding: "utf-8",
          env: envWithDocker,
          timeout: 10000,
        });

        // Set correct permissions based on file type
        const isPublicKey = file.originalname.endsWith('.pub');
        const isConfig = ['config', 'known_hosts', 'authorized_keys'].includes(file.originalname);
        const perms = isPublicKey || isConfig ? '644' : '600';

        exec(`chmod ${perms} '${destPath}' && chown dev:dev '${destPath}'`);
        uploaded.push({ name: file.originalname, path: destPath, permissions: perms });
      } catch (e) {
        uploaded.push({ name: file.originalname, error: e.message });
      } finally {
        try { fs.unlinkSync(file.path); } catch {}
      }
    }

    // Ensure known_hosts exists (prevents "Host key verification failed" prompts)
    exec(`touch /home/dev/.ssh/known_hosts && chmod 644 /home/dev/.ssh/known_hosts && chown dev:dev /home/dev/.ssh/known_hosts`);

    res.json({ uploaded, sshDir: "/home/dev/.ssh" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/containers/:name/ssh-keys
 * List SSH key files in the container's ~/.ssh directory.
 */
router.get("/:name/ssh-keys", (req, res) => {
  try {
    const { name } = req.params;
    const err = requireRunning(name);
    if (err) return res.status(err.code).json({ error: err.error });

    const output = containerManager.execInContainer(name,
      `ls -la /home/dev/.ssh/ 2>/dev/null | tail -n +2`,
      { timeout: 5000 },
    );

    const files = [];
    if (output) {
      for (const line of output.split("\n").filter(Boolean)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 9) {
          const perms = parts[0];
          const size = parseInt(parts[4]) || 0;
          const fileName = parts.slice(8).join(" ");
          if (fileName !== '.' && fileName !== '..') {
            files.push({ name: fileName, permissions: perms, size });
          }
        }
      }
    }

    res.json({ files, sshDir: "/home/dev/.ssh" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// CONTAINER FILE BROWSING & UPLOAD
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/containers/:name/browse
 * List directories (and optionally files) at a path inside the container.
 * Query: ?path=/workspace (default: /workspace)
 */
router.get("/:name/browse", (req, res) => {
  try {
    const { name } = req.params;
    const browsePath = req.query.path || "/workspace";

    const status = containerManager.getContainerStatus(name);
    if (!status) return res.status(404).json({ error: "Container not found" });
    if (status !== "running") return res.status(409).json({ error: "Container is not running" });

    // Security: prevent path traversal
    const resolved = path.posix.resolve(browsePath);
    if (!resolved.startsWith("/workspace") && !resolved.startsWith("/home/dev")) {
      return res.status(403).json({ error: "Browsing is restricted to /workspace and /home/dev" });
    }

    // List entries with type indicator: d=directory, f=file
    const output = containerManager.execInContainer(
      name,
      `ls -1pA '${resolved}' 2>/dev/null`,
      { timeout: 5000 },
    );

    if (output === null) {
      return res.json({ path: resolved, entries: [] });
    }

    const entries = output.split("\n").filter(Boolean).map(entry => {
      const isDir = entry.endsWith("/");
      const entryName = isDir ? entry.slice(0, -1) : entry;
      return { name: entryName, type: isDir ? "directory" : "file" };
    });

    // Sort: directories first, then alphabetical
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ path: resolved, entries });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/containers/:name/upload
 * Upload files directly into a container at a given destination path.
 * Form fields: files (multipart), destination (string, e.g. "/workspace/my-repo/src")
 */
router.post("/:name/upload", tmpUpload.array("files", 20), (req, res) => {
  try {
    const { name } = req.params;
    const destination = req.body.destination || "/workspace";

    const status = containerManager.getContainerStatus(name);
    if (!status) return res.status(404).json({ error: "Container not found" });
    if (status !== "running") return res.status(409).json({ error: "Container is not running" });

    // Security: restrict destination
    const resolved = path.posix.resolve(destination);
    if (!resolved.startsWith("/workspace") && !resolved.startsWith("/home/dev")) {
      return res.status(403).json({ error: "Upload restricted to /workspace and /home/dev" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    // Ensure destination directory exists in container
    containerManager.execInContainer(name, `mkdir -p '${resolved}'`, { timeout: 5000 });

    const uploaded = [];
    const extraPaths = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"].join(path.delimiter);
    const envWithDocker = { ...process.env, PATH: `${process.env.PATH || ""}${path.delimiter}${extraPaths}` };

    for (const file of req.files) {
      const containerDest = `${resolved}/${file.originalname}`;
      try {
        rawExecSync(`docker cp '${file.path}' '${name}:${containerDest}'`, {
          encoding: "utf-8",
          env: envWithDocker,
          timeout: 30000,
        });
        // Fix ownership so the dev user can access the file
        containerManager.execInContainer(name, `chown dev:dev '${containerDest}' 2>/dev/null`, { timeout: 5000 });
        uploaded.push({ name: file.originalname, path: containerDest, size: file.size });
      } catch (err) {
        uploaded.push({ name: file.originalname, error: err.message });
      } finally {
        // Clean up temp file
        try { fs.unlinkSync(file.path); } catch { /* ignore */ }
      }
    }

    res.json({ destination: resolved, uploaded });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
