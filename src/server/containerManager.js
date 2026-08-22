import { execSync } from "child_process";
import crypto from "crypto";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { resolveRuntimeEnvironment } from "./connections/runtimeEnvResolver.js";
import {
  execDockerCmd,
  execDockerCmdAsync,
  isDockerAvailable as isDockerRouteAvailable,
  getDockerRouteStatus,
  buildDockerImageFromDockerfile,
  pullDockerImage,
  tagDockerImage,
  clearDockerRouteCache,
} from "./dockerRoute.js";
import { decideProjectImageAction, getProjectDevImageSpec } from "./projectDevImage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEV_IMAGE = getProjectDevImageSpec().localTag;
const CONTAINER_PREFIX = "sai-";

/** Named volumes mount as root; project shells run as `dev`. */
export function workspaceChownCommand(containerName) {
  return `docker exec -u root ${containerName} chown -R dev:dev /workspace /home/dev`;
}

// Ensure Docker is in PATH — Docker Desktop on macOS and Homebrew install
// to locations that might not be in Node's PATH when launched via PM2/launchd
const EXTRA_PATHS = [
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/usr/bin",
  "/snap/bin",
  `${os.homedir()}/.docker/bin`,
  // macOS Docker Desktop paths
  "/Applications/Docker.app/Contents/Resources/bin",
  `${os.homedir()}/Library/Group Containers/group.com.docker/bin`,
].join(path.delimiter);

const EXEC_OPTS_BASE = {
  encoding: "utf-8",
  stdio: "pipe",
  windowsHide: true, // no console window flash on Windows
  env: {
    ...process.env,
    PATH: `${process.env.PATH || ""}${path.delimiter}${EXTRA_PATHS}`,
  },
};

/**
 * Run a docker CLI command against the host engine socket.
 */
function dockerExec(cmd, opts = {}) {
  return execDockerCmd(cmd, opts);
}

async function dockerExecAsync(cmd, opts = {}) {
  return execDockerCmdAsync(cmd, opts);
}

class ContainerManager extends EventEmitter {
  constructor() {
    super();
  }

  /**
   * Check if Docker is available
   */
  isDockerAvailable() {
    return isDockerRouteAvailable();
  }

  /**
   * The IDE container cannot launch Docker Desktop / dockerd on the host.
   */
  findDockerDesktopLauncher() {
    return null;
  }

  startDockerDesktop() {
    throw new Error(
      "Start Docker on the host (Docker Desktop or `sudo systemctl start docker`). The IDE runs inside a container and cannot launch the engine.",
    );
  }

  /**
   * Poll until `docker info` succeeds or timeout.
   */
  async waitForDockerAvailable(maxWaitMs = 120000, intervalMs = 2000) {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      clearDockerRouteCache();
      if (this.isDockerAvailable()) return true;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }

