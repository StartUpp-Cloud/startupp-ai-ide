/**
 * Context Builder
 * Builds rich project context for the LLM by reading file structure, conventions,
 * build system configuration, git status, and combining with memory store data.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { memoryStore } from './memoryStore.js';

/** @typedef {'npm' | 'yarn' | 'pnpm' | 'bun'} PackageManager */

/**
 * @typedef {Object} BuildSystem
 * @property {PackageManager} packageManager
 * @property {string|null} framework
 * @property {string} language
 * @property {string|null} testRunner
 * @property {Object<string, string>} scripts
 */

/**
 * @typedef {Object} GitInfo
 * @property {string} branch
 * @property {string[]} recentCommits
 * @property {boolean} uncommittedChanges
 */

/**
 * @typedef {Object} FullContext
 * @property {string} summary
 * @property {BuildSystem} buildSystem
 * @property {Object<string, string>} conventions
 * @property {GitInfo|null} gitInfo
 * @property {string} fileTree
 * @property {string} memories
 * @property {string} fullContext
 */

/** Directories to skip when building the file tree */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__',
  '.next', 'coverage', '.nuxt', '.pytest_cache', 'venv', '.venv',
]);

/** Convention/config files to look for */
const CONVENTION_FILES = [
  'CLAUDE.md', 'claude.md', '.claude.md',
  '.cursorrules',
  '.editorconfig',
  '.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.yaml', '.prettierrc.yml',
  '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.yaml', '.eslintrc.yml',
  'eslint.config.js', 'eslint.config.mjs',
  'tsconfig.json',
];

/** Max characters to read from any single convention file */
const MAX_CONVENTION_FILE_CHARS = 2000;

/** Max lines for file tree output */
const MAX_TREE_LINES = 50;

/** Framework detection map: dependency name -> framework label */
const FRAMEWORK_DEPS = {
  'next': 'Next.js',
  'nuxt': 'Nuxt',
  'vite': 'Vite',
  'react': 'React',
  'vue': 'Vue',
  'angular': 'Angular',
  '@angular/core': 'Angular',
  'svelte': 'Svelte',
  'express': 'Express',
  'fastify': 'Fastify',
  'koa': 'Koa',
  'hono': 'Hono',
  'astro': 'Astro',
  'remix': 'Remix',
  '@remix-run/react': 'Remix',
  'gatsby': 'Gatsby',
};

/** Test runner detection map: dependency name -> runner label */
const TEST_RUNNER_DEPS = {
  'jest': 'Jest',
  'vitest': 'Vitest',
  'mocha': 'Mocha',
  'ava': 'AVA',
  'tap': 'Tap',
  'playwright': 'Playwright',
  '@playwright/test': 'Playwright',
  'cypress': 'Cypress',
};

class ContextBuilder {
  /**
   * Build full project context for the LLM.
   * Aggregates build system info, conventions, git status, file tree, and
   * memory store data into a single structured object.
   * @param {string} projectId
   * @param {string} projectPath - Filesystem path to the project root
   * @param {Object} project - Project data from the database
   * @param {string} project.name - Project display name
   * @param {string} [project.description] - Optional project description
   * @param {string[]} [project.rules] - Optional project-level rules
   * @returns {Promise<FullContext>}
   */
  async buildFullContext(projectId, projectPath, project) {
    const buildSystem = this.detectBuildSystem(projectPath);
    const conventions = this.readConventionFiles(projectPath);
    const gitInfo = this.getGitInfo(projectPath);
    const fileTree = this.getFileTree(projectPath);
    const memories = memoryStore.buildContextForLLM(projectId);

    const summary = this._buildSummary(project, buildSystem);
    const fullContext = this._assembleFullContext({
      summary,
      buildSystem,
      conventions,
      gitInfo,
      fileTree,
      memories,
      project,
    });

    return {
      summary,
      buildSystem,
      conventions,
      gitInfo,
      fileTree,
      memories,
      fullContext,
    };
  }

