/**
 * Memory Store
 * Provides per-project knowledge that persists across sessions and grows over time.
 * The LLM uses this context to make better decisions by learning from past
 * successes, failures, user corrections, and detected patterns.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDB } from './db.js';

/** @typedef {'pattern' | 'preference' | 'failure' | 'success' | 'convention' | 'dependency'} MemoryType */
/** @typedef {'build' | 'test' | 'git' | 'style' | 'architecture'} MemoryCategory */
/** @typedef {'step-failure' | 'step-success' | 'user-correction' | 'auto-detected' | 'context-scan'} MemorySource */

/**
 * @typedef {Object} Memory
 * @property {string} id
 * @property {string} projectId
 * @property {MemoryType} type
 * @property {MemoryCategory} category
 * @property {string} content
 * @property {MemorySource} source
 * @property {number} confidence - Range [0, 1], starts at 0.5
 * @property {number} usageCount - Starts at 0
 * @property {string|null} lastUsedAt - ISO timestamp
 * @property {string} createdAt - ISO timestamp
 * @property {string} updatedAt - ISO timestamp
 * @property {string[]} tags
 * @property {string[]} relatedFiles
 */

class MemoryStore {
  /**
   * Learn something new about a project.
   * Deduplicates against existing entries using content similarity.
   * @param {string} projectId
   * @param {Object} memory
   * @param {MemoryType} memory.type - 'pattern' | 'preference' | 'failure' | 'success' | 'convention' | 'dependency'
   * @param {MemoryCategory} memory.category - e.g. 'build', 'test', 'git', 'style', 'architecture'
   * @param {string} memory.content - The knowledge to store
   * @param {MemorySource} memory.source - How learned: 'step-failure', 'step-success', 'user-correction', 'auto-detected', 'context-scan'
   * @param {string[]} [memory.tags] - Optional tags for filtering
   * @param {string[]} [memory.relatedFiles] - Optional related file paths
   * @returns {Promise<Memory|null>} The created memory or null if duplicate
   */
  async learn(projectId, memory) {
    const db = getDB();

    if (!db.data.memories) {
      db.data.memories = [];
    }

    // Check for duplicates among existing project memories
    const projectMemories = db.data.memories.filter(
      (m) => m.projectId === projectId
    );

    for (const existing of projectMemories) {
      if (this._isSimilar(memory.content, existing.content)) {
        // Duplicate found — reinforce the existing entry instead
        await this.reinforce(existing.id);
        return null;
      }
    }

    const now = new Date().toISOString();

    /** @type {Memory} */
    const entry = {
      id: uuidv4(),
      projectId,
      type: memory.type,
      category: memory.category,
      content: memory.content,
      source: memory.source,
      confidence: 0.5,
      usageCount: 0,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
      tags: memory.tags || [],
      relatedFiles: memory.relatedFiles || [],
    };

    db.data.memories.push(entry);
    await db.write();

    return entry;
  }

