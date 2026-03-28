import { execSync } from 'child_process';
import path from 'path';

const EXEC_OPTIONS = (projectPath) => ({
  cwd: projectPath,
  encoding: 'utf-8',
  stdio: 'pipe',
});

class GitManager {
  /**
   * Check if a directory is a git repository.
   * @param {string} projectPath - Absolute path to the project directory.
   * @returns {boolean} True if the directory is a git repository.
   */
  isGitRepo(projectPath) {
    try {
      execSync('git rev-parse --is-inside-work-tree', EXEC_OPTIONS(projectPath));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create and checkout a new branch for a plan.
   * Branch naming convention: auto/<slug>-<timestamp>
   * @param {string} projectPath - Absolute path to the project directory.
   * @param {string} planTitle - Human-readable plan title to slugify.
   * @returns {string|null} The created branch name, or null on failure.
   */
  createBranch(projectPath, planTitle) {
    if (!this.isGitRepo(projectPath)) return null;

    try {
      const slug = planTitle
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 50);

      const timestamp = Date.now();
      const branchName = `auto/${slug}-${timestamp}`;

      execSync(`git checkout -b ${branchName}`, EXEC_OPTIONS(projectPath));
      return branchName;
    } catch (err) {
      console.error('[GitManager] Failed to create branch:', err.message);
      return null;
    }
  }

  /**
   * Get the current branch name.
   * @param {string} projectPath - Absolute path to the project directory.
   * @returns {string|null} Current branch name, or null on failure.
   */
  getCurrentBranch(projectPath) {
    if (!this.isGitRepo(projectPath)) return null;

    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', EXEC_OPTIONS(projectPath));
      return branch.trim();
    } catch (err) {
      console.error('[GitManager] Failed to get current branch:', err.message);
      return null;
    }
  }

  /**
   * Stage all changes and commit with a message.
   * @param {string} projectPath - Absolute path to the project directory.
   * @param {string} message - Commit message.
   * @returns {{ commitHash: string, filesChanged: number, insertions: number, deletions: number }|null}
   *   Commit details, or null if nothing to commit or on failure.
   */
  commitStep(projectPath, message) {
    if (!this.isGitRepo(projectPath)) return null;

    try {
      execSync('git add -A', EXEC_OPTIONS(projectPath));

      // Check if there is anything staged to commit
      const staged = execSync('git diff --cached --stat', EXEC_OPTIONS(projectPath)).trim();
      if (!staged) return null;

      // Parse stats from the staged diff summary
      const stats = this._parseStats(staged);

      execSync(`git commit -m ${this._shellEscape(message)}`, EXEC_OPTIONS(projectPath));

      const commitHash = execSync('git rev-parse HEAD', EXEC_OPTIONS(projectPath)).trim();

      return {
        commitHash,
        filesChanged: stats.filesChanged,
        insertions: stats.insertions,
        deletions: stats.deletions,
      };
    } catch (err) {
      console.error('[GitManager] Failed to commit:', err.message);
      return null;
    }
  }

