import { execSync } from "child_process";
import crypto from "crypto";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEV_IMAGE = "startupp-ai-ide-dev:latest";
const CONTAINER_PREFIX = "sai-";

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
  env: {
    ...process.env,
    PATH: `${process.env.PATH || ""}${path.delimiter}${EXTRA_PATHS}`,
  },
};

/**
 * Run a shell command with Docker-aware PATH.
 * Wraps execSync with the enhanced PATH so Docker is always found.
 */
function dockerExec(cmd, opts = {}) {
  return execSync(cmd, {
    ...EXEC_OPTS_BASE,
    ...opts,
    env: { ...EXEC_OPTS_BASE.env, ...(opts.env || {}) },
  });
}

class ContainerManager extends EventEmitter {
  constructor() {
    super();
  }

  /**
   * Check if Docker is available
   */
  isDockerAvailable() {
    try {
      dockerExec("docker info", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Build the dev container image if not built or if the Dockerfile has changed.
   * Stores a hash of the Dockerfile as a label on the image so we can detect
   * when it's outdated and auto-rebuild.
   */
  async buildImage() {
    try {
      const dockerfilePath = path.join(__dirname, "../../docker/Dockerfile.dev");
      const dockerContext = path.join(__dirname, "../../docker");

      // Hash the Dockerfile content to detect changes
      const dockerfileContent = fs.readFileSync(dockerfilePath, "utf-8");
      const currentHash = crypto.createHash("md5").update(dockerfileContent).digest("hex").slice(0, 12);

      // Check if image exists AND has the correct hash
      const images = dockerExec(`docker images -q ${DEV_IMAGE}`, {
        encoding: "utf-8",
      }).trim();

      if (images) {
        // Check the stored hash label
        try {
          const storedHash = dockerExec(
            `docker inspect --format='{{index .Config.Labels "dockerfile.hash"}}' ${DEV_IMAGE}`,
            { encoding: "utf-8" },
          ).trim().replace(/'/g, "");

          if (storedHash === currentHash) {
            return { exists: true, image: DEV_IMAGE };
          }
          console.log(`[containerManager] Dockerfile changed (${storedHash} → ${currentHash}), rebuilding image...`);
        } catch {
          // No hash label = old image, rebuild
          console.log(`[containerManager] Image exists but has no version label, rebuilding...`);
        }
      }

      // Build with the hash label baked in
      console.log(`[containerManager] Building ${DEV_IMAGE} (hash: ${currentHash})...`);
      dockerExec(
        `docker build --label "dockerfile.hash=${currentHash}" -t ${DEV_IMAGE} -f "${dockerfilePath}" "${dockerContext}"`,
        {
          stdio: "inherit",
          timeout: 300000, // 5 min
        },
      );
      return { built: true, image: DEV_IMAGE, hash: currentHash };
    } catch (error) {
      throw new Error(`Failed to build image: ${error.message}`);
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

    // Build env flags
    const envFlags = Object.entries(env)
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

      // Configure OpenCode for Ollama with high context
      this.configureOpenCodeOllama(containerName);

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
      // Ensure OpenCode is configured for Ollama on each start
      this.configureOpenCodeOllama(containerName);
      return true;
    } catch {
      return false;
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

  /**
   * Configure OpenCode inside the container for Ollama access with high context.
   * Creates ~/.config/opencode/opencode.json with Ollama provider pointing to host.
   * Also sets OLLAMA_NUM_CTX env var as fallback for direct ollama CLI usage.
   */
  configureOpenCodeOllama(containerName) {
    // OpenCode provider config for Ollama via OpenAI-compatible API
    // See: https://opencode.ai/docs/providers/
    const config = {
      "$schema": "https://opencode.ai/config.json",
      provider: {
        ollama: {
          npm: "@ai-sdk/openai-compatible",
          name: "Ollama (Local)",
          options: {
            baseURL: "http://host.docker.internal:11434/v1",
          },
          models: {
            "qwen2.5-coder:32b": { name: "Qwen 2.5 Coder 32B" },
            "qwen2.5-coder:14b": { name: "Qwen 2.5 Coder 14B" },
            "qwen2.5-coder:7b": { name: "Qwen 2.5 Coder 7B" },
            "deepseek-coder-v2:16b": { name: "DeepSeek Coder V2 16B" },
            "deepseek-coder-v2:lite": { name: "DeepSeek Coder V2 Lite" },
            "codellama:34b": { name: "Code Llama 34B" },
            "codellama:13b": { name: "Code Llama 13B" },
            "devstral:24b": { name: "Devstral 24B" },
            "llama3.3:70b": { name: "Llama 3.3 70B" },
            "llama3.1:8b": { name: "Llama 3.1 8B" },
            "mistral:7b": { name: "Mistral 7B" },
            "qwen3:14b": { name: "Qwen 3 14B" },
          },
        },
      },
    };
    const configJson = JSON.stringify(config, null, 2).replace(/"/g, '\\"');
    try {
      // Create OpenCode config
      this.execInContainer(
        containerName,
        `mkdir -p ~/.config/opencode && echo "${configJson}" > ~/.config/opencode/opencode.json`,
        { timeout: 5000 },
      );
      // Also add OLLAMA_NUM_CTX to bashrc for direct ollama CLI calls
      this.execInContainer(
        containerName,
        `grep -q OLLAMA_NUM_CTX ~/.bashrc 2>/dev/null || echo 'export OLLAMA_NUM_CTX=32768' >> ~/.bashrc`,
        { timeout: 5000 },
      );
      console.log(`[containerManager] Configured OpenCode for Ollama in ${containerName}`);
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
