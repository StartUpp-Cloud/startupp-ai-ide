import express from "express";
import { execFileSync } from "child_process";
import Project from "../models/Project.js";
import { normalizePromptSettings } from "../models/Project.js";
import { containerManager } from "../containerManager.js";
import { ptyManager } from "../ptyManager.js";

const router = express.Router();

function parseOpenCodeModels(raw, source) {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[a-z0-9][a-z0-9._-]*\/[\S]+$/i.test(line))
    .map((name) => ({ name, source }));
}

function getHostOpenCodeModels() {
  try {
    const raw = execFileSync("opencode", ["models"], {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 8000,
    });
    return parseOpenCodeModels(raw, "host");
  } catch {
    return [];
  }
}

function mergeModelsByName(...modelLists) {
  const seen = new Set();
  const merged = [];
  for (const models of modelLists) {
    for (const model of models) {
      if (!model?.name || seen.has(model.name)) continue;
      seen.add(model.name);
      merged.push(model);
    }
  }
  return merged;
}

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
    const { name, description, rules, selectedPresets, promptSettings, folderPath, containerName, gitUrl, repos, containerPorts, containerStatus } = req.body;

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

    // Only validate rules/presets when they're being explicitly updated
    if (rules !== undefined || selectedPresets !== undefined) {
      const finalRules = updates.rules !== undefined ? updates.rules : project.rules || [];
      const finalPresets = updates.selectedPresets !== undefined ? updates.selectedPresets : project.selectedPresets || [];
      if (finalRules.length === 0 && finalPresets.length === 0) {
        return res
          .status(400)
          .json({ error: "At least one rule or preset is required" });
      }
    }

    if (promptSettings !== undefined) {
      updates.promptSettings = normalizePromptSettings(promptSettings);
    }

    // Handle folder path updates (allow null to clear)
    if (folderPath !== undefined) updates.folderPath = folderPath || null;
    if (containerName !== undefined) updates.containerName = containerName || null;
    if (gitUrl !== undefined) updates.gitUrl = gitUrl || null;
    if (repos !== undefined) updates.repos = Array.isArray(repos) ? repos : [];
    if (containerPorts !== undefined) updates.containerPorts = Array.isArray(containerPorts) ? containerPorts : [];
    if (containerStatus !== undefined) updates.containerStatus = containerStatus || null;

    const updatedProject = await Project.update(id, updates);
    res.json(updatedProject);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to update project", message: error.message });
  }
});

// DELETE /api/projects/:id - Delete project
/**
 * GET /api/projects/:id/ollama-models
 * Returns merged Ollama model list from both the host and the project's container.
 * Installed models (reachable from both sides) are listed first, deduplicated.
 */
router.get("/:id/ollama-models", async (req, res) => {
  const { llmProvider } = await import('../llmProvider.js');

  const project = Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  // --- Query host Ollama ---
  let hostModels = [];
  try {
    hostModels = await llmProvider.getOllamaModels();
  } catch { /* host Ollama unreachable */ }

  // --- Query from inside the container ---
  let containerModels = [];
  if (project.containerName) {
    try {
      const status = containerManager.getContainerStatus(project.containerName);
      if (status === 'running') {
        // OLLAMA_HOST is set to host.docker.internal:11434 in every container
        const raw = containerManager.execInContainer(
          project.containerName,
          'curl -s --max-time 5 "$OLLAMA_HOST/api/tags" 2>/dev/null || curl -s --max-time 5 "http://host.docker.internal:11434/api/tags" 2>/dev/null',
          { timeout: 8000 },
        );
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.models)) containerModels = parsed.models;
        }
      }
    } catch { /* container query failed */ }
  }

  // Merge: prefer container-visible models (they confirm reachability from agent side)
  // Deduplicate by name, label source
  const seen = new Set();
  const merged = [];

  for (const m of containerModels) {
    if (!seen.has(m.name)) {
      seen.add(m.name);
      merged.push({ ...m, source: 'container' });
    }
  }
  for (const m of hostModels) {
    if (!seen.has(m.name)) {
      seen.add(m.name);
      merged.push({ ...m, source: 'host' });
    }
  }

  res.json({ models: merged, fromContainer: containerModels.length > 0, fromHost: hostModels.length > 0 });
});

/**
 * GET /api/projects/:id/opencode-models
 * Returns the model IDs reported by OpenCode itself, preferring the project
 * container because its config/auth determine which models are usable there.
 */
router.get("/:id/opencode-models", async (req, res) => {
  const project = Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  let containerModels = [];
  if (project.containerName) {
    try {
      const status = containerManager.getContainerStatus(project.containerName);
      if (status === 'running') {
        const raw = containerManager.execInContainer(
          project.containerName,
          'opencode models 2>/dev/null',
          { timeout: 10000 },
        );
        containerModels = parseOpenCodeModels(raw, 'container');
      }
    } catch { /* container query failed */ }
  }

  const hostModels = getHostOpenCodeModels();
  const models = mergeModelsByName(containerModels, hostModels);

  res.json({
    models,
    fromContainer: containerModels.length > 0,
    fromHost: hostModels.length > 0,
  });
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const project = Project.findById(id);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Kill any active PTY sessions for this project
    const activeSessions = ptyManager.getProjectSessions(id);
    for (const session of activeSessions) {
      if (session.status === 'active') {
        ptyManager.killSession(session.id);
      }
    }

    // Remove container and its volumes (workspace + home)
    if (project.containerName) {
      containerManager.removeContainer(project.containerName);
    }

    // Clean up chat history
    const { chatStore } = await import('../chatStore.js');
    chatStore.deleteProject(id);

    await Project.delete(id);
    res.json({ message: "Project deleted successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to delete project", message: error.message });
  }
});

export default router;
