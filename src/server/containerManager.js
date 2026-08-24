import { execSync } from "child_process";
import crypto from "crypto";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { resolveRuntimeEnvironment } from "./connections/runtimeEnvResolver.js";
import {
  execDockerCmdAsync,
  isDockerAvailable as isDockerRouteAvailable,
  getDockerRouteStatus,
  buildDockerImageFromDockerfile,
  pullDockerImage,
  tagDockerImage,
  clearDockerRouteCache,
  refreshDockerAvailability,
} from "./dockerRoute.js";
import { decideProjectImageAction, getProjectDevImageSpec } from "./projectDevImage.js";
import {
  buildEnsureDevToolsCommand,
  buildOauthPublishCommand,
  oauthSidecarName,
} from "./containerDevTools.js";
import { buildEnsureNvmCommand } from "./containerNode.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEV_IMAGE = getProjectDevImageSpec().localTag;
const CONTAINER_PREFIX = "sai-";

export function classifyContainerInspectError(error) {
  const msg = String(error?.message || error || '');
  if (/no such (object|container)/i.test(msg)) return 'missing';
  if (/timed out|queued too long/i.test(msg)) return 'timeout';
  return 'error';
}

/** Named volumes mount as root; project shells run as `dev`. */
export function workspaceChownCommand(containerName) {
  return `docker exec -u root ${containerName} chown -R dev:dev /workspace /home/dev`;
}

export const PROJECT_CONTAINER_RESTART_POLICY = "unless-stopped";

/**
 * `docker create` argv for a project container. Restart policy keeps the
 * workspace up after Docker Desktop restarts (engine up != project running).
 */
