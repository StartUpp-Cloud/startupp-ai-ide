/**
 * LLM Provider API Routes
 * Endpoints for managing LLM settings and testing
 */

import express from 'express';
import { llmProvider } from '../llmProvider.js';
import Project from '../models/Project.js';
import { skillManager } from '../skillManager.js';

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

/**
 * POST /api/llm/generate-prompt - AI-assisted prompt generation
 * Takes a project + user description, returns a well-crafted prompt for a CLI agent
 */
router.post('/generate-prompt', async (req, res) => {
  try {
    const { projectId, description, targetCLI } = req.body;

    if (!description?.trim()) {
      return res.status(400).json({ error: 'description is required' });
    }

    if (!llmProvider.getSettings().enabled) {
      return res.status(400).json({ error: 'LLM is not enabled. Enable it in LLM Settings.' });
    }

    // Build project context + skill context
    let projectContext = '';
    let skillContext = '';
    if (projectId) {
      const project = Project.findById(projectId);
      if (project) {
        projectContext = `\n## Project: ${project.name}\nDescription: ${project.description}`;
        if (project.rules?.length > 0) {
          projectContext += `\n\nProject Rules:\n${project.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
        }
        if (project.folderPath) {
          projectContext += `\nWorkspace: ${project.folderPath}`;
        }
      }
      // Inject active skill rules and conventions
      skillContext = skillManager.buildSkillContext(projectId);
    }

    const cli = targetCLI || 'claude';

    const systemPrompt = `You are an expert prompt engineer. Your job is to take a developer's brief description of what they want to accomplish and turn it into a clear, detailed, actionable prompt that will be sent to an AI coding assistant (${cli}).

## Output Rules
- Write ONLY the prompt text. No explanations, no preamble, no markdown wrapping.
- Do NOT wrap your response in thinking tags or reasoning blocks. Output the prompt directly.
- The prompt should be comprehensive but concise — aim for 200-500 words max.
- Include specific file paths, function names, or patterns when relevant to the project.
- Reference the project rules AND any active skill rules so the AI assistant follows them.
- Be explicit about what the expected outcome should be.
- Structure the prompt with clear sections if the task has multiple parts.
${projectContext}${skillContext ? `\n${skillContext}` : ''}`;

    const result = await llmProvider.generateResponse(description, {
      systemPrompt,
      maxTokens: 8192,
      temperature: 0.4,
    });

    // Strip any <think>...</think> blocks from models that use internal reasoning
    const cleanedPrompt = result.response.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    res.json({
      prompt: cleanedPrompt,
      provider: result.provider,
      model: result.model,
    });
  } catch (error) {
    res.status(500).json({ error: 'Prompt generation failed', message: error.message });
  }
});

/**
 * POST /api/llm/generate-plan - AI-assisted plan generation
 * Takes a project + goal, returns a multi-step plan with individual prompts
 */
router.post('/generate-plan', async (req, res) => {
  try {
    const { projectId, goal, targetCLI } = req.body;

    if (!goal?.trim()) {
      return res.status(400).json({ error: 'goal is required' });
    }

    if (!llmProvider.getSettings().enabled) {
      return res.status(400).json({ error: 'LLM is not enabled. Enable it in LLM Settings.' });
    }

    // Build project context + skill context
    let projectContext = '';
    let skillContext = '';
    if (projectId) {
      const project = Project.findById(projectId);
      if (project) {
        projectContext = `\n## Project: ${project.name}\nDescription: ${project.description}`;
        if (project.rules?.length > 0) {
          projectContext += `\n\nProject Rules:\n${project.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
        }
        if (project.folderPath) {
          projectContext += `\nWorkspace: ${project.folderPath}`;
        }
      }
      skillContext = skillManager.buildSkillContext(projectId);
    }

    const cli = targetCLI || 'claude';

    const systemPrompt = `You are an expert project planner and prompt engineer. The developer has a goal they want to achieve. Break it down into sequential steps, where each step is an independent prompt that will be sent to an AI coding assistant (${cli}).

## Output Format
Respond with valid JSON only. No markdown, no wrapping, no thinking tags. Output the JSON directly. The format:
{
  "title": "Short plan title",
  "steps": [
    {
      "title": "Brief step name",
      "prompt": "The full prompt to send to the AI assistant for this step",
      "requiresApproval": false
    }
  ]
}

## Planning Rules
- Each step should be self-contained and achievable in one AI session interaction.
- Order steps logically — later steps can depend on earlier ones.
- Set "requiresApproval": true for steps that involve destructive operations, deployments, or major architectural changes.
- Keep prompts focused — one clear task per step. Each prompt should be 100-300 words.
- Include context from previous steps in later prompts when needed (e.g., "In the previous step we created X, now...").
- Reference project rules so the AI assistant follows them.
- Aim for 3-8 steps. Split large tasks, but don't over-fragment.
${projectContext}${skillContext ? `\n${skillContext}` : ''}`;

    const result = await llmProvider.generateResponse(goal, {
      systemPrompt,
      maxTokens: 8192,
      temperature: 0.4,
    });

    // Strip <think>...</think> blocks from models that use internal reasoning
    const cleanedResponse = result.response.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    // Parse JSON from response
    let plan;
    try {
      // Try to extract JSON if wrapped in markdown or extra text
      let jsonStr = cleanedResponse;
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];
      plan = JSON.parse(jsonStr);
    } catch {
      return res.status(500).json({
        error: 'Failed to parse plan from LLM response',
        raw: result.response,
      });
    }

    res.json({
      plan,
      provider: result.provider,
      model: result.model,
    });
  } catch (error) {
    res.status(500).json({ error: 'Plan generation failed', message: error.message });
  }
});

/**
 * POST /api/llm/analyze-terminal-output
 * LLM analyzes terminal output and returns a structured checklist of actions/outcomes.
 */
router.post('/analyze-terminal-output', async (req, res) => {
  try {
    const { projectId, output, previousItems } = req.body;

    if (!output || typeof output !== 'string' || output.trim().length < 10) {
      return res.status(400).json({ error: 'Insufficient terminal output to analyze' });
    }

    if (!llmProvider.getSettings().enabled) {
      return res.status(400).json({ error: 'LLM is not enabled. Enable it in LLM Settings.' });
    }

    // Build context about previous items so the LLM can update statuses
    let previousContext = '';
    if (previousItems && Array.isArray(previousItems) && previousItems.length > 0) {
      previousContext = `\n\nPrevious checklist items (update statuses if relevant):\n${JSON.stringify(previousItems)}`;
    }

    const systemPrompt = `You analyze terminal output from a development session and produce a JSON checklist.
Given the terminal output, identify what actions were performed and their outcomes.

Return ONLY a valid JSON array. Each item:
{"text": "brief description", "status": "completed|in-progress|error|warning|info"}

Rules:
- "completed": action finished successfully (file created, test passed, build succeeded, install completed)
- "error": something failed (test failed, build error, crash, command not found)
- "warning": something concerning (deprecation, security warning, high memory usage)
- "in-progress": action appears to still be running (watching, waiting, server listening)
- "info": informational note (dependency installed, config changed, version number)
- Keep items concise (10-20 words max)
- Maximum 15 items (summarize if more)
- If previous items are provided, update their statuses and add new ones
- Focus on the most important/recent events
- Do NOT include the raw terminal output in your response${previousContext}`;

    const result = await llmProvider.generateResponse(output.trim(), {
      systemPrompt,
      maxTokens: 2048,
      temperature: 0.2,
    });

    // Strip <think>...</think> blocks from models that use internal reasoning
    const cleanedResponse = result.response.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    // Parse the JSON array from the response
    let items;
    try {
      let jsonStr = cleanedResponse;
      // Try to extract JSON array if wrapped in markdown or extra text
      const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (arrayMatch) jsonStr = arrayMatch[0];
      items = JSON.parse(jsonStr);

      // Validate the items
      if (!Array.isArray(items)) {
        throw new Error('Response is not an array');
      }

      // Sanitize and validate each item
      const validStatuses = ['completed', 'in-progress', 'error', 'warning', 'info'];
      items = items
        .filter((item) => item && typeof item.text === 'string' && item.text.trim())
        .map((item) => ({
          text: item.text.trim().slice(0, 200),
          status: validStatuses.includes(item.status) ? item.status : 'info',
        }))
        .slice(0, 15);
    } catch {
      return res.status(500).json({
        error: 'Failed to parse analysis from LLM response',
        raw: cleanedResponse.slice(0, 500),
      });
    }

    res.json({
      items,
      provider: result.provider,
      model: result.model,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Terminal analysis failed',
      message: error.message,
    });
  }
});

export default router;
