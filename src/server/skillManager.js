import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { v4 as uuidv4 } from "uuid";
import db, { getDB } from "./db.js";
import { findProjectById, updateProject } from "./models/Project.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Path to folder-based skills data directory */
const SKILLS_DATA_DIR = path.join(__dirname, "../../data/skills");

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
  "frontend",
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

/**
 * Recursively collect all .md files from a directory.
 */
function collectMdFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMdFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

class SkillManager {
  constructor() {
    this.builtInSkills = new Map(); // id -> skill (legacy JSON built-ins)
    this.installedSkills = new Map(); // id -> skill (legacy JSON installed)
    this.folderSkills = new Map(); // id -> skill (folder-based skills)
  }

  /**
   * Initialize -- load built-in skills from disk, installed skills from DB,
   * and folder-based skills from data/skills/.
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
      if (skill.format === "folder") {
        // Folder-based skills stored in DB -- load from disk
        const skillDir = skill.skillPath || path.join(SKILLS_DATA_DIR, skill.id);
        try {
          const loaded = this.loadFolderSkill(skillDir);
          if (loaded) {
            // Preserve DB-only fields like deployedContainers
            loaded.deployedContainers = skill.deployedContainers || [];
            this.folderSkills.set(loaded.id, loaded);
          }
        } catch (e) {
          console.warn(`Failed to load folder skill ${skill.id}:`, e.message);
        }
      } else {
        this.installedSkills.set(skill.id, { ...skill, builtIn: false });
      }
    }

    // Scan data/skills/ for any folder skills not yet in DB
    if (!fs.existsSync(SKILLS_DATA_DIR)) {
      fs.mkdirSync(SKILLS_DATA_DIR, { recursive: true });
    }

    const skillDirs = fs.readdirSync(SKILLS_DATA_DIR, { withFileTypes: true });
    for (const entry of skillDirs) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(SKILLS_DATA_DIR, entry.name);
      const manifestPath = path.join(skillDir, "manifest.json");
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const loaded = this.loadFolderSkill(skillDir);
        if (loaded && !this.folderSkills.has(loaded.id)) {
          this.folderSkills.set(loaded.id, loaded);
          // Persist to DB so it shows up on next restart
          database.data.skills.push({
            id: loaded.id,
            format: "folder",
            skillPath: skillDir,
            installedAt: new Date().toISOString(),
            deployedContainers: [],
          });
        }
      } catch (e) {
        console.warn(`Failed to load folder skill from ${skillDir}:`, e.message);
      }
    }

    if (this.folderSkills.size > 0) {
      await database.write();
    }

    console.log(
      `Skills loaded: ${this.builtInSkills.size} built-in, ${this.installedSkills.size} installed, ${this.folderSkills.size} folder-based`,
    );

    // Ensure the bundled default-on skills are actually enabled on EVERY
    // existing project (one-time, idempotent backfill).
    await this.backfillDefaultSkills();
  }

  /** IDs of built-in skills that ship enabled by default. */
  defaultOnSkillIds() {
    return this._defaultOnSkills().map((s) => s.id);
  }

  /**
   * Make sure a project's activeSkills includes every default-on skill (minus any
   * the project explicitly opted out of via disabledDefaultSkills). Idempotent.
   * @returns {boolean} whether anything was added.
   */
  async ensureDefaultSkillsActive(projectId) {
    const project = findProjectById(projectId);
    if (!project) return false;
    const disabled = new Set(project.disabledDefaultSkills || []);
    const active = Array.isArray(project.activeSkills) ? [...project.activeSkills] : [];
    const present = new Set(active);
    let changed = false;
    for (const id of this.defaultOnSkillIds()) {
      if (!present.has(id) && !disabled.has(id)) { active.push(id); present.add(id); changed = true; }
    }
    if (changed) await updateProject(projectId, { activeSkills: active });
    return changed;
  }