  /**
   * Detect build system and tooling from the project directory.
   * Reads package.json for scripts, dependencies, and framework/test runner info.
   * Falls back to filesystem checks for non-Node projects.
   * @param {string} projectPath - Filesystem path to the project root
   * @returns {BuildSystem}
   */
  detectBuildSystem(projectPath) {
    /** @type {BuildSystem} */
    const result = {
      packageManager: 'npm',
      framework: null,
      language: 'JavaScript',
      testRunner: null,
      scripts: {},
    };

    // Detect package manager from lock files
    if (this._fileExists(path.join(projectPath, 'bun.lockb'))) {
      result.packageManager = 'bun';
    } else if (this._fileExists(path.join(projectPath, 'pnpm-lock.yaml'))) {
      result.packageManager = 'pnpm';
    } else if (this._fileExists(path.join(projectPath, 'yarn.lock'))) {
      result.packageManager = 'yarn';
    }

    // Detect language
    if (this._fileExists(path.join(projectPath, 'tsconfig.json'))) {
      result.language = 'TypeScript';
    } else if (this._fileExists(path.join(projectPath, 'go.mod'))) {
      result.language = 'Go';
    } else if (this._hasFilesWithExtension(projectPath, '.py')) {
      result.language = 'Python';
    } else if (this._fileExists(path.join(projectPath, 'Cargo.toml'))) {
      result.language = 'Rust';
    }

    // Python-specific detection
    if (result.language === 'Python') {
      if (this._fileExists(path.join(projectPath, 'requirements.txt')) ||
          this._fileExists(path.join(projectPath, 'pyproject.toml')) ||
          this._fileExists(path.join(projectPath, 'setup.py'))) {
        // Check for Python frameworks
        const requirements = this._readFileSafe(path.join(projectPath, 'requirements.txt'));
        if (requirements) {
          if (/\bdjango\b/i.test(requirements)) result.framework = 'Django';
          else if (/\bflask\b/i.test(requirements)) result.framework = 'Flask';
          else if (/\bfastapi\b/i.test(requirements)) result.framework = 'FastAPI';
        }
        // Check for pytest
        if (requirements && /\bpytest\b/i.test(requirements)) {
          result.testRunner = 'pytest';
        } else if (this._fileExists(path.join(projectPath, 'pytest.ini')) ||
                   this._fileExists(path.join(projectPath, 'setup.cfg'))) {
          result.testRunner = 'pytest';
        }
      }
      return result;
    }

    // Node.js / package.json-based detection
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJsonContent = this._readFileSafe(packageJsonPath);

    if (!packageJsonContent) {
      return result;
    }

    try {
      const pkg = JSON.parse(packageJsonContent);

      // Extract scripts
      if (pkg.scripts && typeof pkg.scripts === 'object') {
        result.scripts = { ...pkg.scripts };
      }

      // Merge all dependency maps for framework/test-runner detection
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      // Detect framework (prefer more specific matches first)
      for (const [dep, label] of Object.entries(FRAMEWORK_DEPS)) {
        if (allDeps[dep]) {
          result.framework = label;
          break;
        }
      }

      // Detect test runner
      for (const [dep, label] of Object.entries(TEST_RUNNER_DEPS)) {
        if (allDeps[dep]) {
          result.testRunner = label;
          break;
        }
      }
    } catch {
      // Malformed package.json — continue with defaults
    }

    return result;
  }

  /**
   * Read convention and configuration files from the project root.
   * Looks for common config files (CLAUDE.md, .editorconfig, .prettierrc, eslint, tsconfig).
   * Each file's content is truncated to 2000 characters.
   * @param {string} projectPath - Filesystem path to the project root
   * @returns {Object<string, string>} Map of filename to (truncated) content
   */
  readConventionFiles(projectPath) {
    /** @type {Object<string, string>} */
    const conventions = {};

    for (const filename of CONVENTION_FILES) {
      const filePath = path.join(projectPath, filename);
      const content = this._readFileSafe(filePath);
      if (content) {
        conventions[filename] = content.slice(0, MAX_CONVENTION_FILE_CHARS);
      }
    }

    return conventions;
  }

