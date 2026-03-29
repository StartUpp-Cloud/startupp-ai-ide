import express from "express";
import { v4 as uuidv4 } from "uuid";
import Project from "../models/Project.js";
import { ptyManager } from "../ptyManager.js";

const router = express.Router({ mergeParams: true });

// GET /api/projects/:projectId/quick-commands - Get all quick commands
router.get("/", async (req, res) => {
  try {
    const { projectId } = req.params;

    const project = Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    res.json(project.quickCommands || []);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch quick commands",
      message: error.message,
    });
  }
});

// POST /api/projects/:projectId/quick-commands - Add a quick command
router.post("/", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { name, command, icon, color } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Command name is required" });
    }

    if (!command || !command.trim()) {
      return res.status(400).json({ error: "Command string is required" });
    }

    const project = Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const quickCommand = {
      id: uuidv4(),
      name: name.trim(),
      command: command.trim(),
      icon: icon || null,
      color: color || null,
      createdAt: new Date().toISOString(),
    };

    const quickCommands = [...(project.quickCommands || []), quickCommand];
    await Project.update(projectId, { quickCommands });

    res.status(201).json(quickCommand);
  } catch (error) {
    res.status(500).json({
      error: "Failed to create quick command",
      message: error.message,
    });
  }
});

// PUT /api/projects/:projectId/quick-commands/:commandId - Update a quick command
router.put("/:commandId", async (req, res) => {
  try {
    const { projectId, commandId } = req.params;
    const { name, command, icon, color } = req.body;

    const project = Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const quickCommands = project.quickCommands || [];
    const index = quickCommands.findIndex((cmd) => cmd.id === commandId);
    if (index === -1) {
      return res.status(404).json({ error: "Quick command not found" });
    }

    const existing = quickCommands[index];
    const updated = {
      ...existing,
      ...(name !== undefined && { name: name.trim() }),
      ...(command !== undefined && { command: command.trim() }),
      ...(icon !== undefined && { icon: icon || null }),
      ...(color !== undefined && { color: color || null }),
      updatedAt: new Date().toISOString(),
    };

    // Validate required fields after merge
    if (!updated.name) {
      return res.status(400).json({ error: "Command name cannot be empty" });
    }
    if (!updated.command) {
      return res.status(400).json({ error: "Command string cannot be empty" });
    }

    quickCommands[index] = updated;
    await Project.update(projectId, { quickCommands });

    res.json(updated);
  } catch (error) {
    res.status(500).json({
      error: "Failed to update quick command",
      message: error.message,
    });
  }
});

// DELETE /api/projects/:projectId/quick-commands/:commandId - Delete a quick command
router.delete("/:commandId", async (req, res) => {
  try {
    const { projectId, commandId } = req.params;

    const project = Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const quickCommands = project.quickCommands || [];
    const index = quickCommands.findIndex((cmd) => cmd.id === commandId);
    if (index === -1) {
      return res.status(404).json({ error: "Quick command not found" });
    }

    quickCommands.splice(index, 1);
    await Project.update(projectId, { quickCommands });

    res.json({ message: "Quick command deleted successfully" });
  } catch (error) {
    res.status(500).json({
      error: "Failed to delete quick command",
      message: error.message,
    });
  }
});

// POST /api/projects/:projectId/quick-commands/:commandId/run - Execute a quick command
router.post("/:commandId/run", async (req, res) => {
  try {
    const { projectId, commandId } = req.params;
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    const project = Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const quickCommands = project.quickCommands || [];
    const quickCommand = quickCommands.find((cmd) => cmd.id === commandId);
    if (!quickCommand) {
      return res.status(404).json({ error: "Quick command not found" });
    }

    const session = ptyManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.status !== "active") {
      return res.status(400).json({ error: "Session is not active" });
    }

    const written = ptyManager.write(sessionId, quickCommand.command + "\n");
    if (!written) {
      return res
        .status(500)
        .json({ error: "Failed to write command to session" });
    }

    res.json({
      message: "Command executed",
      command: quickCommand.command,
      sessionId,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to execute quick command",
      message: error.message,
    });
  }
});

export default router;
