import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import db, { getDB } from "./db.js";
import { findProjectById, updateProject } from "./models/Project.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_CATEGORIES = [
  "testing",
  "deployment",
  "database",
  "framework",
  "security",
  "devops",
  "general",
];

/**
 * Convert a simple glob pattern (e.g. "*.test.tsx") into a RegExp.
 * Supports `*` (any non-separator chars) and `**` (any chars including /).
 */
function globToRegex(pattern) {
  let re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex specials (except * and ?)
    .replace(/\*\*/g, "<<GLOBSTAR>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<GLOBSTAR>>/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`(^|/)${re}$`);
}

/**
 * Validate that a skill object has the required fields and correct types.
 */
function validateSkill(data) {
  const errors = [];

  if (!data || typeof data !== "object") {
    return ["Skill data must be a JSON object"];
  }

  if (!data.name || typeof data.name !== "string") {
    errors.push("Skill must have a name (string)");
  }
  if (!data.description || typeof data.description !== "string") {
    errors.push("Skill must have a description (string)");
  }
  if (!data.version || typeof data.version !== "string") {
    errors.push("Skill must have a version (string)");
  }
  if (data.category && !VALID_CATEGORIES.includes(data.category)) {
    errors.push(
      `Invalid category "${data.category}". Must be one of: ${VALID_CATEGORIES.join(", ")}`,
    );
  }

  // Validate arrays have correct item shapes
  if (data.rules && !Array.isArray(data.rules)) {
    errors.push("rules must be an array of strings");
  }
  if (data.promptTemplates) {
    if (!Array.isArray(data.promptTemplates)) {
      errors.push("promptTemplates must be an array");
    } else {
      for (const [i, t] of data.promptTemplates.entries()) {
        if (!t.name || !t.template) {
          errors.push(
            `promptTemplates[${i}] must have name and template fields`,
          );
        }
      }
    }
  }
  if (data.quickCommands) {
    if (!Array.isArray(data.quickCommands)) {
      errors.push("quickCommands must be an array");
    } else {
      for (const [i, c] of data.quickCommands.entries()) {
        if (!c.name || !c.command) {
          errors.push(`quickCommands[${i}] must have name and command fields`);
        }
      }
    }
  }
  if (data.triggers) {
    if (!Array.isArray(data.triggers)) {
      errors.push("triggers must be an array");
    } else {
      for (const [i, t] of data.triggers.entries()) {
        if (!t.filePattern) {
          errors.push(`triggers[${i}] must have a filePattern field`);
        }
      }
    }
  }

  return errors;
}

class SkillManager {
  constructor() {
    this.builtInSkills = new Map(); // id -> skill
    this.installedSkills = new Map(); // id -> skill
  }

  /**
   * Initialize -- load built-in skills from disk and installed skills from DB.
   */
  async init() {
    // Load .json files from src/server/skills/
    const skillsDir = path.join(__dirname, "skills");
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }

    const files = fs.readdirSync(skillsDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(skillsDir, file), "utf-8");
        const skill = JSON.parse(raw);
        if (skill.id) {
          this.builtInSkills.set(skill.id, { ...skill, builtIn: true });
        }
      } catch (e) {
        console.warn(`Failed to load skill ${file}:`, e.message);
      }
    }

    // Load installed skills from DB
    const database = getDB();
    if (!database.data.skills) database.data.skills = [];
    for (const skill of database.data.skills) {
      this.installedSkills.set(skill.id, { ...skill, builtIn: false });
    }

    console.log(
      `Skills loaded: ${this.builtInSkills.size} built-in, ${this.installedSkills.size} installed`,
    );
  }

  /**
   * Get all available skills (built-in + installed), merged into a single array.
   * Installed skills with the same ID as a built-in skill override the built-in.
   */
  getAll() {
    const merged = new Map();

    for (const [id, skill] of this.builtInSkills) {
      merged.set(id, skill);
    }
    for (const [id, skill] of this.installedSkills) {
      merged.set(id, skill);
    }

    return Array.from(merged.values());
  }

  /**
   * Get a single skill by ID. Installed skills take priority over built-in.
   */
  get(skillId) {
    return this.installedSkills.get(skillId) || this.builtInSkills.get(skillId) || null;
  }

  /**
   * Install a skill from JSON data. Validates structure, generates ID if missing,
   * persists to db.data.skills.
   */
  async install(skillData) {
    const errors = validateSkill(skillData);
    if (errors.length > 0) {
      throw new Error(`Invalid skill: ${errors.join("; ")}`);
    }

    const skill = {
      id: skillData.id || uuidv4(),
      name: skillData.name,
      description: skillData.description,
      version: skillData.version,
      author: skillData.author || "Unknown",
      icon: skillData.icon || "puzzle",
      category: skillData.category || "general",
      rules: Array.isArray(skillData.rules) ? skillData.rules : [],
      promptTemplates: Array.isArray(skillData.promptTemplates)
        ? skillData.promptTemplates
        : [],
      quickCommands: Array.isArray(skillData.quickCommands)
        ? skillData.quickCommands
        : [],
      conventions: skillData.conventions || "",
      triggers: Array.isArray(skillData.triggers) ? skillData.triggers : [],
      installedAt: new Date().toISOString(),
    };

    // Persist to DB
    const database = getDB();
    if (!database.data.skills) database.data.skills = [];

    // Replace if already installed (upgrade)
    const existingIndex = database.data.skills.findIndex(
      (s) => s.id === skill.id,
    );
    if (existingIndex !== -1) {
      database.data.skills[existingIndex] = skill;
    } else {
      database.data.skills.push(skill);
    }
    await database.write();

    // Update in-memory map
    this.installedSkills.set(skill.id, { ...skill, builtIn: false });

    return skill;
  }

  /**
   * Uninstall a user-installed skill. Cannot uninstall built-in skills.
   */
  async uninstall(skillId) {
    if (!this.installedSkills.has(skillId)) {
      if (this.builtInSkills.has(skillId)) {
        throw new Error("Cannot uninstall built-in skills");
      }
      throw new Error(`Skill "${skillId}" not found`);
    }

    // Remove from DB
    const database = getDB();
    database.data.skills = (database.data.skills || []).filter(
      (s) => s.id !== skillId,
    );
    await database.write();

    // Remove from in-memory map
    this.installedSkills.delete(skillId);

    // Remove from all projects' activeSkills
    for (const project of database.data.projects) {
      if (
        Array.isArray(project.activeSkills) &&
        project.activeSkills.includes(skillId)
      ) {
        project.activeSkills = project.activeSkills.filter(
          (id) => id !== skillId,
        );
      }
    }
    await database.write();

    return true;
  }

  /**
   * Install a skill from a URL. Fetches the JSON and delegates to install().
   */
  async installFromUrl(url) {
    if (!url || typeof url !== "string") {
      throw new Error("A valid URL is required");
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch skill from URL: ${response.status} ${response.statusText}`,
      );
    }

    const contentType = response.headers.get("content-type") || "";
    if (
      !contentType.includes("application/json") &&
      !contentType.includes("text/plain") &&
      !url.endsWith(".json")
    ) {
      throw new Error(
        "URL does not appear to serve JSON. Expected content-type application/json.",
      );
    }

    let skillData;
    try {
      skillData = await response.json();
    } catch {
      throw new Error("Failed to parse skill JSON from URL");
    }

    return this.install(skillData);
  }

  /**
   * Get the list of active skill objects for a project.
   */
  getActiveSkills(projectId) {
    const project = findProjectById(projectId);
    if (!project) return [];

    const activeIds = Array.isArray(project.activeSkills)
      ? project.activeSkills
      : [];

    return activeIds
      .map((id) => this.get(id))
      .filter(Boolean);
  }

  /**
   * Activate a skill for a project. Adds the skill ID to project.activeSkills.
   */
  async activateForProject(projectId, skillId) {
    const project = findProjectById(projectId);
    if (!project) throw new Error(`Project "${projectId}" not found`);

    const skill = this.get(skillId);
    if (!skill) throw new Error(`Skill "${skillId}" not found`);

    const activeSkills = Array.isArray(project.activeSkills)
      ? [...project.activeSkills]
      : [];

    if (activeSkills.includes(skillId)) {
      return project; // Already active
    }

    activeSkills.push(skillId);
    return updateProject(projectId, { activeSkills });
  }

  /**
   * Deactivate a skill for a project. Removes the skill ID from project.activeSkills.
   */
  async deactivateForProject(projectId, skillId) {
    const project = findProjectById(projectId);
    if (!project) throw new Error(`Project "${projectId}" not found`);

    const activeSkills = Array.isArray(project.activeSkills)
      ? project.activeSkills.filter((id) => id !== skillId)
      : [];

    return updateProject(projectId, { activeSkills });
  }

  /**
   * Build the LLM context string from all active skills for a project.
   * Returns a formatted markdown string with rules, conventions, etc.
   */
  buildSkillContext(projectId) {
    const activeSkills = this.getActiveSkills(projectId);
    if (activeSkills.length === 0) return "";

    const sections = [];
    sections.push("## Active Skills\n");

    for (const skill of activeSkills) {
      const parts = [];
      parts.push(`### ${skill.name}`);

      if (skill.description) {
        parts.push(`_${skill.description}_\n`);
      }

      // Rules
      if (Array.isArray(skill.rules) && skill.rules.length > 0) {
        parts.push("**Rules:**");
        skill.rules.forEach((rule, i) => {
          parts.push(`${i + 1}. ${rule}`);
        });
        parts.push("");
      }

      // Conventions
      if (skill.conventions && skill.conventions.trim()) {
        parts.push("**Conventions:**");
        parts.push(skill.conventions.trim());
        parts.push("");
      }

      sections.push(parts.join("\n"));
    }

    return sections.join("\n");
  }

  /**
   * Get all quick commands from active skills for a project.
   */
  getSkillQuickCommands(projectId) {
    const activeSkills = this.getActiveSkills(projectId);
    const commands = [];

    for (const skill of activeSkills) {
      if (Array.isArray(skill.quickCommands)) {
        for (const cmd of skill.quickCommands) {
          commands.push({
            ...cmd,
            skillId: skill.id,
            skillName: skill.name,
          });
        }
      }
    }

    return commands;
  }

  /**
   * Get all prompt templates from active skills for a project.
   */
  getSkillPromptTemplates(projectId) {
    const activeSkills = this.getActiveSkills(projectId);
    const templates = [];

    for (const skill of activeSkills) {
      if (Array.isArray(skill.promptTemplates)) {
        for (const tmpl of skill.promptTemplates) {
          templates.push({
            ...tmpl,
            skillId: skill.id,
            skillName: skill.name,
          });
        }
      }
    }

    return templates;
  }

  /**
   * Check if any active skills have triggers matching a given file path.
   * Returns an array of skills whose triggers match.
   */
  getTriggeredSkills(projectId, filePath) {
    if (!filePath) return [];

    const activeSkills = this.getActiveSkills(projectId);
    const matched = [];

    for (const skill of activeSkills) {
      if (!Array.isArray(skill.triggers)) continue;

      for (const trigger of skill.triggers) {
        if (!trigger.filePattern) continue;

        try {
          const regex = globToRegex(trigger.filePattern);
          if (regex.test(filePath)) {
            matched.push({
              skill,
              trigger,
            });
            break; // One match per skill is enough
          }
        } catch {
          // Skip invalid patterns
        }
      }
    }

    return matched;
  }
}

export const skillManager = new SkillManager();
export default skillManager;