  /**
   * Get a focused file tree representation of the project.
   * Uses recursive readdir (not shell commands) and skips common build/dependency
   * directories. Output is capped at maxDepth levels and 50 lines.
   * @param {string} projectPath - Filesystem path to the project root
   * @param {number} [maxDepth=3] - Maximum directory depth to recurse
   * @returns {string} Indented tree string
   */
  getFileTree(projectPath, maxDepth = 3) {
    let lineCount = 0;

    /**
     * Recursively build tree lines for a directory.
     * @param {string} dirPath
     * @param {number} depth
     * @param {string} prefix
     * @returns {string}
     */
    const buildTree = (dirPath, depth, prefix) => {
      if (depth > maxDepth || lineCount >= MAX_TREE_LINES) {
        return '';
      }

      let result = '';

      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        // Separate directories and files, sort each group alphabetically
        const dirs = [];
        const files = [];

        for (const entry of entries) {
          if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.DS_Store')) {
            continue;
          }
          if (entry.isDirectory()) {
            dirs.push(entry.name);
          } else {
            files.push(entry.name);
          }
        }

        dirs.sort((a, b) => a.localeCompare(b));
        files.sort((a, b) => a.localeCompare(b));

        // Directories first, then files
        const items = [...dirs.map(d => ({ name: d, isDir: true })), ...files.map(f => ({ name: f, isDir: false }))];

        for (let i = 0; i < items.length; i++) {
          if (lineCount >= MAX_TREE_LINES) {
            result += `${prefix}... (truncated)\n`;
            lineCount++;
            break;
          }

          const item = items[i];
          const isLast = i === items.length - 1;
          const connector = isLast ? '└── ' : '├── ';
          const childPrefix = prefix + (isLast ? '    ' : '│   ');

          if (item.isDir) {
            result += `${prefix}${connector}${item.name}/\n`;
            lineCount++;
            result += buildTree(path.join(dirPath, item.name), depth + 1, childPrefix);
          } else {
            result += `${prefix}${connector}${item.name}\n`;
            lineCount++;
          }
        }
      } catch {
        // Skip inaccessible directories
      }

