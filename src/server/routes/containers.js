import { Router } from "express";
import { execSync as rawExecSync } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";
import multer from "multer";
import { containerManager } from "../containerManager.js";
import { getDB } from "../db.js";

const router = Router();

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
router.get("/:name/repos", (req, res) => {
  try {
    const { name } = req.params;
    const status = containerManager.getContainerStatus(name);
    if (!status) return res.status(404).json({ error: "Container not found" });
    if (status !== "running") return res.status(400).json({ error: "Container is not running" });

    // List directories in /workspace
    const dirsOutput = containerManager.execInContainer(name, "ls -d /workspace/*/ 2>/dev/null");
    if (!dirsOutput) return res.json({ repos: [] });

    const dirs = dirsOutput.split("\n").filter(Boolean).map(d => d.replace(/\/$/, ""));
    const repos = [];

    for (const dir of dirs) {
      const folderName = dir.split("/").pop();

      // Check if it's a git repo
      const isGit = containerManager.execInContainer(name, `test -e ${dir}/.git && echo yes`) === "yes";
      let branch = null;
      let hasChanges = false;

      if (isGit) {
        branch = containerManager.execInContainer(name, `cd ${dir} && git branch --show-current 2>/dev/null`) || null;
        const gitStatus = containerManager.execInContainer(name, `cd ${dir} && git status --porcelain 2>/dev/null`);
        hasChanges = !!(gitStatus && gitStatus.trim());
      }

      // Detect scripts from package.json
      let scripts = {};
      let packageManager = "npm";
      try {
        const pkgContent = containerManager.execInContainer(name, `cat ${dir}/package.json 2>/dev/null`);
        if (pkgContent) {
          const pkg = JSON.parse(pkgContent);
          scripts = pkg.scripts || {};
        }
        if (containerManager.execInContainer(name, `test -f ${dir}/pnpm-lock.yaml && echo yes`) === "yes") packageManager = "pnpm";
        else if (containerManager.execInContainer(name, `test -f ${dir}/yarn.lock && echo yes`) === "yes") packageManager = "yarn";
      } catch { /* no package.json */ }

      repos.push({ path: dir, name: folderName, isGitRepo: isGit, branch, hasChanges, scripts, packageManager });
    }

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
 * List git branches for a repo inside the container.
 * Query: ?repoPath=/workspace/my-repo (default: auto-detect single repo or /workspace)
 */
router.get("/:name/branches", (req, res) => {
  try {
    const { name } = req.params;
    const status = containerManager.getContainerStatus(name);
    if (!status) return res.status(404).json({ error: "Container not found" });
    if (status !== "running") return res.status(409).json({ error: "Container is not running" });

    // Determine repo path
    let repoPath = req.query.repoPath;
    if (!repoPath) {
      // Auto-detect: use getWorkDir or list repos
      repoPath = containerManager.getWorkDir(name) || "/workspace";
    }

    // Get current branch
    const current = containerManager.execInContainer(name,
      `cd '${repoPath}' && git branch --show-current 2>/dev/null`,
      { timeout: 5000 },
    )?.trim() || null;

    // Get all local branches
    const rawBranches = containerManager.execInContainer(name,
      `cd '${repoPath}' && git branch --list --format='%(refname:short)' 2>/dev/null`,
      { timeout: 5000 },
    );

    const branches = rawBranches
      ? rawBranches.split("\n").filter(Boolean).map(b => b.trim())
      : [];

    // Get remote branches (for creating new worktrees from remote tracking branches)
    const rawRemote = containerManager.execInContainer(name,
      `cd '${repoPath}' && git branch -r --format='%(refname:short)' 2>/dev/null`,
      { timeout: 5000 },
    );
    const remoteBranches = rawRemote
      ? rawRemote.split("\n").filter(Boolean).map(b => b.trim()).filter(b => !b.includes("HEAD"))
      : [];

    res.json({ repoPath, current, branches, remoteBranches });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/containers/:name/worktree
 * Create or ensure a git worktree for a branch inside the container.
 * Body: { branch, repoPath? }
 * Returns: { worktreePath, created }
 *
 * Convention: worktrees live at /workspace/.worktrees/<sanitized-branch-name>
 */
router.post("/:name/worktree", (req, res) => {
  try {
    const { name } = req.params;
    const { branch, repoPath } = req.body;

    if (!branch) return res.status(400).json({ error: "branch is required" });

    const status = containerManager.getContainerStatus(name);
    if (!status) return res.status(404).json({ error: "Container not found" });
    if (status !== "running") return res.status(409).json({ error: "Container is not running" });

    const effectiveRepoPath = repoPath || containerManager.getWorkDir(name) || "/workspace";

    // Sanitize branch name for directory path
    const safeBranch = branch.replace(/[^a-zA-Z0-9._-]/g, "-");
    const worktreePath = `/workspace/.worktrees/${safeBranch}`;

    // Check if worktree already exists
    const exists = containerManager.execInContainer(name,
      `test -d '${worktreePath}' && echo yes`,
      { timeout: 5000 },
    )?.trim() === "yes";

    if (exists) {
      // Verify it's a valid git worktree and on the right branch
      const wtBranch = containerManager.execInContainer(name,
        `cd '${worktreePath}' && git branch --show-current 2>/dev/null`,
        { timeout: 5000 },
      )?.trim();

      if (wtBranch === branch) {
        return res.json({ worktreePath, created: false, branch: wtBranch });
      }
      // Exists but wrong branch — remove and recreate
      containerManager.execInContainer(name,
        `cd '${effectiveRepoPath}' && git worktree remove '${worktreePath}' --force 2>/dev/null`,
        { timeout: 10000 },
      );
    }

    // Ensure parent directory exists
    containerManager.execInContainer(name,
      `mkdir -p /workspace/.worktrees`,
      { timeout: 5000 },
    );

    // Check if branch exists locally
    const localExists = containerManager.execInContainer(name,
      `cd '${effectiveRepoPath}' && git show-ref --verify --quiet refs/heads/${branch} && echo yes`,
      { timeout: 5000 },
    )?.trim() === "yes";

    // Check if branch exists on remote
    const remoteExists = !localExists && containerManager.execInContainer(name,
      `cd '${effectiveRepoPath}' && git show-ref --verify --quiet refs/remotes/origin/${branch} && echo yes`,
      { timeout: 5000 },
    )?.trim() === "yes";

    let addCmd;
    if (localExists) {
      addCmd = `cd '${effectiveRepoPath}' && git worktree add '${worktreePath}' '${branch}'`;
    } else if (remoteExists) {
      addCmd = `cd '${effectiveRepoPath}' && git worktree add '${worktreePath}' -b '${branch}' 'origin/${branch}'`;
    } else {
      // Branch doesn't exist — create it from current HEAD
      addCmd = `cd '${effectiveRepoPath}' && git worktree add -b '${branch}' '${worktreePath}'`;
    }

    const output = containerManager.execInContainer(name, addCmd, { timeout: 30000 });

    // Fix ownership
    containerManager.execInContainer(name,
      `chown -R dev:dev '${worktreePath}' 2>/dev/null`,
      { timeout: 10000 },
    );

    res.json({ worktreePath, created: true, branch, output });
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

// Multer for temporary upload to host before docker cp
const tmpUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 50 * 1024 * 1024 } });

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
