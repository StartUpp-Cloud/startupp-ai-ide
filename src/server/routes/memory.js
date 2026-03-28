/**
 * Memory Store API Routes
 * Endpoints for managing per-project knowledge memories.
 */

import express from 'express';
import { memoryStore } from '../memoryStore.js';

const router = express.Router();

/**
 * GET /api/memory/:projectId - Get all memories for a project
 */
router.get('/:projectId', (req, res) => {
  try {
    const { projectId } = req.params;
    const memories = memoryStore.getAll(projectId);
    res.json(memories);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch memories', message: error.message });
  }
});

/**
 * POST /api/memory/:projectId - Manually add a memory
 */
router.post('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { type, category, content, tags } = req.body;

    if (!type || !category || !content) {
      return res.status(400).json({ error: 'type, category, and content are required' });
    }

    const memory = await memoryStore.learn(projectId, {
      type,
      category,
      content,
      source: 'user-correction',
      tags: tags || [],
    });

    if (!memory) {
      return res.json({ message: 'Duplicate memory detected; existing entry was reinforced' });
    }

    res.status(201).json(memory);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add memory', message: error.message });
  }
});

/**
 * POST /api/memory/:projectId/prune - Prune old, low-confidence memories
 */
router.post('/:projectId/prune', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { maxAgeDays, minConfidence } = req.body;

    const pruned = await memoryStore.prune(projectId, {
      maxAgeDays: maxAgeDays !== undefined ? maxAgeDays : 90,
      minConfidence: minConfidence !== undefined ? minConfidence : 0.2,
    });

    res.json({ pruned });
  } catch (error) {
    res.status(500).json({ error: 'Failed to prune memories', message: error.message });
  }
});

/**
 * DELETE /api/memory/:id - Delete a specific memory
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await memoryStore.remove(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    res.json({ message: 'Memory deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete memory', message: error.message });
  }
});

/**
 * GET /api/memory/:projectId/context - Get formatted LLM context string
 */
router.get('/:projectId/context', (req, res) => {
  try {
    const { projectId } = req.params;
    const context = memoryStore.buildContextForLLM(projectId);
    res.json({ context });
  } catch (error) {
    res.status(500).json({ error: 'Failed to build memory context', message: error.message });
  }
});

export default router;