  /**
   * Recall relevant memories for a project.
   * Increments usageCount and updates lastUsedAt for returned entries.
   * @param {string} projectId
   * @param {Object} [options]
   * @param {string[]} [options.categories] - Filter by categories
   * @param {string[]} [options.types] - Filter by types
   * @param {number} [options.limit] - Max entries (default 20)
   * @param {number} [options.minConfidence] - Min confidence threshold (default 0.3)
   * @returns {Memory[]} Matching memories sorted by confidence desc, then recency
   */
  recall(projectId, options = {}) {
    const db = getDB();
    const {
      categories = null,
      types = null,
      limit = 20,
      minConfidence = 0.3,
    } = options;

    if (!db.data.memories) {
      return [];
    }

    let results = db.data.memories.filter((m) => {
      if (m.projectId !== projectId) return false;
      if (m.confidence < minConfidence) return false;
      if (categories && !categories.includes(m.category)) return false;
      if (types && !types.includes(m.type)) return false;
      return true;
    });

    // Sort by confidence descending, then by recency (updatedAt descending)
    results.sort((a, b) => {
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

    // Apply limit
    results = results.slice(0, limit);

    // Update usage stats for returned entries (fire-and-forget)
    const now = new Date().toISOString();
    for (const memory of results) {
      memory.usageCount += 1;
      memory.lastUsedAt = now;
    }

    return results;
  }

  /**
   * Record a step failure for future avoidance.
   * @param {string} projectId
   * @param {Object} details
   * @param {string} details.stepDescription - What was attempted
   * @param {string} details.errorOutput - The error that occurred
   * @param {string} [details.resolution] - How it was resolved (if known)
   * @returns {Promise<Memory|null>}
   */
  async recordFailure(projectId, { stepDescription, errorOutput, resolution }) {
    const content = resolution
      ? `${stepDescription} — Error: ${errorOutput} — Resolution: ${resolution}`
      : `${stepDescription} — Error: ${errorOutput}`;

    return this.learn(projectId, {
      type: 'failure',
      category: 'build',
      content,
      source: 'step-failure',
      tags: ['failure', 'error'],
    });
  }

  /**
   * Record a step success to reinforce patterns.
   * If a similar memory already exists, it will be reinforced instead of duplicated.
   * @param {string} projectId
   * @param {Object} details
   * @param {string} details.stepDescription - What was accomplished
   * @param {string} details.approach - The approach that worked
   * @returns {Promise<Memory|null>}
   */
  async recordSuccess(projectId, { stepDescription, approach }) {
    const content = `${stepDescription} — Approach: ${approach}`;

    return this.learn(projectId, {
      type: 'success',
      category: 'build',
      content,
      source: 'step-success',
      tags: ['success'],
    });
  }

  /**
   * Record when the user manually corrects the AI.
   * Stored as a preference so the AI can avoid repeating the mistake.
   * @param {string} projectId
   * @param {Object} details
   * @param {string} details.original - What the AI originally did/said
   * @param {string} details.corrected - What the user corrected it to
   * @param {string} [details.context] - Additional context about the correction
   * @returns {Promise<Memory|null>}
   */
  async recordUserCorrection(projectId, { original, corrected, context }) {
    const content = context
      ? `User corrected: "${original}" → "${corrected}" (context: ${context})`
      : `User corrected: "${original}" → "${corrected}"`;

    return this.learn(projectId, {
      type: 'preference',
      category: 'style',
      content,
      source: 'user-correction',
      tags: ['user-correction', 'preference'],
    });
  }

  /**
   * Build a formatted context string for LLM injection.
   * Returns a human-readable summary of project knowledge.
   *
   * Example output:
   * ```
   * ## Project Knowledge
   * - [pattern/build] npm run build fails if .env is missing (confidence: 0.9)
   * - [failure/test] Auth tests fail when DB is not seeded (confidence: 0.7)
   * - [preference/style] User prefers functional components over classes (confidence: 0.8)
   * ```
   *
   * @param {string} projectId
   * @param {Object} [options]
   * @param {number} [options.maxTokens] - Rough token budget (default 2000, ~4 chars/token)
   * @param {string[]|null} [options.categories] - Filter by categories
   * @returns {string} Formatted context string, or empty string if no memories
   */
  buildContextForLLM(projectId, { maxTokens = 2000, categories = null } = {}) {
    const memories = this.recall(projectId, { categories });

    if (memories.length === 0) {
      return '';
    }

    const maxChars = maxTokens * 4;
    const lines = ['## Project Knowledge'];
    let currentLength = lines[0].length;

    for (const memory of memories) {
      const line = `- [${memory.type}/${memory.category}] ${memory.content} (confidence: ${memory.confidence.toFixed(1)})`;

      // Check if adding this line would exceed the budget
      if (currentLength + line.length + 1 > maxChars) {
        break;
      }

      lines.push(line);
      currentLength += line.length + 1; // +1 for newline
    }

    return lines.join('\n');
  }

  /**
   * Boost confidence of a memory (called when knowledge is confirmed useful).
   * Increases confidence by 0.1, capped at 1.0.
   * @param {string} memoryId
   * @returns {Promise<Memory|null>} The updated memory, or null if not found
   */
  async reinforce(memoryId) {
    const db = getDB();

    if (!db.data.memories) {
      return null;
    }

    const memory = db.data.memories.find((m) => m.id === memoryId);
    if (!memory) {
      return null;
    }

    memory.confidence = Math.min(1.0, memory.confidence + 0.1);
    memory.updatedAt = new Date().toISOString();

    await db.write();

    return memory;
  }

  /**
   * Get all memories for a project (for the UI).
   * @param {string} projectId
   * @returns {Memory[]} All memories for the project, sorted by creation date descending
   */
  getAll(projectId) {
    const db = getDB();

    if (!db.data.memories) {
      return [];
    }

    return db.data.memories
      .filter((m) => m.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Delete a memory by id.
   * @param {string} memoryId
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  async remove(memoryId) {
    const db = getDB();

    if (!db.data.memories) {
      return false;
    }

    const index = db.data.memories.findIndex((m) => m.id === memoryId);
    if (index === -1) {
      return false;
    }

    db.data.memories.splice(index, 1);
    await db.write();

    return true;
  }

  /**
   * Prune stale memories that are old and low-confidence.
   * Removes entries older than maxAgeDays with confidence below minConfidence.
   * @param {string} projectId
   * @param {Object} [options]
   * @param {number} [options.maxAgeDays] - Max age in days (default 90)
   * @param {number} [options.minConfidence] - Min confidence to keep (default 0.2)
   * @returns {Promise<number>} Number of memories pruned
   */
  async prune(projectId, { maxAgeDays = 90, minConfidence = 0.2 } = {}) {
    const db = getDB();

    if (!db.data.memories) {
      return 0;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

    const before = db.data.memories.length;

    db.data.memories = db.data.memories.filter((m) => {
      if (m.projectId !== projectId) return true; // Keep other projects' memories
      const createdAt = new Date(m.createdAt);
      const isOld = createdAt < cutoffDate;
      const isLowConfidence = m.confidence < minConfidence;
      // Remove only if both old AND low-confidence
      return !(isOld && isLowConfidence);
    });

    const pruned = before - db.data.memories.length;

    if (pruned > 0) {
      await db.write();
    }

    return pruned;
  }

  /**
   * Check if content is similar to existing memory (simple dedup).
   * Uses Jaccard similarity based on word overlap ratio.
   * @param {string} content1 - First content string
   * @param {string} content2 - Second content string
   * @param {number} [threshold] - Similarity threshold (default 0.7)
   * @returns {boolean} True if the two strings are considered similar
   * @private
   */
  _isSimilar(content1, content2, threshold = 0.7) {
    const words1 = new Set(content1.toLowerCase().split(/\s+/).filter(Boolean));
    const words2 = new Set(content2.toLowerCase().split(/\s+/).filter(Boolean));

    if (words1.size === 0 && words2.size === 0) {
      return true;
    }

    if (words1.size === 0 || words2.size === 0) {
      return false;
    }

    // Calculate Jaccard similarity: |intersection| / |union|
    let intersectionSize = 0;
    for (const word of words1) {
      if (words2.has(word)) {
        intersectionSize++;
      }
    }

    const unionSize = words1.size + words2.size - intersectionSize;
    const similarity = intersectionSize / unionSize;

    return similarity >= threshold;
  }
}

export const memoryStore = new MemoryStore();
export default memoryStore;
