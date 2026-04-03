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
