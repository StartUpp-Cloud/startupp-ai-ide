import { v4 as uuidv4 } from "uuid";
import db from "../db.js";
import {
  findProjectById,
  incrementPromptCount,
  decrementPromptCount,
} from "./Project.js";

export const PROMPT_TYPE_LABELS = {
  requirement: "Requirement Analysis",
  fix: "Bug Fix",
  feature: "Feature Implementation",
  review: "Code Review",
  optimization: "Performance Optimization",
  testing: "Testing Strategy",
  documentation: "Documentation",
  custom: "Custom Prompt",
};

const DEFAULT_PROMPT_STRUCTURE = ["projectDetails", "rules", "context"];

const LEGACY_TO_GROUPED_SECTION = {
  projectName: "projectDetails",
  projectDescription: "projectDetails",
  projectRules: "rules",
  promptTemplate: "context",
  additionalContext: "context",
  userPrompt: "context",
};

// Prompt helper functions for LowDB

export function findPromptById(id) {
  return db.data.prompts.find((p) => p.id === id);
}

export function findPromptsByProjectId(projectId) {
  return db.data.prompts
    .filter((p) => p.projectId === projectId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function findPromptsWithPagination(
  projectId,
  page = 1,
  limit = 10,
  search = "",
) {
  let prompts = db.data.prompts.filter((p) => p.projectId === projectId);

  // Apply search filter
  if (search) {
    const term = search.toLowerCase();
    prompts = prompts.filter((p) => p.text.toLowerCase().includes(term));
  }

  // Sort by creation date (newest first)
  prompts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = prompts.length;
  const totalPages = Math.ceil(total / limit);
  const skip = (page - 1) * limit;
  const paginatedPrompts = prompts.slice(skip, skip + limit);

  return {
    prompts: paginatedPrompts,
    total,
    totalPages,
    currentPage: page,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

export async function createPrompt({ text, projectId, promptType }) {
  const now = new Date().toISOString();
  const prompt = {
    id: uuidv4(),
    text: text.trim(),
    projectId,
    promptType: promptType || null,
    createdAt: now,
    updatedAt: now,
  };

  db.data.prompts.push(prompt);
  await db.write();

  // Update project prompt count
  await incrementPromptCount(projectId);

  return prompt;
}

export async function updatePrompt(id, updates) {
  const index = db.data.prompts.findIndex((p) => p.id === id);
  if (index === -1) return null;

  const prompt = db.data.prompts[index];
  const updatedPrompt = {
    ...prompt,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  db.data.prompts[index] = updatedPrompt;
  await db.write();
  return updatedPrompt;
}

export async function deletePrompt(id) {
  const index = db.data.prompts.findIndex((p) => p.id === id);
  if (index === -1) return false;

  const prompt = db.data.prompts[index];
  const projectId = prompt.projectId;

  db.data.prompts.splice(index, 1);
  await db.write();

  // Update project prompt count
  await decrementPromptCount(projectId);

  return true;
}

export function getFullPrompt(promptId) {
  const prompt = findPromptById(promptId);
  if (!prompt) return null;

  const project = findProjectById(prompt.projectId);
  if (!project) return prompt.text;

  const structure = Array.isArray(project.promptSettings?.promptStructure)
    ? project.promptSettings.promptStructure.map(
        (section) => LEGACY_TO_GROUPED_SECTION[section] || section,
      )
    : DEFAULT_PROMPT_STRUCTURE;

  const disabledIndices = project.promptSettings?.disabledRuleIndices || [];

  // Build rules list: include global rules first (if enabled), then project rules (filtered by disabled)
  const projectRules = (project.rules || []).filter(
    (_, i) => !disabledIndices.includes(i),
  );

  const globalRules = project.promptSettings?.includeGlobalRules
    ? (db.data.globalRules || [])
        .filter((r) => r.enabled !== false)
        .map((r) => r.text)
    : [];

  const allRules = [...globalRules, ...projectRules];

  const sections = {
    projectDetails:
      project.name || project.description
        ? `Project: ${project.name}\nDescription: ${project.description}`
        : "",
    rules:
      allRules.length > 0
        ? `Rules:\n${allRules.map((rule, index) => `${index + 1}. ${rule}`).join("\n")}`
        : "",
    context: `User Prompt: ${prompt.text}`,
  };

  return structure
    .map((key) => sections[key])
    .filter(Boolean)
    .join("\n\n");
}

export default {
  findById: findPromptById,
  findByProjectId: findPromptsByProjectId,
  findWithPagination: findPromptsWithPagination,
  create: createPrompt,
  update: updatePrompt,
  delete: deletePrompt,
  getFullPrompt,
};
