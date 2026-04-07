import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import db, { getDB } from "./db.js";
import { findProjectById, updateProject } from "./models/Project.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Convert a GitHub blob/tree URL to raw.githubusercontent.com URL
 */
function convertGitHubUrl(url) {
  // Handle github.com/user/repo/blob/branch/path URLs
  const blobMatch = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/
  );
  if (blobMatch) {
    const [, owner, repo, branch, filePath] = blobMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  }

  // Handle github.com/user/repo/raw/branch/path URLs
  const rawMatch = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+)$/
  );
  if (rawMatch) {
    const [, owner, repo, branch, filePath] = rawMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  }

  // Already a raw URL or other URL
  return url;
}

/**
 * Parse YAML-like frontmatter from markdown content
 */
function parseFrontmatter(content) {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!frontmatterMatch) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterStr = frontmatterMatch[1];
  const body = content.slice(frontmatterMatch[0].length);

  // Simple YAML parser for key: value pairs
  const frontmatter = {};
  for (const line of frontmatterStr.split("\n")) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) {
      const [, key, value] = match;
      // Remove quotes if present
      frontmatter[key] = value.replace(/^["']|["']$/g, "").trim();
    }
  }

  return { frontmatter, body };
}

/**
 * Parse a markdown file into a skill object
 * Supports frontmatter for metadata and sections for rules/conventions
 */
function parseMarkdownSkill(content, sourceUrl = null) {
  const { frontmatter, body } = parseFrontmatter(content);

  const skill = {
    name: frontmatter.name || "Untitled Skill",
    description: frontmatter.description || "",
    version: frontmatter.version || "1.0.0",
    author: frontmatter.author || "Unknown",
    category: frontmatter.category || "general",
    icon: frontmatter.icon || "puzzle",
    rules: [],
    conventions: "",
    promptTemplates: [],
    quickCommands: [],
    triggers: [],
    sourceUrl,
  };

  // Parse sections from markdown body
  const sections = body.split(/^#+\s+/m).filter(Boolean);

  for (const section of sections) {
    const lines = section.split("\n");
    const title = lines[0].toLowerCase().trim();
    const sectionContent = lines.slice(1).join("\n").trim();

    if (title.includes("rule")) {
      // Parse rules from bullet points
      const ruleLines = sectionContent.split("\n");
      for (const line of ruleLines) {
        const ruleMatch = line.match(/^[-*]\s+(.+)$/);
        if (ruleMatch) {
          skill.rules.push(ruleMatch[1].trim());
        }
      }
    } else if (title.includes("convention")) {
      skill.conventions = sectionContent;
    } else if (title.includes("template")) {
      // Parse prompt templates (sub-sections with ## or content)
      const templateSections = sectionContent.split(/^##\s+/m).filter(Boolean);
      for (const tmpl of templateSections) {
        const tmplLines = tmpl.split("\n");
        const tmplName = tmplLines[0].trim();
        const tmplContent = tmplLines.slice(1).join("\n").trim();
        if (tmplName && tmplContent) {
          skill.promptTemplates.push({ name: tmplName, template: tmplContent });
        }
      }
    } else if (title.includes("command")) {
      // Parse quick commands: - `name`: description
      const cmdLines = sectionContent.split("\n");
      for (const line of cmdLines) {
        const cmdMatch = line.match(/^[-*]\s+`([^`]+)`[:\s]+(.+)$/);
        if (cmdMatch) {
          skill.quickCommands.push({
            name: cmdMatch[1].trim(),
            command: cmdMatch[2].trim(),
          });
        }
      }
    } else if (title.includes("trigger") || title.includes("pattern")) {
      // Parse file triggers
      const triggerLines = sectionContent.split("\n");
      for (const line of triggerLines) {
        const triggerMatch = line.match(/^[-*]\s+`([^`]+)`[:\s]*(.*)$/);
        if (triggerMatch) {
          skill.triggers.push({
            filePattern: triggerMatch[1].trim(),
            description: triggerMatch[2].trim() || "",
          });
        }
      }
    }
  }

  // If no sections were found, treat the entire body as conventions/rules
  if (skill.rules.length === 0 && !skill.conventions) {
    // Check if it's a list of rules
    const lines = body.split("\n");
    const bulletLines = lines.filter((l) => l.match(/^[-*]\s+/));
    if (bulletLines.length > 0) {
      skill.rules = bulletLines.map((l) => l.replace(/^[-*]\s+/, "").trim());
    } else {
      // Treat entire content as conventions
      skill.conventions = body.trim();
    }
  }

  return skill;
}

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
   * Install a skill from a URL. Supports both JSON and Markdown files.
   * Automatically converts GitHub blob URLs to raw URLs.
   */
  async installFromUrl(url) {
    if (!url || typeof url !== "string") {
      throw new Error("A valid URL is required");
    }

    // Convert GitHub URLs to raw URLs
    const rawUrl = convertGitHubUrl(url.trim());
    const isMarkdown = rawUrl.endsWith(".md") || rawUrl.endsWith(".markdown");

    const response = await fetch(rawUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch skill from URL: ${response.status} ${response.statusText}`,
      );
    }

    const contentType = response.headers.get("content-type") || "";
    const content = await response.text();

    let skillData;

    if (isMarkdown || contentType.includes("text/markdown")) {
      // Parse as markdown skill
      skillData = parseMarkdownSkill(content, url);
    } else if (
      contentType.includes("application/json") ||
      contentType.includes("text/plain") ||
      rawUrl.endsWith(".json")
    ) {
      // Parse as JSON skill
      try {
        skillData = JSON.parse(content);
      } catch {
        throw new Error("Failed to parse skill JSON from URL");
      }
    } else {
      // Try to auto-detect format
      const trimmed = content.trim();
      if (trimmed.startsWith("{")) {
        try {
          skillData = JSON.parse(content);
        } catch {
          throw new Error("Failed to parse skill JSON from URL");
        }
      } else if (trimmed.startsWith("---") || trimmed.startsWith("#")) {
        // Looks like markdown
        skillData = parseMarkdownSkill(content, url);
      } else {
        throw new Error(
          "Could not detect skill format. URL should point to a .json or .md file.",
        );
      }
    }

    // Store the source URL for reference
    skillData.sourceUrl = url;

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
