import express from "express";
import Prompt from "../models/Prompt.js";
import Project from "../models/Project.js";

const router = express.Router();
const MAX_PROMPT_LENGTH = 20000;

// GET /api/projects/:projectId/prompts - Get prompts for a project with pagination and search
router.get("/:projectId/prompts", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { page = 1, limit = 10, search = "" } = req.query;

    // Verify project exists
    const project = Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Parse and validate pagination parameters
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({ error: "Invalid page number" });
    }

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res
        .status(400)
        .json({ error: "Invalid limit. Must be between 1 and 100" });
    }

    const result = Prompt.findWithPagination(
      projectId,
      pageNum,
      limitNum,
      search,
    );
    res.json(result);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to fetch prompts", message: error.message });
  }
});

// POST /api/projects/:projectId/prompts - Create new prompt for a project
router.post("/:projectId/prompts", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { text, promptType } = req.body;

    // Validation
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Prompt text is required" });
    }

    if (text.trim().length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({
        error: `Prompt text cannot exceed ${MAX_PROMPT_LENGTH} characters`,
      });
    }

    // Verify project exists
    const project = Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const validPromptTypes = [
      "requirement",
      "fix",
      "feature",
      "review",
      "optimization",
      "testing",
      "documentation",
      "custom",
    ];
    const sanitizedPromptType =
      promptType && validPromptTypes.includes(promptType) ? promptType : null;

    const prompt = await Prompt.create({
      text: text.trim(),
      projectId,
      promptType: sanitizedPromptType,
    });

    // Return prompt with project info
    res.status(201).json({
      ...prompt,
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        rules: project.rules,
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to create prompt", message: error.message });
  }
});

// GET /api/projects/:projectId/prompts/:promptId - Get specific prompt
router.get("/:projectId/prompts/:promptId", async (req, res) => {
  try {
    const { projectId, promptId } = req.params;

    // Verify project exists
    const project = Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const prompt = Prompt.findById(promptId);
    if (!prompt || prompt.projectId !== projectId) {
      return res.status(404).json({ error: "Prompt not found" });
    }

    res.json(prompt);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to fetch prompt", message: error.message });
  }
});

// PUT /api/projects/:projectId/prompts/:promptId - Update prompt
router.put("/:projectId/prompts/:promptId", async (req, res) => {
  try {
    const { projectId, promptId } = req.params;
    const { text } = req.body;

    // Validation
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Prompt text is required" });
    }

    if (text.trim().length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({
        error: `Prompt text cannot exceed ${MAX_PROMPT_LENGTH} characters`,
      });
    }

    // Verify project exists
    const project = Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const prompt = Prompt.findById(promptId);
    if (!prompt || prompt.projectId !== projectId) {
      return res.status(404).json({ error: "Prompt not found" });
    }

    const updatedPrompt = await Prompt.update(promptId, { text: text.trim() });
    res.json(updatedPrompt);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to update prompt", message: error.message });
  }
});

// DELETE /api/projects/:projectId/prompts/:promptId - Delete prompt
router.delete("/:projectId/prompts/:promptId", async (req, res) => {
  try {
    const { projectId, promptId } = req.params;

    // Verify project exists
    const project = Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const prompt = Prompt.findById(promptId);
    if (!prompt || prompt.projectId !== projectId) {
      return res.status(404).json({ error: "Prompt not found" });
    }

    await Prompt.delete(promptId);
    res.json({ message: "Prompt deleted successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to delete prompt", message: error.message });
  }
});

// GET /api/projects/:projectId/prompts/:promptId/full - Get full prompt with project context
router.get("/:projectId/prompts/:promptId/full", async (req, res) => {
  try {
    const { projectId, promptId } = req.params;

    // Verify project exists
    const project = Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const prompt = Prompt.findById(promptId);
    if (!prompt || prompt.projectId !== projectId) {
      return res.status(404).json({ error: "Prompt not found" });
    }

    const fullPrompt = Prompt.getFullPrompt(promptId);
    res.json({ fullPrompt, prompt, project });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to fetch full prompt", message: error.message });
  }
});

export default router;
