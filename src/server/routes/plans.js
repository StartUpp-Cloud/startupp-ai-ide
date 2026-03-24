import express from 'express';
import Plan from '../models/Plan.js';

const router = express.Router();

/**
 * GET /api/plans - Get all active plans
 */
router.get('/', (req, res) => {
  try {
    const plans = Plan.getActivePlans();
    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch plans', message: error.message });
  }
});

/**
 * GET /api/plans/project/:projectId - Get plans for a project
 */
router.get('/project/:projectId', (req, res) => {
  try {
    const { projectId } = req.params;
    const plans = Plan.getPlansByProject(projectId);
    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch project plans', message: error.message });
  }
});

/**
 * GET /api/plans/session/:sessionId - Get plans for a session
 */
router.get('/session/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const plans = Plan.getPlansBySession(sessionId);
    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch session plans', message: error.message });
  }
});

/**
 * GET /api/plans/:id - Get plan by ID
 */
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const plan = Plan.getPlanById(id);

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch plan', message: error.message });
  }
});

/**
 * POST /api/plans - Create new plan
 */
router.post('/', async (req, res) => {
  try {
    const { projectId, sessionId, title, description, items } = req.body;

    const plan = await Plan.createPlan({
      projectId,
      sessionId,
      title,
      description,
      items,
    });

    res.status(201).json(plan);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create plan', message: error.message });
  }
});

/**
 * POST /api/plans/extract - Extract plans from text
 */
router.post('/extract', async (req, res) => {
  try {
    const { text, projectId, sessionId, save = false } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const extractedPlans = Plan.extractPlansFromText(text, { projectId, sessionId });

    if (save && extractedPlans.length > 0) {
      const savedPlans = [];
      for (const planData of extractedPlans) {
        const plan = await Plan.createPlan(planData);
        savedPlans.push(plan);
      }
      res.status(201).json(savedPlans);
    } else {
      res.json(extractedPlans);
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to extract plans', message: error.message });
  }
});

/**
 * POST /api/plans/:id/items - Add item to plan
 */
router.post('/:id/items', async (req, res) => {
  try {
    const { id } = req.params;
    const { description, status, priority, notes } = req.body;

    if (!description) {
      return res.status(400).json({ error: 'description is required' });
    }

    const item = await Plan.addPlanItem(id, {
      description,
      status,
      priority,
      notes,
    });

    if (!item) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add item', message: error.message });
  }
});

/**
 * PATCH /api/plans/:id - Update plan
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const plan = await Plan.updatePlan(id, updates);

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update plan', message: error.message });
  }
});

/**
 * PATCH /api/plans/:planId/items/:itemId - Update plan item
 */
router.patch('/:planId/items/:itemId', async (req, res) => {
  try {
    const { planId, itemId } = req.params;
    const updates = req.body;

    const item = await Plan.updatePlanItem(planId, itemId, updates);

    if (!item) {
      return res.status(404).json({ error: 'Plan or item not found' });
    }

    res.json(item);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update item', message: error.message });
  }
});

/**
 * DELETE /api/plans/:id - Delete plan
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Plan.deletePlan(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    res.json({ message: 'Plan deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete plan', message: error.message });
  }
});

export default router;
