import { v4 as uuidv4 } from "uuid";
import db from "../db.js";

// Project helper functions for LowDB

export const PROMPT_STRUCTURE_SECTIONS = ["projectDetails", "rules", "context"];

const LEGACY_TO_GROUPED_SECTION = {
  projectName: "projectDetails",
  projectDescription: "projectDetails",
  projectRules: "rules",
  promptTemplate: "context",
  additionalContext: "context",
  userPrompt: "context",
};

export function getDefaultPromptSettings() {
  return {
    autoSavePrompts: false,
    promptStructure: [...PROMPT_STRUCTURE_SECTIONS],
    disabledRuleIndices: [],
    includeGlobalRules: false,
  };
}

export function normalizePromptSettings(input) {
  const defaults = getDefaultPromptSettings();
  const settings = input || {};

  const providedOrder = Array.isArray(settings.promptStructure)
    ? settings.promptStructure
        .map((section) => LEGACY_TO_GROUPED_SECTION[section] || section)
        .filter((section) => PROMPT_STRUCTURE_SECTIONS.includes(section))
    : [];

  const dedupedOrder = [...new Set(providedOrder)];
  const missing = PROMPT_STRUCTURE_SECTIONS.filter(
    (section) => !dedupedOrder.includes(section),
  );

  return {
    autoSavePrompts:
      typeof settings.autoSavePrompts === "boolean"
        ? settings.autoSavePrompts
        : defaults.autoSavePrompts,
    promptStructure: [...dedupedOrder, ...missing],
    disabledRuleIndices: Array.isArray(settings.disabledRuleIndices)
      ? settings.disabledRuleIndices.filter(
          (i) => typeof i === "number" && i >= 0,
        )
      : [],
    includeGlobalRules:
      typeof settings.includeGlobalRules === "boolean"
        ? settings.includeGlobalRules
        : false,
  };
}

export function getAllProjects() {
  return db.data.projects.sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
}

export function findProjectById(id) {
  return db.data.projects.find((p) => p.id === id);
}

export function findProjectByName(name) {
  return db.data.projects.find(
    (p) => p.name.toLowerCase() === name.toLowerCase(),
  );
}

export function searchProjects(searchTerm) {
  const term = searchTerm.toLowerCase();
  return db.data.projects
    .filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        p.description.toLowerCase().includes(term),
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function createProject({
  name,
  description,
  rules,
  promptSettings,
  folderPath,
  containerName,
  gitUrl,
  containerPorts,
}) {
  const now = new Date().toISOString();
  const project = {
    id: uuidv4(),
    name: name.trim(),
    description: description.trim(),
    rules: rules.filter((r) => r && r.trim()).map((r) => r.trim()),
    promptSettings: normalizePromptSettings(promptSettings),
    folderPath: folderPath || null, // Local filesystem path for workspace
    containerName: containerName || null, // Docker container name
    gitUrl: gitUrl || null, // Git repository URL
    containerPorts: containerPorts || [], // Port mappings e.g. ['3000:3000']
    containerStatus: null, // Last known status ('running', 'stopped', etc.)
    promptCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  db.data.projects.push(project);
  await db.write();
  return project;
}

export async function updateProject(id, updates) {
  const index = db.data.projects.findIndex((p) => p.id === id);
  if (index === -1) return null;

  const project = db.data.projects[index];
  const updatedProject = {
    ...project,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  db.data.projects[index] = updatedProject;
  await db.write();
  return updatedProject;
}

export async function deleteProject(id) {
  const index = db.data.projects.findIndex((p) => p.id === id);
  if (index === -1) return false;

  db.data.projects.splice(index, 1);
  // Also delete associated prompts
  db.data.prompts = db.data.prompts.filter((p) => p.projectId !== id);
  await db.write();
  return true;
}

export async function incrementPromptCount(id) {
  const project = findProjectById(id);
  if (project) {
    project.promptCount += 1;
    project.updatedAt = new Date().toISOString();
    await db.write();
  }
}

export async function decrementPromptCount(id) {
  const project = findProjectById(id);
  if (project && project.promptCount > 0) {
    project.promptCount -= 1;
    project.updatedAt = new Date().toISOString();
    await db.write();
  }
}

export async function recalculatePromptCount(id) {
  const project = findProjectById(id);
  if (project) {
    project.promptCount = db.data.prompts.filter(
      (p) => p.projectId === id,
    ).length;
    await db.write();
  }
}

export default {
  getAll: getAllProjects,
  findById: findProjectById,
  findByName: findProjectByName,
  search: searchProjects,
  create: createProject,
  update: updateProject,
  delete: deleteProject,
  incrementPromptCount,
  decrementPromptCount,
  recalculatePromptCount,
};
