import express from "express";
import Project from "../models/Project.js";
import { normalizePromptSettings } from "../models/Project.js";

const router = express.Router();

// GET /api/projects - Get all projects
router.get("/", async (req, res) => {
  try {
    const { search } = req.query;

    let projects;
    if (search) {
      projects = Project.search(search);
    } else {
      projects = Project.getAll();
    }

    res.json(projects);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to fetch projects", message: error.message });
  }
});

// GET /api/projects/:id - Get project by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Sync prompt count before returning to prevent drift
    await Project.recalculatePromptCount(id);

    const project = Project.findById(id);

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    res.json(project);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to fetch project", message: error.message });
  }
});

// POST /api/projects - Create new project
router.post("/", async (req, res) => {
  try {
    const { name, description, rules, selectedPresets, cloneFromId, promptSettings, folderPath } = req.body;

    // Handle project cloning
    if (cloneFromId) {
      const sourceProject = Project.findById(cloneFromId);
      if (!sourceProject) {
        return res.status(404).json({ error: "Source project not found" });
      }

      // Create cloned project with new name
      const clonedProject = await Project.create({
        name: name || `${sourceProject.name} (Copy)`,
        description: description || sourceProject.description,
        rules: sourceProject.rules,
        selectedPresets: sourceProject.selectedPresets || [],
        promptSettings: sourceProject.promptSettings,
        folderPath: folderPath || sourceProject.folderPath,
      });

      res.status(201).json(clonedProject);
      return;
    }

    // Regular project creation logic
    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Project name is required" });
    }

    if (!description || !description.trim()) {
      return res.status(400).json({ error: "Project description is required" });
    }

    // Filter out empty rules
    const validRules = Array.isArray(rules)
      ? rules.filter((rule) => rule && rule.trim())
      : [];

    // Validate selectedPresets
    const validPresets = Array.isArray(selectedPresets) ? selectedPresets : [];

    // Require either rules or presets
    if (validRules.length === 0 && validPresets.length === 0) {
      return res
        .status(400)
        .json({ error: "At least one rule or preset is required" });
    }

    // Check if project name already exists
    const existingProject = Project.findByName(name.trim());
    if (existingProject) {
      return res
        .status(400)
        .json({ error: "A project with this name already exists" });
    }

    const project = await Project.create({
      name: name.trim(),
      description: description.trim(),
      rules: validRules,
      selectedPresets: validPresets,
      promptSettings: normalizePromptSettings(promptSettings),
      folderPath: folderPath || null,
    });

    res.status(201).json(project);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to create project", message: error.message });
  }
});

// POST /api/projects/:id/clone - Clone specific project
router.post("/:id/clone", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const sourceProject = Project.findById(id);
    if (!sourceProject) {
      return res.status(404).json({ error: "Source project not found" });
    }

    // Generate default name if not provided
    const defaultName = `${sourceProject.name} (Copy)`;
    const projectName = name && name.trim() ? name.trim() : defaultName;

    // Check if the new name conflicts with existing projects
    const existingProject = Project.findByName(projectName);
    if (existingProject) {
      return res
        .status(400)
        .json({ error: "A project with this name already exists" });
    }

    // Create cloned project
    const clonedProject = await Project.create({
      name: projectName,
      description:
        description && description.trim()
          ? description.trim()
          : sourceProject.description,
      rules: sourceProject.rules,
      selectedPresets: sourceProject.selectedPresets || [],
      promptSettings: sourceProject.promptSettings,
    });

    res.status(201).json(clonedProject);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to clone project", message: error.message });
  }
});

// PUT /api/projects/:id - Update project
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, rules, selectedPresets, promptSettings, folderPath } = req.body;

    const project = Project.findById(id);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const updates = {};

    // Validation
    if (name !== undefined) {
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Project name cannot be empty" });
      }

      // Check if new name conflicts with existing project
      const existingProject = Project.findByName(name.trim());
      if (existingProject && existingProject.id !== id) {
        return res
          .status(400)
          .json({ error: "A project with this name already exists" });
      }

      updates.name = name.trim();
    }

    if (description !== undefined) {
      if (!description || !description.trim()) {
        return res
          .status(400)
          .json({ error: "Project description cannot be empty" });
      }
      updates.description = description.trim();
    }

    if (rules !== undefined) {
      const validRules = Array.isArray(rules)
        ? rules.filter((rule) => rule && rule.trim()).map((r) => r.trim())
        : [];
      updates.rules = validRules;
    }

    if (selectedPresets !== undefined) {
      updates.selectedPresets = Array.isArray(selectedPresets) ? selectedPresets : [];
    }

    // Validate that at least rules or presets exist after update
    const finalRules = updates.rules !== undefined ? updates.rules : project.rules || [];
    const finalPresets = updates.selectedPresets !== undefined ? updates.selectedPresets : project.selectedPresets || [];
    if (finalRules.length === 0 && finalPresets.length === 0) {
      return res
        .status(400)
        .json({ error: "At least one rule or preset is required" });
    }

    if (promptSettings !== undefined) {
      updates.promptSettings = normalizePromptSettings(promptSettings);
    }

    // Handle folder path updates (allow null to clear)
    if (folderPath !== undefined) {
      updates.folderPath = folderPath || null;
    }

    const updatedProject = await Project.update(id, updates);
    res.json(updatedProject);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to update project", message: error.message });
  }
});

// DELETE /api/projects/:id - Delete project
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const project = Project.findById(id);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    await Project.delete(id);
    res.json({ message: "Project deleted successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to delete project", message: error.message });
  }
});

export default router;