  isImageReady() {
    if (!this.isDockerAvailable()) return false;
    if (this._imageReadyCachedAt && Date.now() - this._imageReadyCachedAt < 30000) {
      return this._imageReadyCache === true;
    }
    try {
      const images = dockerExec(`docker images -q ${DEV_IMAGE}`, {
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();
      this._imageReadyCache = images.length > 0;
    } catch {
      this._imageReadyCache = false;
    }
    this._imageReadyCachedAt = Date.now();
    return this._imageReadyCache;
  }

  /**
   * Docker + dev image status for the UI health panel.
   */
  getDockerStatus() {
    const routeStatus = getDockerRouteStatus();
    const dockerAvailable = routeStatus.dockerAvailable;
    return {
      dockerAvailable,
      imageReady: dockerAvailable ? this.isImageReady() : false,
      dockerDesktopInstalled: dockerAvailable,
      canAutoStart: false,
      launcherPath: null,
      ...routeStatus,
    };
  }

  /**
   * Ensure the versioned project image is present. Prefer `docker pull` of the
   * CI-published tag; fall back to a local build if the registry is unreachable.
   */
  async buildImage() {
    try {
      const spec = getProjectDevImageSpec();
      const images = String(await dockerExecAsync(`docker images -q ${spec.localTag}`) || "").trim();
      let localVersion = "";
      if (images) {
        try {
          localVersion = String(await dockerExecAsync(
            `docker inspect --format='{{index .Config.Labels "${spec.versionLabel}"}}' ${spec.localTag}`,
          ) || "").trim().replace(/'/g, "");
        } catch {
          localVersion = "";
        }
      }

      const action = decideProjectImageAction({
        hasLocal: Boolean(images),
        localVersion,
        desiredVersion: spec.version,
      });
      if (action === "reuse") {
        return { exists: true, image: spec.localTag, version: spec.version };
      }

      try {
        console.log(`[containerManager] Pulling ${spec.remoteTag}…`);
        await pullDockerImage(spec.remoteTag);
        tagDockerImage(spec.remoteTag, spec.localTag);
        this._imageReadyCache = true;
        this._imageReadyCachedAt = Date.now();
        return { pulled: true, image: spec.localTag, ref: spec.remoteTag, version: spec.version };
      } catch (pullError) {
        console.warn(`[containerManager] Pull failed (${pullError.message}); building locally…`);
      }

      const dockerfilePath = path.join(__dirname, "../../docker/Dockerfile.dev");
      const dockerfileContent = fs.readFileSync(dockerfilePath, "utf-8");
      const currentHash = crypto.createHash("md5").update(dockerfileContent).digest("hex").slice(0, 12);
      console.log(`[containerManager] Building ${spec.localTag} locally (${spec.version})…`);
      await buildDockerImageFromDockerfile(spec.localTag, dockerfileContent, {
        labels: [
          `dockerfile.hash=${currentHash}`,
          `${spec.versionLabel}=${spec.version}`,
        ],
        timeout: 300000,
      });
      this._imageReadyCache = true;
      this._imageReadyCachedAt = Date.now();
      return { built: true, image: spec.localTag, hash: currentHash, version: spec.version };
    } catch (error) {
      throw new Error(`Failed to prepare project image: ${error.message}`);
    }
  }

  /**
   * Create a new container for a project
   * @param {Object} params
   * @param {string} params.projectId - IDE project ID
   * @param {string} params.name - Human-readable name (used in container name)
   * @param {string} params.gitUrl - Git repository URL to clone
   * @param {Object} [params.env] - Environment variables { ANTHROPIC_API_KEY, GH_TOKEN, etc. }
   * @param {string[]} [params.ports] - Port mappings (e.g., ['3000:3000', '8080:8080'])
   * @returns {Object} { containerId, containerName, status }
   */
  async createContainer({ projectId, name, gitUrl, repos = [], env = {}, ports = [] }) {
    const containerName = `${CONTAINER_PREFIX}${name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .slice(0, 30)}-${projectId.slice(0, 8)}`;

    // Check if container already exists
    try {
      const existing = dockerExec(
        `docker inspect ${containerName} --format '{{.State.Status}}'`,
        { encoding: "utf-8", stdio: "pipe" },
      ).trim();
      return {
        containerId: containerName,
        containerName,
        status: existing,
        alreadyExists: true,
      };
    } catch {
      // Container doesn't exist, create it
    }

    const runtimeEnv = projectId ? resolveRuntimeEnvironment({ projectId, target: 'container-create' }).env : {};
    const combinedEnv = { ...runtimeEnv, ...env };

    // Build env flags
    const envFlags = Object.entries(combinedEnv)
      .filter(([, v]) => v)
      .map(([k, v]) => `-e "${k}=${v}"`)
      .join(" ");

    // Build port flags
    const portFlags = ports.map((p) => `-p ${p}`).join(" ");

    // Create container with:
    // - Named volume for /home/dev (persists auth state)
    // - Workspace volume (persists code)
    const homeVolume = `${containerName}-home`;
    const workspaceVolume = `${containerName}-workspace`;

    const cmd = [
      "docker create",
      `--name ${containerName}`,
      `-v ${homeVolume}:/home/dev`,
      `-v ${workspaceVolume}:/workspace`,
      // Allow containers to reach Ollama running on the host
      "--add-host=host.docker.internal:host-gateway",
      "-e OLLAMA_HOST=http://host.docker.internal:11434",
      "-e OLLAMA_API_BASE=http://host.docker.internal:11434",
      envFlags,
      portFlags,
      `--label sai.projectId=${projectId}`,
      `--label sai.gitUrl=${gitUrl || ""}`,
      DEV_IMAGE,
    ]
      .filter(Boolean)
      .join(" ");

    try {
      dockerExec(cmd, { encoding: "utf-8", stdio: "pipe" });

      // Start the container
      dockerExec(`docker start ${containerName}`, {
        encoding: "utf-8",
        stdio: "pipe",
      });

      this.ensureWorkspaceOwnership(containerName);

      // Configure OpenCode for Ollama with high context
      this.configureOpenCodeOllama(containerName);
      // Provision curated MCP servers into the CLI tool configs (best-effort).
      import('./mcpProvisioner.js')
        .then((m) => m.provisionContainerMcp(containerName))
        .catch(() => {});

      // Clone repos — supports multiple repos for monorepo/multi-service workspaces
      const repoList = repos.length > 0
        ? repos
        : gitUrl ? [{ url: gitUrl, folder: '' }] : []; // Backward compat

      for (const repo of repoList) {
        if (!repo.url) continue;
        // Derive folder name from URL if not specified
        const folder = repo.folder?.trim() || repo.url.split('/').pop().replace(/\.git$/, '');
        const targetPath = `/workspace/${folder}`;
        try {
          dockerExec(
            `docker exec ${containerName} git clone "${repo.url}" "${targetPath}"`,
            { encoding: "utf-8", stdio: "pipe", timeout: 120000 },
          );
        } catch {
          // Already cloned or failed — try pulling
          try {
            dockerExec(
              `docker exec ${containerName} bash -c "cd ${targetPath} && git pull"`,
              { encoding: "utf-8", stdio: "pipe", timeout: 30000 },
            );
          } catch { /* user can handle in terminal */ }
        }
      }

      return { containerId: containerName, containerName, status: "running" };
    } catch (error) {
      throw new Error(`Failed to create container: ${error.message}`);
    }
  }

  /**
   * Start a stopped container
   */
  startContainer(containerName) {
    try {
      dockerExec(`docker start ${containerName}`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
      this.ensureWorkspaceOwnership(containerName);
      // Ensure OpenCode is configured for Ollama on each start
      this.configureOpenCodeOllama(containerName);
      // Provision curated MCP servers into the CLI tools (best-effort; keeps
      // existing containers up to date on their next start). Dynamic import
      // avoids a circular dependency.
      import('./mcpProvisioner.js')
        .then((m) => m.provisionContainerMcp(containerName))
        .catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Empty named volumes are root-owned. The image USER is `dev`, so clone/write
   * fails until /workspace and /home/dev belong to that user.
   */
  ensureWorkspaceOwnership(containerName) {
    try {
      dockerExec(workspaceChownCommand(containerName), {
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 30000,
      });
    } catch (error) {
      console.warn(`[containerManager] chown workspace failed: ${error.message}`);
    }
  }

  /**
   * Stop a running container (doesn't destroy it)
   */
  stopContainer(containerName) {
    try {
      dockerExec(`docker stop ${containerName}`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Restart a running container (stop then start)
   * @param {string} containerName - Name of the container to restart
   * @param {number} [timeout=10] - Seconds to wait for graceful stop
   * @returns {boolean} - true if restart succeeded
   */
  restartContainer(containerName, timeout = 10) {
    try {
      dockerExec(`docker restart -t ${timeout} ${containerName}`, {
        encoding: "utf-8",
        stdio: "pipe",
        timeout: (timeout + 30) * 1000,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Recreate a container from an existing project record — volumes are preserved.
   * Safe to call when you want to apply new Docker flags (networking, env, etc.)
   * without losing any code or configuration stored in volumes.
   *
   * @param {object} project - Full project record from DB (id, name, gitUrl, repos, containerPorts, etc.)
   */
  async recreateContainer(project) {
    const { containerName, id: projectId, name, gitUrl, repos, containerPorts } = project;
    if (!containerName) throw new Error('Project has no container to recreate');

    // Stop and remove ONLY the container — volumes are left intact
    try {
      dockerExec(`docker stop ${containerName}`, { encoding: 'utf-8', stdio: 'pipe' });
    } catch { /* already stopped */ }

    dockerExec(`docker rm -f ${containerName}`, { encoding: 'utf-8', stdio: 'pipe' });

    // Recreate with the same params — volumes will be reattached by name
    const ports = Array.isArray(containerPorts) ? containerPorts : [];
    const result = await this.createContainer({ projectId, name, gitUrl, repos: repos || [], ports });
    return result;
  }

  /**
   * Remove a container and its volumes
   */
  removeContainer(containerName) {
    try {
      dockerExec(`docker rm -f ${containerName}`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
      // Also remove volumes
      try {
        dockerExec(
          `docker volume rm ${containerName}-home ${containerName}-workspace`,
          { encoding: "utf-8", stdio: "pipe" },
        );
      } catch {
        /* volumes may not exist */
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get container status
   */
  getContainerStatus(containerName) {
    try {
      const status = dockerExec(
        `docker inspect ${containerName} --format '{{.State.Status}}'`,
        { encoding: "utf-8", stdio: "pipe" },
      ).trim();
      return status; // 'running', 'exited', 'created', etc.
    } catch {
      return null; // Container doesn't exist
    }
  }

  async getContainerStatusAsync(containerName) {
    try {
      const status = await dockerExecAsync(
        `docker inspect ${containerName} --format '{{.State.Status}}'`,
        { encoding: "utf-8" },
      );
      return status.trim();
    } catch {
      return null;
    }
  }

  /**
   * List all IDE-managed containers
   */
  listContainers() {
    try {
      const output = dockerExec(
        `docker ps -a --filter "label=sai.projectId" --format '{{.Names}}||{{.Status}}||{{.Labels}}'`,
        { encoding: "utf-8", stdio: "pipe" },
      ).trim();

      if (!output) return [];

      return output.split("\n").map((line) => {
        const [name, status, labels] = line.split("||");
        const projectId =
          labels?.match(/sai\.projectId=([^,]+)/)?.[1] || "";
        const gitUrl = labels?.match(/sai\.gitUrl=([^,]+)/)?.[1] || "";
        return {
          name,
          status,
          projectId,
          gitUrl,
          running: status.startsWith("Up"),
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Execute a command inside a container (returns output)
   */
  execInContainer(containerName, command, options = {}) {
    try {
      return dockerExec(
        `docker exec ${containerName} bash -c "${command.replace(/"/g, '\\"')}"`,
        {
          encoding: "utf-8",
          stdio: "pipe",
          timeout: options.timeout || 30000,
        },
      ).trim();
    } catch {
      return null;
    }
  }

  async execInContainerAsync(containerName, command, options = {}) {
    try {
      const output = await dockerExecAsync(
        `docker exec ${containerName} bash -c "${command.replace(/"/g, '\\"')}"`,
        {
          encoding: "utf-8",
          timeout: options.timeout || 30000,
          maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
        },
      );
      return output.trim();
    } catch {
      return null;
    }
  }

  /**
   * Configure OpenCode inside the container for Ollama access with high context.
   * Creates ~/.config/opencode/opencode.json with Ollama provider pointing to host.
   * Also sets OLLAMA_NUM_CTX env var as fallback for direct ollama CLI usage.
   */
  configureOpenCodeOllama(containerName) {
    // Query installed Ollama models from host (sync curl) so OpenCode can accept
    // --model ollama/<name> for any model the user actually has installed.
    let installedModels = {};
    try {
      const raw = execSync('curl -sf --max-time 3 http://localhost:11434/api/tags', {
        encoding: 'utf-8',
      });
      const data = JSON.parse(raw);
      for (const m of (data.models || [])) {
        installedModels[m.name] = { name: m.name };
      }
    } catch {
      // Ollama not reachable or no models — write config without models list;
      // user will need to restart the container once Ollama is running.
    }

    const config = {
      $schema: "https://opencode.ai/config.json",
      provider: {
        ollama: {
          npm: "@ai-sdk/openai-compatible",
          name: "Ollama (Local)",
          options: {
            baseURL: "http://host.docker.internal:11434/v1",
          },
          ...(Object.keys(installedModels).length > 0 && { models: installedModels }),
        },
      },
    };

    // base64 avoids all shell quoting issues ($schema expansion, double-escaping in execInContainer)
    const b64 = Buffer.from(JSON.stringify(config, null, 2)).toString('base64');
    try {
      this.execInContainer(
        containerName,
        `mkdir -p ~/.config/opencode && echo '${b64}' | base64 -d > ~/.config/opencode/opencode.json`,
        { timeout: 5000 },
      );
      this.execInContainer(
        containerName,
        `grep -q OLLAMA_NUM_CTX ~/.bashrc 2>/dev/null || echo 'export OLLAMA_NUM_CTX=32768' >> ~/.bashrc`,
        { timeout: 5000 },
      );
      console.log(`[containerManager] Configured OpenCode for Ollama in ${containerName} (${Object.keys(installedModels).length} models registered)`);
    } catch (err) {
      console.warn(`[containerManager] Failed to configure OpenCode for Ollama:`, err?.message);
    }
  }

  /**
   * Get the working directory inside the container
   * (either /workspace/repo if cloned, or /workspace)
   */
  getWorkDir(containerName) {
    // Count subdirectories in /workspace
    const dirs = this.execInContainer(
      containerName,
      "ls -d /workspace/*/ 2>/dev/null | wc -l",
    );
    const count = parseInt(dirs) || 0;
    if (count === 1) {
      // Single repo — use it directly as cwd
      const dir = this.execInContainer(containerName, "ls -d /workspace/*/");
      return dir?.trim() || "/workspace";
    }
    // Multiple repos or none — use /workspace root
    return "/workspace";
  }
}

export const containerManager = new ContainerManager();
export default containerManager;
