/**
 * LLM Provider API Routes
 * Endpoints for managing LLM settings and testing
 */

import express from 'express';
import { llmProvider } from '../llmProvider.js';

const router = express.Router();

/**
 * GET /api/llm/settings - Get LLM settings
 */
router.get('/settings', (req, res) => {
  try {
    const settings = llmProvider.getSettings();
    // Don't expose the full API key
    const safeSettings = {
      ...settings,
      openai: {
        ...settings.openai,
        apiKey: settings.openai.apiKey ? '***configured***' : '',
      },
      deepseek: {
        ...settings.deepseek,
        apiKey: settings.deepseek?.apiKey ? '***configured***' : '',
      },
    };
    res.json(safeSettings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get settings', message: error.message });
  }
});

/**
 * PUT /api/llm/settings - Update LLM settings
 */
router.put('/settings', async (req, res) => {
  try {
    const settings = await llmProvider.updateSettings(req.body);
    // Don't expose the full API key
    const safeSettings = {
      ...settings,
      openai: {
        ...settings.openai,
        apiKey: settings.openai.apiKey ? '***configured***' : '',
      },
      deepseek: {
        ...settings.deepseek,
        apiKey: settings.deepseek?.apiKey ? '***configured***' : '',
      },
    };
    res.json(safeSettings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings', message: error.message });
  }
});

/**
 * GET /api/llm/health - Check LLM provider health
 */
router.get('/health', async (req, res) => {
  try {
    const health = await llmProvider.checkHealth();
    res.json({
      ...health,
      provider: llmProvider.getSettings().provider,
      enabled: llmProvider.getSettings().enabled,
    });
  } catch (error) {
    res.status(500).json({ error: 'Health check failed', message: error.message });
  }
});

/**
 * POST /api/llm/test - Test LLM with a sample prompt
 */
router.post('/test', async (req, res) => {
  try {
    if (!llmProvider.getSettings().enabled) {
      return res.status(400).json({ error: 'LLM is not enabled' });
    }

    const result = await llmProvider.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Test failed', message: error.message });
  }
});

/**
 * POST /api/llm/generate - Generate a response using LLM
 */
router.post('/generate', async (req, res) => {
  try {
    const { prompt, context } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    if (!llmProvider.getSettings().enabled) {
      return res.status(400).json({ error: 'LLM is not enabled' });
    }

    const result = await llmProvider.generateResponse(prompt, context || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Generation failed', message: error.message });
  }
});

/**
 * GET /api/llm/ollama/models - List available Ollama models
 */
router.get('/ollama/models', async (req, res) => {
  try {
    const models = await llmProvider.getOllamaModels();
    res.json({ models });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list models', message: error.message });
  }
});

/**
 * POST /api/llm/ollama/pull - Pull a model in Ollama
 */
router.post('/ollama/pull', async (req, res) => {
  try {
    const { model } = req.body;

    if (!model) {
      return res.status(400).json({ error: 'model is required' });
    }

    const result = await llmProvider.pullOllamaModel(model);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to pull model', message: error.message });
  }
});

/**
 * PUT /api/llm/enable - Enable/disable LLM
 */
router.put('/enable', async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    const settings = await llmProvider.updateSettings({ enabled });
    res.json({ enabled: settings.enabled });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update', message: error.message });
  }
});

/**
 * PUT /api/llm/provider - Switch LLM provider
 */
router.put('/provider', async (req, res) => {
  try {
    const { provider } = req.body;

    if (!['ollama', 'openai', 'deepseek'].includes(provider)) {
      return res.status(400).json({ error: 'provider must be "ollama", "openai", or "deepseek"' });
    }

    const settings = await llmProvider.updateSettings({ provider });
    res.json({ provider: settings.provider });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update', message: error.message });
  }
});

/**
 * PUT /api/llm/ollama/config - Configure Ollama settings
 */
router.put('/ollama/config', async (req, res) => {
  try {
    const { endpoint, model, timeout } = req.body;

    const updates = {};
    if (endpoint) updates.endpoint = endpoint;
    if (model) updates.model = model;
    if (timeout) updates.timeout = timeout;

    const settings = await llmProvider.updateSettings({
      ollama: { ...llmProvider.getSettings().ollama, ...updates },
    });

    res.json(settings.ollama);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update', message: error.message });
  }
});

/**
 * PUT /api/llm/openai/config - Configure OpenAI settings
 */
router.put('/openai/config', async (req, res) => {
  try {
    const { endpoint, model, apiKey, timeout } = req.body;

    const updates = {};
    if (endpoint) updates.endpoint = endpoint;
    if (model) updates.model = model;
    if (apiKey) updates.apiKey = apiKey;
    if (timeout) updates.timeout = timeout;

    const settings = await llmProvider.updateSettings({
      openai: { ...llmProvider.getSettings().openai, ...updates },
    });

    // Don't expose the full API key
    res.json({
      ...settings.openai,
      apiKey: settings.openai.apiKey ? '***configured***' : '',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update', message: error.message });
  }
});

/**
 * PUT /api/llm/deepseek/config - Configure DeepSeek settings
 */
router.put('/deepseek/config', async (req, res) => {
  try {
    const { endpoint, model, apiKey, timeout } = req.body;

    const updates = {};
    if (endpoint) updates.endpoint = endpoint;
    if (model) updates.model = model;
    if (apiKey) updates.apiKey = apiKey;
    if (timeout) updates.timeout = timeout;

    const settings = await llmProvider.updateSettings({
      deepseek: { ...llmProvider.getSettings().deepseek, ...updates },
    });

    // Don't expose the full API key
    res.json({
      ...settings.deepseek,
      apiKey: settings.deepseek.apiKey ? '***configured***' : '',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update', message: error.message });
  }
});

export default router;
