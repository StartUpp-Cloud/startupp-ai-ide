import express from "express";
import GlobalRule from "../models/GlobalRule.js";

const router = express.Router();

// GET /api/global-rules
router.get("/", async (req, res) => {
  try {
    res.json(GlobalRule.getAll());
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to fetch global rules", message: error.message });
  }
});

// POST /api/global-rules
router.post("/", async (req, res) => {
  try {
    const { text, enabled } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Rule text is required" });
    }
    if (text.trim().length > 2000) {
      return res
        .status(400)
        .json({ error: "Rule text cannot exceed 2000 characters" });
    }
    const rule = await GlobalRule.create({
      text: text.trim(),
      enabled: enabled !== false,
    });
    res.status(201).json(rule);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to create global rule", message: error.message });
  }
});

// PUT /api/global-rules/:id
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const rule = GlobalRule.findById(id);
    if (!rule) return res.status(404).json({ error: "Global rule not found" });

    const { text, enabled } = req.body;
    const updates = {};
    if (text !== undefined) {
      if (!text.trim())
        return res.status(400).json({ error: "Rule text cannot be empty" });
      updates.text = text.trim();
    }
    if (enabled !== undefined) {
      updates.enabled = Boolean(enabled);
    }

    const updated = await GlobalRule.update(id, updates);
    res.json(updated);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to update global rule", message: error.message });
  }
});

// DELETE /api/global-rules/:id
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const rule = GlobalRule.findById(id);
    if (!rule) return res.status(404).json({ error: "Global rule not found" });
    await GlobalRule.delete(id);
    res.json({ message: "Global rule deleted" });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to delete global rule", message: error.message });
  }
});

export default router;