  /**
   * Create a safety checkpoint as a tagged commit.
   * If there are uncommitted changes, they are committed first.
   * @param {string} projectPath - Absolute path to the project directory.
   * @param {string} label - Human-readable label for the checkpoint.
   * @returns {string|null} The tag name, or null on failure.
   */
  createCheckpoint(projectPath, label) {
    if (!this.isGitRepo(projectPath)) return null;

    try {
      const slug = label
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 40);

      const timestamp = Date.now();
      const tagName = `checkpoint/${slug}-${timestamp}`;

      // Commit any pending changes before tagging
      if (this.hasChanges(projectPath)) {
        this.commitStep(projectPath, `checkpoint: ${label}`);
      }

      execSync(`git tag ${tagName}`, EXEC_OPTIONS(projectPath));
      return tagName;
    } catch (err) {
      console.error('[GitManager] Failed to create checkpoint:', err.message);
      return null;
    }
  }

  /**
   * Rollback the working tree to a specific commit hash.
   * Uses `git reset --hard` to discard all changes after the target commit.
   * @param {string} projectPath - Absolute path to the project directory.
   * @param {string} commitHash - The commit hash to roll back to.
   * @returns {boolean} True if the rollback succeeded.
   */
  rollback(projectPath, commitHash) {
    if (!this.isGitRepo(projectPath)) return false;

    try {
      execSync(`git reset --hard ${commitHash}`, EXEC_OPTIONS(projectPath));
      return true;
    } catch (err) {
      console.error('[GitManager] Failed to rollback:', err.message);
      return false;
    }
  }

  /**
   * Get the diff between two commits, or between a commit and the working tree.
   * @param {string} projectPath - Absolute path to the project directory.
   * @param {string} [fromCommit] - Starting commit hash (defaults to HEAD).
   * @param {string} [toCommit] - Ending commit hash (omit for working tree).
   * @returns {{ summary: string, files: string[], stats: { filesChanged: number, insertions: number, deletions: number } }|null}
   *   Diff details, or null on failure.
   */
  getDiff(projectPath, fromCommit, toCommit) {
    if (!this.isGitRepo(projectPath)) return null;

    try {
      const range = toCommit
        ? `${fromCommit || 'HEAD'}..${toCommit}`
        : fromCommit
          ? `${fromCommit}`
          : '';

      const statCmd = range ? `git diff --stat ${range}` : 'git diff --stat';
      const namesCmd = range ? `git diff --name-only ${range}` : 'git diff --name-only';

      const summary = execSync(statCmd, EXEC_OPTIONS(projectPath)).trim();
      const namesOutput = execSync(namesCmd, EXEC_OPTIONS(projectPath)).trim();
      const files = namesOutput ? namesOutput.split('\n').map((f) => f.trim()) : [];
      const stats = this._parseStats(summary);

      return { summary, files, stats };
    } catch (err) {
      console.error('[GitManager] Failed to get diff:', err.message);
      return null;
    }
  }

  /**
   * Get the current git status of the working tree.
   * @param {string} projectPath - Absolute path to the project directory.
   * @returns {{ branch: string|null, clean: boolean, modified: string[], added: string[], deleted: string[], untracked: string[] }|null}
   *   Status details, or null on failure.
   */
  getStatus(projectPath) {
    if (!this.isGitRepo(projectPath)) return null;

    try {
      const branch = this.getCurrentBranch(projectPath);
      const porcelain = execSync('git status --porcelain', EXEC_OPTIONS(projectPath)).trim();

      const modified = [];
      const added = [];
      const deleted = [];
      const untracked = [];

      if (porcelain) {
        for (const line of porcelain.split('\n')) {
          const code = line.substring(0, 2);
          const file = line.substring(3).trim();

          if (code === '??') {
            untracked.push(file);
          } else if (code.includes('D')) {
            deleted.push(file);
          } else if (code.includes('A')) {
            added.push(file);
          } else if (code.includes('M') || code.includes('R')) {
            modified.push(file);
          }
        }
      }

      return {
        branch,
        clean: !porcelain,
        modified,
        added,
        deleted,
        untracked,
      };
    } catch (err) {
      console.error('[GitManager] Failed to get status:', err.message);
      return null;
    }
  }

  /**
   * Get recent commits from the current branch.
   * @param {string} projectPath - Absolute path to the project directory.
   * @param {number} [count=10] - Number of commits to retrieve.
   * @returns {Array<{ hash: string, shortHash: string, message: string, author: string, date: string }>}
   *   List of recent commits, or an empty array on failure.
   */
  getRecentCommits(projectPath, count = 10) {
    if (!this.isGitRepo(projectPath)) return [];

    try {
      const separator = '||SEP||';
      const format = `%H${separator}%h${separator}%s${separator}%an${separator}%ai`;
      const output = execSync(
        `git log -${count} --pretty=format:"${format}"`,
        EXEC_OPTIONS(projectPath),
      ).trim();

      if (!output) return [];

      return output.split('\n').map((line) => {
        const [hash, shortHash, message, author, date] = line.split(separator);
        return { hash, shortHash, message, author, date };
      });
    } catch (err) {
      console.error('[GitManager] Failed to get recent commits:', err.message);
      return [];
    }
  }

  /**
   * Check if there are uncommitted changes in the working tree.
   * @param {string} projectPath - Absolute path to the project directory.
   * @returns {boolean} True if there are uncommitted changes.
   */
  hasChanges(projectPath) {
    if (!this.isGitRepo(projectPath)) return false;

    try {
      const output = execSync('git status --porcelain', EXEC_OPTIONS(projectPath)).trim();
      return output.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Stash current working tree changes.
   * @param {string} projectPath - Absolute path to the project directory.
   * @param {string} [message] - Optional stash message.
   * @returns {boolean} True if the stash succeeded.
   */
  stash(projectPath, message) {
    if (!this.isGitRepo(projectPath)) return false;

    try {
      const cmd = message
        ? `git stash push -m ${this._shellEscape(message)}`
        : 'git stash push';
      execSync(cmd, EXEC_OPTIONS(projectPath));
      return true;
    } catch (err) {
      console.error('[GitManager] Failed to stash:', err.message);
      return false;
    }
  }

  /**
   * Pop the most recent stash entry.
   * @param {string} projectPath - Absolute path to the project directory.
   * @returns {boolean} True if the stash pop succeeded.
   */
  stashPop(projectPath) {
    if (!this.isGitRepo(projectPath)) return false;

    try {
      execSync('git stash pop', EXEC_OPTIONS(projectPath));
      return true;
    } catch (err) {
      console.error('[GitManager] Failed to pop stash:', err.message);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Parse the summary line of `git diff --stat` output to extract counts.
   * Example: " 3 files changed, 12 insertions(+), 4 deletions(-)"
   * @param {string} statOutput - Raw output from `git diff --stat`.
   * @returns {{ filesChanged: number, insertions: number, deletions: number }}
   * @private
   */
  _parseStats(statOutput) {
    const stats = { filesChanged: 0, insertions: 0, deletions: 0 };
    if (!statOutput) return stats;

    const lines = statOutput.split('\n');
    const summaryLine = lines[lines.length - 1];

    const filesMatch = summaryLine.match(/(\d+)\s+files?\s+changed/);
    const insertionsMatch = summaryLine.match(/(\d+)\s+insertions?\(\+\)/);
    const deletionsMatch = summaryLine.match(/(\d+)\s+deletions?\(-\)/);

    if (filesMatch) stats.filesChanged = parseInt(filesMatch[1], 10);
    if (insertionsMatch) stats.insertions = parseInt(insertionsMatch[1], 10);
    if (deletionsMatch) stats.deletions = parseInt(deletionsMatch[1], 10);

    return stats;
  }

  /**
   * Escape a string for safe use in a shell command.
   * @param {string} str - The string to escape.
   * @returns {string} Shell-safe escaped string.
   * @private
   */
  _shellEscape(str) {
    return `'${str.replace(/'/g, "'\\''")}'`;
  }
}

export const gitManager = new GitManager();
export default gitManager;