      return result;
    };

    const rootName = path.basename(projectPath);
    let tree = `${rootName}/\n`;
    lineCount++;
    tree += buildTree(projectPath, 1, '');

    return tree;
  }

  /**
   * Get recent git activity for the project.
   * Returns current branch, last 5 commit summaries, and whether there are
   * uncommitted changes.
   * @param {string} projectPath - Filesystem path to the project root
   * @returns {GitInfo|null} Git information, or null if not a git repo
   */
  getGitInfo(projectPath) {
    try {
      const execOpts = { cwd: projectPath, encoding: 'utf-8', timeout: 5000 };

      const branch = execSync('git branch --show-current', execOpts).trim();

      const logOutput = execSync('git log --oneline -5', execOpts).trim();
      const recentCommits = logOutput
        ? logOutput.split('\n').map(line => line.trim())
        : [];

      const statusOutput = execSync('git status --porcelain', execOpts).trim();
      const uncommittedChanges = statusOutput.length > 0;

      return {
        branch,
        recentCommits,
        uncommittedChanges,
      };
    } catch {
      // Not a git repository or git not available
      return null;
    }
  }

  /**
   * Build a context string optimized for a specific plan step.
   * Combines all context sources into a single formatted string, with extra
   * emphasis on information relevant to the given step.
   * @param {string} projectId
   * @param {string} projectPath - Filesystem path to the project root
   * @param {Object} project - Project data (name, description, rules)
   * @param {Object} step - The current plan step
   * @param {string} step.title - Step title
   * @param {string} [step.description] - Step description
   * @param {string} [step.type] - Step type (e.g. 'code', 'test', 'deploy')
   * @returns {Promise<string>} Formatted context string
   */
  async buildStepContext(projectId, projectPath, project, step) {
    const { buildSystem, conventions, gitInfo, fileTree, memories } =
      await this.buildFullContext(projectId, projectPath, project);

    const sections = [];

    // Project overview
    sections.push(`## Project: ${project.name}`);
    if (project.description) {
      sections.push(project.description);
    }

    // Current step
    sections.push(`\n## Current Step: ${step.title}`);
    if (step.description) {
      sections.push(step.description);
    }

    // Build system
    sections.push('\n## Build System');
    sections.push(`Language: ${buildSystem.language}`);
    sections.push(`Package Manager: ${buildSystem.packageManager}`);
    if (buildSystem.framework) {
      sections.push(`Framework: ${buildSystem.framework}`);
    }
    if (buildSystem.testRunner) {
      sections.push(`Test Runner: ${buildSystem.testRunner}`);
    }
    if (Object.keys(buildSystem.scripts).length > 0) {
      sections.push('Scripts:');
      for (const [name, cmd] of Object.entries(buildSystem.scripts)) {
        sections.push(`  ${name}: ${cmd}`);
      }
    }

    // Conventions
    const conventionNames = Object.keys(conventions);
    if (conventionNames.length > 0) {
      sections.push('\n## Conventions');
      for (const filename of conventionNames) {
        sections.push(`### ${filename}`);
        sections.push(conventions[filename]);
      }
    }

    // Project rules
    if (project.rules && project.rules.length > 0) {
      sections.push('\n## Project Rules');
      for (const rule of project.rules) {
        sections.push(`- ${rule}`);
      }
    }

    // Git info
    if (gitInfo) {
      sections.push('\n## Git Status');
      sections.push(`Branch: ${gitInfo.branch}`);
      sections.push(`Uncommitted changes: ${gitInfo.uncommittedChanges ? 'Yes' : 'No'}`);
      if (gitInfo.recentCommits.length > 0) {
        sections.push('Recent commits:');
        for (const commit of gitInfo.recentCommits) {
          sections.push(`  ${commit}`);
        }
      }
    }

    // File tree
    if (fileTree) {
      sections.push('\n## File Structure');
      sections.push('```');
      sections.push(fileTree);
      sections.push('```');
    }

    // Memories
    if (memories) {
      sections.push(`\n${memories}`);
    }

    return sections.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a one-line project summary from project data and detected build system.
   * @param {Object} project
   * @param {BuildSystem} buildSystem
   * @returns {string}
   * @private
   */
  _buildSummary(project, buildSystem) {
    const parts = [project.name];

    if (buildSystem.framework) {
      parts.push(`(${buildSystem.framework})`);
    }

    parts.push(`— ${buildSystem.language}`);

    if (buildSystem.testRunner) {
      parts.push(`with ${buildSystem.testRunner}`);
    }

    if (project.description) {
      parts.push(`— ${project.description}`);
    }

    return parts.join(' ');
  }

  /**
   * Assemble all context pieces into a single formatted string.
   * @param {Object} pieces
   * @returns {string}
   * @private
   */
  _assembleFullContext({ summary, buildSystem, conventions, gitInfo, fileTree, memories, project }) {
    const sections = [];

    sections.push(`# ${summary}`);

    // Build system
    sections.push('\n## Build System');
    sections.push(`- Language: ${buildSystem.language}`);
    sections.push(`- Package Manager: ${buildSystem.packageManager}`);
    if (buildSystem.framework) {
      sections.push(`- Framework: ${buildSystem.framework}`);
    }
    if (buildSystem.testRunner) {
      sections.push(`- Test Runner: ${buildSystem.testRunner}`);
    }
    if (Object.keys(buildSystem.scripts).length > 0) {
      sections.push('- Scripts:');
      for (const [name, cmd] of Object.entries(buildSystem.scripts)) {
        sections.push(`  - \`${name}\`: \`${cmd}\``);
      }
    }

    // Conventions
    const conventionNames = Object.keys(conventions);
    if (conventionNames.length > 0) {
      sections.push('\n## Conventions');
      for (const filename of conventionNames) {
        sections.push(`### ${filename}`);
        sections.push(conventions[filename]);
      }
    }

    // Project rules
    if (project.rules && project.rules.length > 0) {
      sections.push('\n## Project Rules');
      for (const rule of project.rules) {
        sections.push(`- ${rule}`);
      }
    }

    // Git info
    if (gitInfo) {
      sections.push('\n## Git');
      sections.push(`- Branch: ${gitInfo.branch}`);
      sections.push(`- Uncommitted changes: ${gitInfo.uncommittedChanges ? 'Yes' : 'No'}`);
      if (gitInfo.recentCommits.length > 0) {
        sections.push('- Recent commits:');
        for (const commit of gitInfo.recentCommits) {
          sections.push(`  - ${commit}`);
        }
      }
    }

    // File tree
    if (fileTree) {
      sections.push('\n## File Structure');
      sections.push('```');
      sections.push(fileTree);
      sections.push('```');
    }

    // Memories
    if (memories) {
      sections.push(`\n${memories}`);
    }

    return sections.join('\n');
  }

  /**
   * Check if a file exists at the given path.
   * @param {string} filePath
   * @returns {boolean}
   * @private
   */
  _fileExists(filePath) {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }

  /**
   * Safely read a file's content. Returns null if the file doesn't exist or is unreadable.
   * @param {string} filePath
   * @returns {string|null}
   * @private
   */
  _readFileSafe(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Check if a directory contains any files with a given extension (top-level only).
   * @param {string} dirPath
   * @param {string} ext - Extension including the dot, e.g. '.py'
   * @returns {boolean}
   * @private
   */
  _hasFilesWithExtension(dirPath, ext) {
    try {
      const entries = fs.readdirSync(dirPath);
      return entries.some(name => name.endsWith(ext));
    } catch {
      return false;
    }
  }
}

export const contextBuilder = new ContextBuilder();
export default contextBuilder;
