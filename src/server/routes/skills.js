import express from "express";
import { skillManager } from "../skillManager.js";

const router = express.Router();

// GET /api/skills -- List all available skills (built-in + installed)
router.get("/", async (req, res) => {
  try {
    const skills = skillManager.getAll();
    res.json(skills);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to fetch skills", message: error.message });
  }
});

// GET /api/skills/project/:projectId -- Get active skills for a project
// NOTE: This must be defined BEFORE /:id to avoid "project" being captured as an id
router.get("/project/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;
    const activeSkills = skillManager.getActiveSkills(projectId);
    res.json(activeSkills);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch active skills",
      message: error.message,
    });
  }
});

// POST /api/skills/project/:projectId/activate -- Activate a skill for a project
router.post("/project/:projectId/activate", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { skillId } = req.body;

    if (!skillId) {
      return res.status(400).json({ error: "skillId is required" });
    }

    const project = await skillManager.activateForProject(projectId, skillId);
    res.json({ message: "Skill activated", project });
  } catch (error) {
    if (error.message.includes("not found")) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({
      error: "Failed to activate skill",
      message: error.message,
    });
  }
});

// POST /api/skills/project/:projectId/deactivate -- Deactivate a skill for a project
router.post("/project/:projectId/deactivate", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { skillId } = req.body;

    if (!skillId) {
      return res.status(400).json({ error: "skillId is required" });
    }

    const project = await skillManager.deactivateForProject(
      projectId,
      skillId,
    );
    res.json({ message: "Skill deactivated", project });
  } catch (error) {
    if (error.message.includes("not found")) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({
      error: "Failed to deactivate skill",
      message: error.message,
    });
  }
});

// GET /api/skills/project/:projectId/context -- Get built skill context string
router.get("/project/:projectId/context", async (req, res) => {
  try {
    const { projectId } = req.params;
    const context = skillManager.buildSkillContext(projectId);
    res.json({ context });
  } catch (error) {
    res.status(500).json({
      error: "Failed to build skill context",
      message: error.message,
    });
  }
});

// GET /api/skills/project/:projectId/templates -- Get prompt templates from active skills
router.get("/project/:projectId/templates", async (req, res) => {
  try {
    const { projectId } = req.params;
    const templates = skillManager.getSkillPromptTemplates(projectId);
    res.json(templates);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch skill templates",
      message: error.message,
    });
  }
});

// GET /api/skills/project/:projectId/commands -- Get quick commands from active skills
router.get("/project/:projectId/commands", async (req, res) => {
  try {
    const { projectId } = req.params;
    const commands = skillManager.getSkillQuickCommands(projectId);
    res.json(commands);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch skill commands",
      message: error.message,
    });
  }
});

// POST /api/skills/install -- Install a skill from JSON body
router.post("/install", async (req, res) => {
  try {
    const skillData = req.body;
    if (!skillData || typeof skillData !== "object") {
      return res
        .status(400)
        .json({ error: "Request body must be a valid skill JSON object" });
    }

    const skill = await skillManager.install(skillData);
    res.status(201).json(skill);
  } catch (error) {
    res.status(400).json({
      error: "Failed to install skill",
      message: error.message,
    });
  }
});

// POST /api/skills/install-url -- Install a skill from URL
router.post("/install-url", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "url is required in request body" });
    }

    const skill = await skillManager.installFromUrl(url);
    res.status(201).json(skill);
  } catch (error) {
    res.status(400).json({
      error: "Failed to install skill from URL",
      message: error.message,
    });
  }
});

// GET /api/skills/:id -- Get single skill details
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const skill = skillManager.get(id);
    if (!skill) {
      return res.status(404).json({ error: "Skill not found" });
    }
    res.json(skill);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to fetch skill", message: error.message });
  }
});

// DELETE /api/skills/:id -- Uninstall a user-installed skill (not built-in)
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await skillManager.uninstall(id);
    res.json({ message: "Skill uninstalled" });
  } catch (error) {
    if (error.message.includes("Cannot uninstall built-in")) {
      return res.status(403).json({ error: error.message });
    }
    if (error.message.includes("not found")) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({
      error: "Failed to uninstall skill",
      message: error.message,
    });
  }
});

export default router;