export function buildCreateContainerCommand({
  containerName,
  homeVolume,
  workspaceVolume,
  envFlags = "",
  portFlags = "",
  projectId,
  gitUrl = "",
  image,
}) {
  return [
    "docker create",
    `--name ${containerName}`,
    `--restart ${PROJECT_CONTAINER_RESTART_POLICY}`,
    `-v ${homeVolume}:/home/dev`,
    `-v ${workspaceVolume}:/workspace`,
    "--add-host=host.docker.internal:host-gateway",
    "-e OLLAMA_HOST=http://host.docker.internal:11434",
    "-e OLLAMA_API_BASE=http://host.docker.internal:11434",
    envFlags,
    portFlags,
    `--label sai.projectId=${projectId}`,
    `--label sai.gitUrl=${gitUrl || ""}`,
    image,
  ]
    .filter(Boolean)
    .join(" ");
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
  return execDockerCmdAsync(cmd, opts);
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
      if (await refreshDockerAvailability({ force: true })) return true;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }

  isImageReady() {
    if (!this.isDockerAvailable()) return false;
    const stale = !this._imageReadyCachedAt || Date.now() - this._imageReadyCachedAt > 30000;
    if (stale && !this._imageReadyProbing) {
      this._imageReadyProbing = true;
      dockerExecAsync(`docker images -q ${DEV_IMAGE}`, { timeout: 8000 })
        .then((images) => {
          this._imageReadyCache = String(images || "").trim().length > 0;
        })
        .catch(() => {
          this._imageReadyCache = false;
        })
        .finally(() => {
          this._imageReadyProbing = false;
          this._imageReadyCachedAt = Date.now();
        });
    }
    return this._imageReadyCache === true;
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
        await tagDockerImage(spec.remoteTag, spec.localTag);
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
      const existing = String(await dockerExec(
        `docker inspect ${containerName} --format '{{.State.Status}}'`,
        { timeout: 8000 },
      )).trim();
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

    const cmd = buildCreateContainerCommand({
      containerName,
      homeVolume,
      workspaceVolume,
      envFlags,
      portFlags,
      projectId,
      gitUrl,
      image: DEV_IMAGE,
    });

    try {
      await dockerExec(cmd, { timeout: 60000 });

      await dockerExec(`docker start ${containerName}`, { timeout: 30000 });

      await this.ensureWorkspaceOwnership(containerName);
      await this.ensureDevEnvironment(containerName);

      await this.configureOpenCodeOllama(containerName);
      import('./mcpProvisioner.js')
        .then((m) => m.provisionContainerMcp(containerName))
        .catch(() => {});

      const repoList = repos.length > 0
        ? repos
        : gitUrl ? [{ url: gitUrl, folder: '' }] : [];

      await Promise.all(repoList.filter((repo) => repo.url).map(async (repo) => {
        const folder = repo.folder?.trim() || repo.url.split('/').pop().replace(/\.git$/, '');
        const targetPath = `/workspace/${folder}`;
        try {
          await dockerExec(
            `docker exec ${containerName} git clone "${repo.url}" "${targetPath}"`,
            { timeout: 120000 },
          );
        } catch {
          try {
            await dockerExec(
              `docker exec ${containerName} bash -c "cd ${targetPath} && git pull"`,
              { timeout: 30000 },
            );
          } catch { /* user can handle in terminal */ }
        }
      }));

      return { containerId: containerName, containerName, status: "running" };
    } catch (error) {
      throw new Error(`Failed to create container: ${error.message}`);
    }
  }

  /**
   * Start a stopped container
   */
  async startContainer(containerName) {
    try {
      await dockerExec(`docker start ${containerName}`, { timeout: 30000 });
      await this.applyRestartPolicy(containerName);
      await this.ensureWorkspaceOwnership(containerName);
      await this.ensureDevEnvironment(containerName);
      await this.configureOpenCodeOllama(containerName);
      import('./mcpProvisioner.js')
        .then((m) => m.provisionContainerMcp(containerName))
        .catch(() => {});
      if (this._statusCache) this._statusCache.set(containerName, "running");
      if (this._statusAt) this._statusAt.set(containerName, Date.now());
      return true;
    } catch {
      return false;
    }
  }

  async applyRestartPolicy(containerName) {
    if (!containerName) return;
    try {
      await dockerExec(
        `docker update --restart ${PROJECT_CONTAINER_RESTART_POLICY} ${containerName}`,
        { timeout: 8000 },
      );
    } catch (error) {
      console.warn(`[containerManager] restart policy skipped for ${containerName}: ${error.message}`);
    }
  }

  /**
   * Start any stopped project containers. Docker being up is not the same as
   * a project's workspace running — Desktop restarts leave them exited.
   */
  async startManagedContainers() {
    const listed = await this.listContainers();
    const stopped = listed.filter((item) => item.name && !item.running);
    const results = await Promise.all(stopped.map(async (item) => {
      const ok = await this.startContainer(item.name);
      return { name: item.name, started: ok };
    }));
    return results;
  }

  async ensureContainerRunning(containerName) {
    if (!containerName) return null;
    const status = await this.getContainerStatusAsync(containerName, { fresh: true });
    if (!status) return null;
    if (status === "running") {
      await this.applyRestartPolicy(containerName);
      return status;
    }
    const started = await this.startContainer(containerName);
    if (!started) return status;
    return this.getContainerStatusAsync(containerName, { fresh: true });
  }

  /**
   * Empty named volumes are root-owned. The image USER is `dev`, so clone/write
   * fails until /workspace and /home/dev belong to that user.
   */
  /**
   * Install headless-dev tools (xdg-open, unzip, procps, …) into running
   * project containers and publish Wrangler's OAuth callback port when free.
   * Safe to call on every start — no-ops when already provisioned.
   */
  async ensureDevEnvironment(containerName) {
    if (!containerName) return;
    try {
      await dockerExec(
        `docker exec -u root ${containerName} bash -lc ${JSON.stringify(buildEnsureDevToolsCommand())}`,
        { timeout: 120000 },
      );
    } catch (error) {
      console.warn(`[containerManager] ensureDevTools failed: ${error.message}`);
    }
    try {
      await dockerExec(
        `docker exec -u dev -e HOME=/home/dev ${containerName} bash -lc ${JSON.stringify(buildEnsureNvmCommand())}`,
        { timeout: 180000 },
      );
    } catch (error) {
      console.warn(`[containerManager] ensureNvm failed: ${error.message}`);
    }
    await this.ensureOauthCallbackPublish(containerName);
  }

  async ensureOauthCallbackPublish(containerName) {
    const sidecar = oauthSidecarName(containerName);
    try {
      const status = String(await dockerExec(
        `docker inspect ${sidecar} --format '{{.State.Status}}'`,
        { timeout: 8000 },
      )).trim();
      if (status === 'running') return true;
    } catch {
      // Sidecar does not exist yet.
    }
    let targetIp = '';
    try {
      targetIp = String(await dockerExec(
        `docker inspect ${containerName} --format "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"`,
        { timeout: 8000 },
      )).trim();
    } catch {
      targetIp = '';
    }
    if (!targetIp) {
      console.warn(`[containerManager] OAuth callback publish skipped: no IP for ${containerName}`);
      return false;
    }
    try {
      await dockerExec(
        buildOauthPublishCommand(containerName, { image: DEV_IMAGE, targetIp }),
        { timeout: 30000 },
      );
      return true;
    } catch (error) {
      console.warn(`[containerManager] OAuth callback publish skipped: ${error.message}`);
      return false;
    }
  }

  async ensureWorkspaceOwnership(containerName) {
    try {
      await dockerExec(workspaceChownCommand(containerName), { timeout: 30000 });
    } catch (error) {
      console.warn(`[containerManager] chown workspace failed: ${error.message}`);
    }
  }

  /**
   * Stop a running container (doesn't destroy it)
   */
  async stopContainer(containerName) {
    try {
      await dockerExec(`docker stop ${containerName}`, { timeout: 30000 });
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
  async restartContainer(containerName, timeout = 10) {
    try {
      await dockerExec(`docker restart -t ${timeout} ${containerName}`, {
        timeout: (timeout + 30) * 1000,
      });
      await this.ensureWorkspaceOwnership(containerName);
      await this.ensureDevEnvironment(containerName);
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
      await dockerExec(`docker stop ${containerName}`, { timeout: 30000 });
    } catch { /* already stopped */ }

    await dockerExec(`docker rm -f ${containerName}`, { timeout: 30000 });

    // Recreate with the same params — volumes will be reattached by name
    const ports = Array.isArray(containerPorts) ? containerPorts : [];
    const result = await this.createContainer({ projectId, name, gitUrl, repos: repos || [], ports });
    return result;
  }

  /**
   * Remove a container and its volumes
   */
  async removeContainer(containerName) {
    try {
      await dockerExec(`docker rm -f ${containerName}`, { timeout: 30000 });
      try {
        await dockerExec(
          `docker volume rm ${containerName}-home ${containerName}-workspace`,
          { timeout: 15000 },
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
   * Instant cached status. A background inspect refreshes the cache.
   * Use getContainerStatusAsync when the handler can await.
   */
  getContainerStatus(containerName) {
    if (!containerName) return null;
    if (!this._statusCache) this._statusCache = new Map();
    if (!this._statusAt) this._statusAt = new Map();
    if (!this._statusInflight) this._statusInflight = new Set();
    if (!this._statusInflight.has(containerName)) {
      this._statusInflight.add(containerName);
      this.getContainerStatusAsync(containerName, { fresh: true }).finally(() => {
        this._statusInflight.delete(containerName);
      });
    }
    return this._statusCache.get(containerName) ?? null;
  }

  async getContainerStatusAsync(containerName, { fresh = false } = {}) {
    if (!containerName) return null;
    if (!this._statusCache) this._statusCache = new Map();
    if (!this._statusAt) this._statusAt = new Map();
    const cached = this._statusCache.get(containerName);
    const cachedAt = this._statusAt.get(containerName) || 0;
    if (!fresh && cached && Date.now() - cachedAt < 4000) return cached;
    if (!this.isDockerAvailable()) return cached ?? null;
    try {
      const status = String(await dockerExecAsync(
        `docker inspect ${containerName} --format '{{.State.Status}}'`,
        { timeout: 8000 },
      )).trim();
      this._statusCache.set(containerName, status);
      this._statusAt.set(containerName, Date.now());
      return status;
    } catch {
      this._statusCache.delete(containerName);
      this._statusAt.delete(containerName);
      return null;
    }
  }

  async inspectContainerStateAsync(containerName) {
    if (!containerName) return { status: null, missing: true, kind: 'missing', error: 'No container name' };
    try {
      const status = String(await dockerExecAsync(
        `docker inspect ${containerName} --format '{{.State.Status}}'`,
        { timeout: 8000 },
      )).trim();
      if (this._statusCache) this._statusCache.set(containerName, status);
      if (this._statusAt) this._statusAt.set(containerName, Date.now());
      return { status, missing: false, kind: 'ok', error: null };
    } catch (err) {
      const error = String(err?.message || err || '').trim();
      const kind = classifyContainerInspectError(error);
      if (this._statusCache) this._statusCache.delete(containerName);
      if (this._statusAt) this._statusAt.delete(containerName);
      return { status: null, missing: kind === 'missing', kind, error };
    }
  }

  async listContainers() {
    try {
      const output = String(await dockerExec(
        `docker ps -a --filter "label=sai.projectId" --format '{{.Names}}||{{.Status}}||{{.Labels}}'`,
        { timeout: 8000 },
      )).trim();

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

  execInContainer(containerName, command, options = {}) {
    return this.execInContainerAsync(containerName, command, options);
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
  async configureOpenCodeOllama(containerName) {
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
      await this.execInContainerAsync(
        containerName,
        `mkdir -p ~/.config/opencode && echo '${b64}' | base64 -d > ~/.config/opencode/opencode.json`,
        { timeout: 5000 },
      );
      await this.execInContainerAsync(
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
   * Working directory inside the container (cached). Use getWorkDirAsync when
   * the caller can wait for docker exec.
   */
  getWorkDir(containerName) {
    if (!this._workDirCache) this._workDirCache = new Map();
    if (!this._workDirInflight) this._workDirInflight = new Set();
    if (containerName && !this._workDirInflight.has(containerName)) {
      this._workDirInflight.add(containerName);
      this.getWorkDirAsync(containerName).finally(() => {
        this._workDirInflight.delete(containerName);
      });
    }
    return this._workDirCache.get(containerName) || "/workspace";
  }

  async getWorkDirAsync(containerName) {
    const dirs = await this.execInContainerAsync(
      containerName,
      "ls -d /workspace/*/ 2>/dev/null | wc -l",
    );
    const count = parseInt(dirs, 10) || 0;
    let workDir = "/workspace";
    if (count === 1) {
      const dir = await this.execInContainerAsync(containerName, "ls -d /workspace/*/");
      workDir = dir?.trim() || "/workspace";
    }
    if (!this._workDirCache) this._workDirCache = new Map();
    this._workDirCache.set(containerName, workDir);
    return workDir;
  }
}

export const containerManager = new ContainerManager();
export default containerManager;
