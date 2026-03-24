// AI Model definitions with optimization settings
// Each model has specific formatting preferences and best practices

export const AI_MODELS = [
  {
    id: "claude",
    name: "Claude (Anthropic)",
    provider: "Anthropic",
    description: "Claude 3.5 Sonnet, Opus, Haiku",
    icon: "Brain",
    contextWindow: "200K tokens",
    formatting: {
      // Claude responds well to XML-style tags for structure
      useXmlTags: true,
      preferredStructure: "xml",
      codeBlockStyle: "markdown",
    },
    optimizations: [
      "Use XML tags like <context>, <rules>, <task> for clear structure",
      "Be direct and specific — Claude handles detailed instructions well",
      "For complex tasks, break into numbered steps",
      "Use examples wrapped in <example> tags when showing desired output",
      "Specify output format explicitly when needed",
    ],
    promptTemplate: {
      wrapSections: true,
      sectionTags: {
        projectDetails: "context",
        rules: "rules",
        context: "task",
      },
    },
  },
  {
    id: "gpt4",
    name: "GPT-4 / GPT-4o",
    provider: "OpenAI",
    description: "GPT-4, GPT-4 Turbo, GPT-4o",
    icon: "Sparkles",
    contextWindow: "128K tokens",
    formatting: {
      useXmlTags: false,
      preferredStructure: "markdown",
      codeBlockStyle: "markdown",
    },
    optimizations: [
      "Use markdown headers (##) to organize sections",
      "Be explicit about desired output format",
      "Use numbered lists for sequential instructions",
      "Provide examples of expected output when possible",
      "For JSON output, specify 'Respond only with valid JSON'",
    ],
    promptTemplate: {
      wrapSections: false,
      useHeaders: true,
      headerStyle: "markdown",
    },
  },
  {
    id: "gpt35",
    name: "GPT-3.5 Turbo",
    provider: "OpenAI",
    description: "Fast and cost-effective",
    icon: "Zap",
    contextWindow: "16K tokens",
    formatting: {
      useXmlTags: false,
      preferredStructure: "markdown",
      codeBlockStyle: "markdown",
    },
    optimizations: [
      "Keep prompts concise — smaller context window",
      "Use clear, simple language",
      "Break complex tasks into smaller, focused requests",
      "Provide explicit examples for complex outputs",
      "Avoid ambiguity — be very specific about requirements",
    ],
    promptTemplate: {
      wrapSections: false,
      useHeaders: true,
      headerStyle: "markdown",
      concise: true,
    },
  },
  {
    id: "gemini",
    name: "Gemini",
    provider: "Google",
    description: "Gemini Pro, Gemini Ultra",
    icon: "Star",
    contextWindow: "1M tokens",
    formatting: {
      useXmlTags: false,
      preferredStructure: "markdown",
      codeBlockStyle: "markdown",
    },
    optimizations: [
      "Use clear section headers for organization",
      "Gemini handles very long contexts well — include full context when helpful",
      "Be explicit about output format expectations",
      "Use bullet points for lists of requirements",
      "For code tasks, specify language and style preferences",
    ],
    promptTemplate: {
      wrapSections: false,
      useHeaders: true,
      headerStyle: "markdown",
    },
  },
  {
    id: "llama",
    name: "Llama 3",
    provider: "Meta",
    description: "Llama 3 70B, 8B variants",
    icon: "Cpu",
    contextWindow: "8K tokens",
    formatting: {
      useXmlTags: false,
      preferredStructure: "markdown",
      codeBlockStyle: "markdown",
    },
    optimizations: [
      "Keep prompts focused and concise",
      "Use clear markdown formatting",
      "Provide explicit examples for complex tasks",
      "Break multi-step tasks into clear numbered steps",
      "Be specific about output format requirements",
    ],
    promptTemplate: {
      wrapSections: false,
      useHeaders: true,
      headerStyle: "markdown",
      concise: true,
    },
  },
  {
    id: "mistral",
    name: "Mistral",
    provider: "Mistral AI",
    description: "Mistral Large, Medium, Small",
    icon: "Wind",
    contextWindow: "32K tokens",
    formatting: {
      useXmlTags: false,
      preferredStructure: "markdown",
      codeBlockStyle: "markdown",
    },
    optimizations: [
      "Use markdown for clear structure",
      "Be direct and specific with instructions",
      "Provide examples when output format matters",
      "Use numbered steps for sequential tasks",
      "Specify any constraints or limitations clearly",
    ],
    promptTemplate: {
      wrapSections: false,
      useHeaders: true,
      headerStyle: "markdown",
    },
  },
  {
    id: "generic",
    name: "Generic / Other",
    provider: "Any",
    description: "Works with any model",
    icon: "Bot",
    contextWindow: "Varies",
    formatting: {
      useXmlTags: false,
      preferredStructure: "markdown",
      codeBlockStyle: "markdown",
    },
    optimizations: [
      "Use clear, structured formatting",
      "Be explicit about expected output",
      "Provide examples when helpful",
      "Keep instructions clear and unambiguous",
    ],
    promptTemplate: {
      wrapSections: false,
      useHeaders: true,
      headerStyle: "markdown",
    },
  },
];

/**
 * Get model by ID
 */
export const getModel = (modelId) => {
  return AI_MODELS.find((m) => m.id === modelId) || AI_MODELS.find((m) => m.id === "generic");
};

/**
 * Get default model
 */
export const getDefaultModel = () => {
  return AI_MODELS.find((m) => m.id === "claude");
};

/**
 * Format prompt for specific model
 * @param {object} sections - { projectDetails, rules, context }
 * @param {string} modelId - Target model ID
 * @param {string[]} sectionOrder - Order of sections to include
 * @returns {string} Formatted prompt
 */
export const formatPromptForModel = (sections, modelId, sectionOrder = ["projectDetails", "rules", "context"]) => {
  const model = getModel(modelId);
  const template = model.promptTemplate;

  const formatSection = (key, content) => {
    if (!content) return "";

    if (template.wrapSections && template.sectionTags?.[key]) {
      const tag = template.sectionTags[key];
      return `<${tag}>\n${content}\n</${tag}>`;
    }

    if (template.useHeaders) {
      const headers = {
        projectDetails: "Project Context",
        rules: "Rules & Guidelines",
        context: "Task",
      };
      const header = headers[key] || key;
      return template.headerStyle === "markdown"
        ? `## ${header}\n\n${content}`
        : `${header}:\n${content}`;
    }

    return content;
  };

  const formattedSections = sectionOrder
    .map((key) => formatSection(key, sections[key]))
    .filter(Boolean);

  return formattedSections.join("\n\n");
};

/**
 * Get model-specific tips as a formatted string to append to prompts
 */
export const getModelTips = (modelId) => {
  const model = getModel(modelId);
  return model.optimizations;
};
