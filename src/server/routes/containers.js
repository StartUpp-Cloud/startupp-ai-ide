import { Router } from "express";
import { execSync } from "child_process";
import { containerManager } from "../containerManager.js";

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
        const images = execSync("docker images -q startupp-ai-ide-dev:latest", {
          encoding: "utf-8",
        }).trim();
        imageReady = images.length > 0;
      } catch {
        imageReady = false;
      }
    }

    res.json({ dockerAvailable, imageReady });
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

export default router;
