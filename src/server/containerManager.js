import { execSync } from "child_process";
import { EventEmitter } from "events";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEV_IMAGE = "startupp-ai-ide-dev:latest";
const CONTAINER_PREFIX = "sai-";

class ContainerManager extends EventEmitter {
  constructor() {
    super();
  }

  /**
   * Check if Docker is available
   */
  isDockerAvailable() {
    try {
      execSync("docker info", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Build the dev container image (if not already built)
   */
  async buildImage() {
    try {
      // Check if image exists
      const images = execSync(`docker images -q ${DEV_IMAGE}`, {
        encoding: "utf-8",
      }).trim();
      if (images) return { exists: true, image: DEV_IMAGE };

      // Build from Dockerfile
      const dockerfilePath = path.join(__dirname, "../../docker/Dockerfile.dev");
      execSync(
        `docker build -t ${DEV_IMAGE} -f "${dockerfilePath}" "${path.join(__dirname, "../../docker")}"`,
        {
          stdio: "inherit",
          timeout: 300000, // 5 min
        },
      );
      return { built: true, image: DEV_IMAGE };
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
  async createContainer({ projectId, name, gitUrl, env = {}, ports = [] }) {
    const containerName = `${CONTAINER_PREFIX}${name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .slice(0, 30)}-${projectId.slice(0, 8)}`;

    // Check if container already exists
    try {
      const existing = execSync(
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
      execSync(cmd, { encoding: "utf-8", stdio: "pipe" });

      // Start the container
      execSync(`docker start ${containerName}`, {
        encoding: "utf-8",
        stdio: "pipe",
      });

      // Clone the repo if gitUrl provided
      if (gitUrl) {
        try {
          execSync(
            `docker exec ${containerName} git clone "${gitUrl}" /workspace/repo`,
            {
              encoding: "utf-8",
              stdio: "pipe",
              timeout: 120000,
            },
          );
        } catch {
          // Repo might already be cloned in the volume, or clone failed
          // Try pulling instead
          try {
            execSync(
              `docker exec ${containerName} bash -c "cd /workspace/repo && git pull"`,
              {
                encoding: "utf-8",
                stdio: "pipe",
                timeout: 30000,
              },
            );
          } catch {
            /* ignore - user can handle this in the terminal */
          }
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
      execSync(`docker start ${containerName}`, {
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
      execSync(`docker stop ${containerName}`, {
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
      execSync(`docker rm -f ${containerName}`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
      // Also remove volumes
      try {
        execSync(
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
      const status = execSync(
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
      const output = execSync(
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
      return execSync(
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
    const hasRepo = this.execInContainer(
      containerName,
      "test -d /workspace/repo && echo yes",
    );
    return hasRepo === "yes" ? "/workspace/repo" : "/workspace";
  }
}

export const containerManager = new ContainerManager();
export default containerManager;
