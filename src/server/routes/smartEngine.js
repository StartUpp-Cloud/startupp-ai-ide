/**
 * Smart Engine API Routes
 * Endpoints for testing and managing the NLP-based smart response engine
 */

import express from 'express';
import { smartEngine, INTENTS } from '../smartEngine.js';
import { autoResponder } from '../autoResponder.js';

const router = express.Router();

/**
 * POST /api/smart-engine/analyze - Analyze text with smart engine
 */
router.post('/analyze', (req, res) => {
  try {
    const { text, projectPath } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const result = smartEngine.analyze(text, { projectPath });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Analysis failed', message: error.message });
  }
});

/**
 * POST /api/smart-engine/classify - Classify intent only
 */
router.post('/classify', (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const result = smartEngine.classifyIntent(text);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Classification failed', message: error.message });
  }
});

/**
 * POST /api/smart-engine/parse - Parse question structure
 */
router.post('/parse', (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const result = smartEngine.parseQuestion(text);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Parsing failed', message: error.message });
  }
});

/**
 * POST /api/smart-engine/project-context - Analyze project context
 */
router.post('/project-context', (req, res) => {
  try {
    const { projectPath } = req.body;

    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    const result = smartEngine.analyzeProjectContext(projectPath);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Context analysis failed', message: error.message });
  }
});

/**
 * GET /api/smart-engine/intents - Get all available intents
 */
router.get('/intents', (req, res) => {
  res.json({
    intents: INTENTS,
    descriptions: {
      [INTENTS.APPROVAL]: 'Permission requests (Allow X?, Can I do Y?)',
      [INTENTS.CHOICE]: 'Choice questions (A or B?, Which one?)',
      [INTENTS.CONFIRMATION]: 'Simple confirmations (Continue?, Yes/No?)',
      [INTENTS.INFORMATION]: 'Information requests (What is X?, Where is Y?)',
      [INTENTS.CLARIFICATION]: 'Clarification requests (Did you mean X?)',
      [INTENTS.COMPLETION]: 'Task completion signals (Done!, Finished)',
      [INTENTS.ERROR]: 'Error situations (Failed, Error, Retry?)',
      [INTENTS.UNKNOWN]: 'Unclassified or ambiguous',
    },
  });
});

/**
 * GET /api/smart-engine/status - Get smart engine status
 */
router.get('/status', (req, res) => {
  res.json({
    enabled: autoResponder.isSmartEngineEnabled(),
    trained: smartEngine.trained,
  });
});

/**
 * PUT /api/smart-engine/enabled - Enable/disable smart engine
 */
router.put('/enabled', (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    autoResponder.setSmartEngineEnabled(enabled);
    res.json({ enabled: autoResponder.isSmartEngineEnabled() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update', message: error.message });
  }
});

/**
 * POST /api/smart-engine/test-batch - Test multiple prompts
 */
router.post('/test-batch', (req, res) => {
  try {
    const { prompts, projectPath } = req.body;

    if (!Array.isArray(prompts)) {
      return res.status(400).json({ error: 'prompts must be an array' });
    }

    const results = prompts.map((text) => ({
      text,
      analysis: smartEngine.analyze(text, { projectPath }),
    }));

    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: 'Batch test failed', message: error.message });
  }
});

export default router;