  /** Backfill default-on skills into all existing projects in one write. */
  async backfillDefaultSkills() {
    try {
      const ids = this.defaultOnSkillIds();
      if (!ids.length) return;
      const database = getDB();
      let changed = 0;
      for (const project of database.data.projects || []) {
        const disabled = new Set(project.disabledDefaultSkills || []);
        if (!Array.isArray(project.activeSkills)) project.activeSkills = [];
        const present = new Set(project.activeSkills);
        for (const id of ids) {
          if (!present.has(id) && !disabled.has(id)) { project.activeSkills.push(id); present.add(id); changed++; }
        }
      }
      if (changed) {
        await database.write();
        console.log(`[skillManager] Enabled ${changed} default skill activation(s) across existing projects`);
      }
    } catch (err) {
      console.warn('[skillManager] default skill backfill failed:', err.message);
    }
  }

  /**
   * Load a folder-based skill from its directory.
   * Reads manifest.json, validates required fields, and returns the skill object.
   */
  loadFolderSkill(skillDir) {
    const manifestPath = path.join(skillDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`No manifest.json found in ${skillDir}`);
    }

    const raw = fs.readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(raw);

    // Validate required fields
    if (!manifest.id || typeof manifest.id !== "string") {
      throw new Error(`Folder skill manifest missing 'id' in ${skillDir}`);
    }
    if (!manifest.name || typeof manifest.name !== "string") {
      throw new Error(`Folder skill manifest missing 'name' in ${skillDir}`);
    }
    if (!manifest.description || typeof manifest.description !== "string") {
      throw new Error(`Folder skill manifest missing 'description' in ${skillDir}`);
    }
    if (!manifest.version || typeof manifest.version !== "string") {
      throw new Error(`Folder skill manifest missing 'version' in ${skillDir}`);
    }

    const skill = {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      author: manifest.author || "Unknown",
      category: manifest.category || "general",
      icon: manifest.icon || "puzzle",
      tags: Array.isArray(manifest.tags) ? manifest.tags : [],
      always: Array.isArray(manifest.always) ? manifest.always : [],
      reference: Array.isArray(manifest.reference) ? manifest.reference : [],
      triggers: Array.isArray(manifest.triggers) ? manifest.triggers : [],
      promptTemplates: Array.isArray(manifest.promptTemplates) ? manifest.promptTemplates : [],
      quickCommands: Array.isArray(manifest.quickCommands) ? manifest.quickCommands : [],
      source: manifest.source || null,
      format: "folder",
      skillPath: skillDir,
      builtIn: false,
      deployedContainers: [],
    };

    return skill;
  }

  /**
   * Get all available skills (built-in + installed + folder-based), merged into a single array.
   * Installed/folder skills with the same ID as a built-in skill override the built-in.
   */
  getAll() {
    const merged = new Map();

    for (const [id, skill] of this.builtInSkills) {
      merged.set(id, skill);
    }
    for (const [id, skill] of this.installedSkills) {
      merged.set(id, skill);
    }
    for (const [id, skill] of this.folderSkills) {
      merged.set(id, skill);
    }

    return Array.from(merged.values());
  }

  /**
   * Get a single skill by ID. Folder skills take priority, then installed, then built-in.
   */
  get(skillId) {
    return (
      this.folderSkills.get(skillId) ||
      this.installedSkills.get(skillId) ||
      this.builtInSkills.get(skillId) ||
      null
    );
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
   * For folder-based skills, also removes the skill directory from disk.
   */
  async uninstall(skillId) {
    const isFolderSkill = this.folderSkills.has(skillId);
    const isInstalledSkill = this.installedSkills.has(skillId);

    if (!isFolderSkill && !isInstalledSkill) {
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

    // For folder skills, remove the directory from disk
    if (isFolderSkill) {
      const skill = this.folderSkills.get(skillId);
      const skillDir = skill.skillPath || path.join(SKILLS_DATA_DIR, skillId);
      try {
        if (fs.existsSync(skillDir)) {
          fs.rmSync(skillDir, { recursive: true, force: true });
        }
      } catch (e) {
        console.warn(`Failed to remove skill directory ${skillDir}:`, e.message);
      }
      this.folderSkills.delete(skillId);
    } else {
      this.installedSkills.delete(skillId);
    }

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
   * Install a folder-based skill from a git repository URL.
   * Clones the repo (shallow), reads manifest.json, copies to data/skills/{id}/.
   *
   * @param {string} repoUrl - Git repository URL (github.com/user/repo, etc.)
   * @param {object} options - Optional settings (e.g. { ref: 'main' })
   * @returns {object} The installed skill object
   */
  async installFromRepo(repoUrl, options = {}) {
    if (!repoUrl || typeof repoUrl !== "string") {
      throw new Error("A valid git repository URL is required");
    }

    // Normalize the URL: add https:// if missing, add .git if needed
    let gitUrl = repoUrl.trim();
    if (!gitUrl.match(/^https?:\/\//) && !gitUrl.match(/^git@/)) {
      gitUrl = `https://${gitUrl}`;
    }

    // Create a temporary directory for cloning
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-clone-"));

    try {
      // Shallow clone the repository
      const ref = options.ref || "main";
      try {
        execSync(
          `git clone --depth 1 --branch ${ref} ${gitUrl} ${tmpDir}/repo`,
          { stdio: "pipe", timeout: 60000 },
        );
      } catch (cloneErr) {
        // If the specified ref fails, try without --branch (uses default branch)
        try {
          execSync(
            `git clone --depth 1 ${gitUrl} ${tmpDir}/repo`,
            { stdio: "pipe", timeout: 60000 },
          );
        } catch (fallbackErr) {
          throw new Error(
            `Failed to clone repository: ${fallbackErr.message}`,
          );
        }
      }

      const repoDir = path.join(tmpDir, "repo");

      // Read manifest.json from the repo root
      const manifestPath = path.join(repoDir, "manifest.json");
      if (!fs.existsSync(manifestPath)) {
        throw new Error(
          "Repository does not contain a manifest.json at the root",
        );
      }

      const raw = fs.readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(raw);

      // Validate required fields
      if (!manifest.id) throw new Error("manifest.json is missing 'id'");
      if (!manifest.name) throw new Error("manifest.json is missing 'name'");
      if (!manifest.description) throw new Error("manifest.json is missing 'description'");
      if (!manifest.version) throw new Error("manifest.json is missing 'version'");

      // Ensure data/skills directory exists
      if (!fs.existsSync(SKILLS_DATA_DIR)) {
        fs.mkdirSync(SKILLS_DATA_DIR, { recursive: true });
      }

      // Copy repo contents to data/skills/{manifest.id}/
      const destDir = path.join(SKILLS_DATA_DIR, manifest.id);
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true });
      }
      fs.cpSync(repoDir, destDir, { recursive: true });

      // Remove .git directory from the installed copy
      const dotGitDir = path.join(destDir, ".git");
      if (fs.existsSync(dotGitDir)) {
        fs.rmSync(dotGitDir, { recursive: true, force: true });
      }

      // Load the skill from its new location
      const skill = this.loadFolderSkill(destDir);
      skill.source = {
        type: "git",
        url: repoUrl,
        ref: options.ref || "main",
      };

      // Register in the DB
      const database = getDB();
      if (!database.data.skills) database.data.skills = [];

      const dbEntry = {
        id: skill.id,
        format: "folder",
        skillPath: destDir,
        installedAt: new Date().toISOString(),
        deployedContainers: [],
        source: skill.source,
      };

      const existingIndex = database.data.skills.findIndex(
        (s) => s.id === skill.id,
      );
      if (existingIndex !== -1) {
        database.data.skills[existingIndex] = dbEntry;
      } else {
        database.data.skills.push(dbEntry);
      }
      await database.write();

      // Update in-memory map
      this.folderSkills.set(skill.id, skill);

      return skill;
    } finally {
      // Clean up temp directory
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  }

  /**
   * Deploy a folder-based skill to a Docker container.
   * Copies the skill folder to /workspace/.skills/{id}/ in the container
   * and fixes ownership.
   *
   * @param {string} skillId - The skill ID
   * @param {string} containerName - Docker container name
   * @returns {object} Deployment status
   */
  async deployToContainer(skillId, containerName) {
    const skill = this.folderSkills.get(skillId);
    if (!skill) {
      throw new Error(
        `Skill "${skillId}" is not a folder-based skill or does not exist`,
      );
    }

    const skillDir = skill.skillPath || path.join(SKILLS_DATA_DIR, skillId);
    if (!fs.existsSync(skillDir)) {
      throw new Error(`Skill directory not found: ${skillDir}`);
    }

    try {
      // Ensure .skills directory exists in the container
      execSync(
        `docker exec ${containerName} mkdir -p /workspace/.skills`,
        { stdio: "pipe", timeout: 15000 },
      );

      // Copy skill folder to container
      execSync(
        `docker cp ${skillDir} ${containerName}:/workspace/.skills/${skillId}`,
        { stdio: "pipe", timeout: 30000 },
      );

      // Fix permissions
      execSync(
        `docker exec ${containerName} chown -R dev:dev /workspace/.skills/${skillId}`,
        { stdio: "pipe", timeout: 15000 },
      );
    } catch (e) {
      throw new Error(
        `Failed to deploy skill to container "${containerName}": ${e.message}`,
      );
    }

    // Track deployment in DB
    const database = getDB();
    const dbSkill = (database.data.skills || []).find((s) => s.id === skillId);
    if (dbSkill) {
      if (!Array.isArray(dbSkill.deployedContainers)) {
        dbSkill.deployedContainers = [];
      }
      if (!dbSkill.deployedContainers.includes(containerName)) {
        dbSkill.deployedContainers.push(containerName);
      }
      await database.write();
    }

    // Update in-memory
    if (!Array.isArray(skill.deployedContainers)) {
      skill.deployedContainers = [];
    }
    if (!skill.deployedContainers.includes(containerName)) {
      skill.deployedContainers.push(containerName);
    }

    return {
      success: true,
      skillId,
      containerName,
      path: `/workspace/.skills/${skillId}`,
    };
  }

  /**
   * Undeploy a folder-based skill from a Docker container.
   * Removes the skill folder from /workspace/.skills/{id}/ in the container.
   *
   * @param {string} skillId - The skill ID
   * @param {string} containerName - Docker container name
   * @returns {object} Status
   */
  async undeployFromContainer(skillId, containerName) {
    try {
      execSync(
        `docker exec ${containerName} rm -rf /workspace/.skills/${skillId}`,
        { stdio: "pipe", timeout: 15000 },
      );
    } catch (e) {
      throw new Error(
        `Failed to undeploy skill from container "${containerName}": ${e.message}`,
      );
    }

    // Update DB
    const database = getDB();
    const dbSkill = (database.data.skills || []).find((s) => s.id === skillId);
    if (dbSkill && Array.isArray(dbSkill.deployedContainers)) {
      dbSkill.deployedContainers = dbSkill.deployedContainers.filter(
        (c) => c !== containerName,
      );
      await database.write();
    }

    // Update in-memory
    const skill = this.folderSkills.get(skillId);
    if (skill && Array.isArray(skill.deployedContainers)) {
      skill.deployedContainers = skill.deployedContainers.filter(
        (c) => c !== containerName,
      );
    }

    return { success: true, skillId, containerName };
  }

  /**
   * Check if a skill folder exists in a container.
   *
   * @param {string} skillId - The skill ID
   * @param {string} containerName - Docker container name
   * @returns {boolean} Whether the skill is deployed in the container
   */
  getDeploymentStatus(skillId, containerName) {
    try {
      execSync(
        `docker exec ${containerName} test -d /workspace/.skills/${skillId}`,
        { stdio: "pipe", timeout: 10000 },
      );
      return true;
    } catch {
      return false;
    }
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

    // Explicitly-activated skills first, then any "default-on" built-in skills
    // (the bundled house skills — premium UI/UX, design, motion, security, edge)
    // so every project gets them out of the box, for every CLI agent, without
    // manual activation. A project can opt out via disabledDefaultSkills.
    const disabled = new Set(project.disabledDefaultSkills || []);
    const result = [];
    const seen = new Set();
    for (const id of activeIds) {
      const skill = this.get(id);
      if (skill && !seen.has(id)) { seen.add(id); result.push(skill); }
    }
    for (const skill of this._defaultOnSkills()) {
      if (!seen.has(skill.id) && !disabled.has(skill.id)) { seen.add(skill.id); result.push(skill); }
    }
    return result;
  }

  /** Built-in skills flagged defaultOn — applied to every project automatically. */
  _defaultOnSkills() {
    return Array.from(this.builtInSkills.values()).filter((s) => s && s.defaultOn);
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

    const updates = {};
    // Re-activating a default-on skill clears any prior opt-out.
    if (Array.isArray(project.disabledDefaultSkills) && project.disabledDefaultSkills.includes(skillId)) {
      updates.disabledDefaultSkills = project.disabledDefaultSkills.filter((id) => id !== skillId);
    }
    if (activeSkills.includes(skillId)) {
      return Object.keys(updates).length ? updateProject(projectId, updates) : project;
    }

    activeSkills.push(skillId);
    return updateProject(projectId, { ...updates, activeSkills });
  }

  /**
   * Deactivate a skill for a project. Removes the skill ID from project.activeSkills.
   * For default-on skills, also records an explicit opt-out so the auto-enable
   * backfill/merge does not re-add it.
   */
  async deactivateForProject(projectId, skillId) {
    const project = findProjectById(projectId);
    if (!project) throw new Error(`Project "${projectId}" not found`);

    const activeSkills = Array.isArray(project.activeSkills)
      ? project.activeSkills.filter((id) => id !== skillId)
      : [];

    const updates = { activeSkills };
    if (this.defaultOnSkillIds().includes(skillId)) {
      const disabled = new Set(project.disabledDefaultSkills || []);
      disabled.add(skillId);
      updates.disabledDefaultSkills = [...disabled];
    }
    return updateProject(projectId, updates);
  }

  /**
   * Read the contents of "always" .md files for a folder-based skill.
   * Returns an array of { filename, content } objects.
   */
  _readAlwaysFiles(skill) {
    const results = [];
    if (skill.format !== "folder" || !skill.skillPath) return results;

    const alwaysDir = path.join(skill.skillPath, "always");
    const mdFiles = collectMdFiles(alwaysDir);
    for (const filePath of mdFiles) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const filename = path.relative(skill.skillPath, filePath);
        results.push({ filename, content });
      } catch {
        // Skip unreadable files
      }
    }
    return results;
  }

  /**
   * Read the contents of "reference" .md files for a folder-based skill.
   * Returns an array of { filename, content } objects.
   */
  _readReferenceFiles(skill) {
    const results = [];
    if (skill.format !== "folder" || !skill.skillPath) return results;

    const referenceDir = path.join(skill.skillPath, "reference");
    const mdFiles = collectMdFiles(referenceDir);
    for (const filePath of mdFiles) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const filename = path.relative(skill.skillPath, filePath);
        results.push({ filename, content });
      } catch {
        // Skip unreadable files
      }
    }
    return results;
  }

  /**
   * Build the LLM context string from all active skills for a project.
   * For legacy skills: uses rules[], conventions fields.
   * For folder skills: reads the "always" .md files and includes their contents.
   * Returns a formatted markdown string.
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

      if (skill.format === "folder") {
        // Folder-based skill: read "always" files
        const alwaysFiles = this._readAlwaysFiles(skill);
        if (alwaysFiles.length > 0) {
          for (const file of alwaysFiles) {
            parts.push(`**${file.filename}:**`);
            parts.push(file.content.trim());
            parts.push("");
          }
        }
      } else {
        // Legacy skill: use rules and conventions
        if (Array.isArray(skill.rules) && skill.rules.length > 0) {
          parts.push("**Rules:**");
          skill.rules.forEach((rule, i) => {
            parts.push(`${i + 1}. ${rule}`);
          });
          parts.push("");
        }

        if (skill.conventions && skill.conventions.trim()) {
          parts.push("**Conventions:**");
          parts.push(skill.conventions.trim());
          parts.push("");
        }
      }

      sections.push(parts.join("\n"));
    }

    return sections.join("\n");
  }

  /**
   * Build skill context for a specific task, including selective "reference" files.
   * Includes everything from buildSkillContext plus reference files that match
   * the given task tags or file path triggers.
   *
   * @param {string} projectId - The project ID
   * @param {object} options - { taskTags: string[], filePaths: string[] }
   * @returns {string} Formatted markdown context string
   */
  buildSkillContextForTask(projectId, { taskTags = [], filePaths = [] } = {}) {
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

      if (skill.format === "folder") {
        // Always-included files
        const alwaysFiles = this._readAlwaysFiles(skill);
        if (alwaysFiles.length > 0) {
          for (const file of alwaysFiles) {
            parts.push(`**${file.filename}:**`);
            parts.push(file.content.trim());
            parts.push("");
          }
        }

        // Determine if reference files should be included
        let includeReference = false;
        const specificReferenceFiles = new Set();

        // Check tag matching: if the skill has tags that overlap with taskTags
        if (Array.isArray(skill.tags) && skill.tags.length > 0 && taskTags.length > 0) {
          const normalizedTaskTags = taskTags.map((t) => t.toLowerCase());
          for (const tag of skill.tags) {
            if (normalizedTaskTags.includes(tag.toLowerCase())) {
              includeReference = true;
              break;
            }
          }
        }

        // Check trigger filePattern matching against filePaths
        if (Array.isArray(skill.triggers) && filePaths.length > 0) {
          for (const trigger of skill.triggers) {
            if (!trigger.filePattern) continue;
            try {
              const regex = globToRegex(trigger.filePattern);
              for (const fp of filePaths) {
                if (regex.test(fp)) {
                  // If trigger specifies specific include files, track them
                  if (Array.isArray(trigger.include)) {
                    for (const inc of trigger.include) {
                      specificReferenceFiles.add(inc);
                    }
                  } else {
                    includeReference = true;
                  }
                  break;
                }
              }
            } catch {
              // Skip invalid patterns
            }
          }
        }

        // Include reference files based on matching
        if (includeReference || specificReferenceFiles.size > 0) {
          const referenceFiles = this._readReferenceFiles(skill);
          for (const file of referenceFiles) {
            // If we have specific files requested, only include those
            if (specificReferenceFiles.size > 0 && !includeReference) {
              const matches = Array.from(specificReferenceFiles).some(
                (pattern) => file.filename === pattern || file.filename.endsWith(pattern),
              );
              if (!matches) continue;
            }
            parts.push(`**${file.filename}:**`);
            parts.push(file.content.trim());
            parts.push("");
          }
        }
      } else {
        // Legacy skill: same as buildSkillContext
        if (Array.isArray(skill.rules) && skill.rules.length > 0) {
          parts.push("**Rules:**");
          skill.rules.forEach((rule, i) => {
            parts.push(`${i + 1}. ${rule}`);
          });
          parts.push("");
        }

        if (skill.conventions && skill.conventions.trim()) {
          parts.push("**Conventions:**");
          parts.push(skill.conventions.trim());
          parts.push("");
        }
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
