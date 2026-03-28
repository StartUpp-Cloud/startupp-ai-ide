import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { getDB } from './db.js';

/** Maximum number of activity entries retained in the database */
const MAX_ACTIVITIES = 10_000;

/** Interval (ms) between batched writes to LowDB */
const FLUSH_INTERVAL_MS = 3_000;

/**
 * Valid activity type strings.
 * @typedef {'step-started'|'step-completed'|'step-failed'|'step-retried'
 *   |'git-commit'|'git-branch'|'git-rollback'
 *   |'test-passed'|'test-failed'
 *   |'safety-blocked'|'safety-warning'
 *   |'orchestrator-started'|'orchestrator-paused'|'orchestrator-completed'
 *   |'user-intervention'|'memory-learned'|'auto-response-sent'|'context-built'
 * } ActivityType
 */

/**
 * @typedef {Object} ActivityEntry
 * @property {string} id - UUID v4
 * @property {string} timestamp - ISO 8601 string
 * @property {string} projectId
 * @property {string} [planId]
 * @property {string} [executionId]
 * @property {string} [sessionId]
 * @property {ActivityType} type
 * @property {string} title
 * @property {string} [detail]
 * @property {Object} [metadata] - Type-specific data
 * @property {number} [duration] - Duration in milliseconds
 */

/**
 * Logs autonomous actions for observability.
 *
 * Entries are buffered in memory and flushed to LowDB every 3 seconds to avoid
 * excessive disk writes. An `'entry'` event is emitted immediately so that
 * WebSocket listeners can broadcast in real time without waiting for the flush.
 *
 * @extends EventEmitter
 */
class ActivityFeed extends EventEmitter {
  constructor() {
    super();

    /** @type {ActivityEntry[]} */
    this.writeBuffer = [];

    /** @type {ReturnType<typeof setTimeout> | null} */
    this.flushTimer = null;
  }

  /**
   * Log an activity entry.
   *
   * The entry is enriched with an `id` and `timestamp`, pushed into a write
   * buffer for batched persistence, and emitted as an `'entry'` event
   * immediately for real-time consumers.
   *
   * @param {Object} entry
   * @param {string} entry.projectId
   * @param {string} [entry.planId]
   * @param {string} [entry.executionId]
   * @param {string} [entry.sessionId]
   * @param {ActivityType} entry.type
   * @param {string} entry.title
   * @param {string} [entry.detail]
   * @param {Object} [entry.metadata] - Type-specific data
   * @param {number} [entry.duration] - Duration in milliseconds
   * @returns {ActivityEntry} The enriched entry (with id and timestamp)
   */
  log(entry) {
    /** @type {ActivityEntry} */
    const enriched = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    // Buffer for batched database write
    this.writeBuffer.push(enriched);
    this._scheduleFlush();

    // Emit immediately for real-time WebSocket broadcasting
    this.emit('entry', enriched);

    return enriched;
  }

  /**
   * Get activities for a project, sorted by timestamp descending.
   *
   * @param {string} projectId
   * @param {Object} [options]
   * @param {number} [options.limit=50] - Maximum entries to return
   * @param {number} [options.offset=0] - Number of entries to skip
   * @param {string[]|null} [options.types=null] - Filter by activity type(s)
   * @returns {ActivityEntry[]}
   */
  getByProject(projectId, { limit = 50, offset = 0, types = null } = {}) {
    const db = getDB();
    const activities = db.data.activities || [];

    let filtered = activities.filter((a) => a.projectId === projectId);

    if (types && types.length > 0) {
      const typeSet = new Set(types);
      filtered = filtered.filter((a) => typeSet.has(a.type));
    }

    return filtered
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(offset, offset + limit);
  }

  /**
   * Get activities for a specific plan, sorted by timestamp descending.
   *
   * @param {string} planId
   * @param {Object} [options]
   * @param {number} [options.limit=100] - Maximum entries to return
   * @returns {ActivityEntry[]}
   */
  getByPlan(planId, { limit = 100 } = {}) {
    const db = getDB();
    const activities = db.data.activities || [];

    return activities
      .filter((a) => a.planId === planId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  /**
   * Get recent activities across all projects, sorted by timestamp descending.
   *
   * @param {number} [limit=50] - Maximum entries to return
   * @returns {ActivityEntry[]}
   */
  getRecent(limit = 50) {
    const db = getDB();
    const activities = db.data.activities || [];

    return [...activities]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  /**
   * Flush buffered writes to the database.
   *
   * All entries in the write buffer are appended to `db.data.activities`.
   * If the collection exceeds {@link MAX_ACTIVITIES}, the oldest entries are
   * pruned to keep the store bounded.
   *
   * @returns {Promise<void>}
   */
  async flush() {
    if (this.writeBuffer.length === 0) {
      return;
    }

    // Drain the buffer atomically so new entries during the async write
    // are captured in the next flush cycle.
    const batch = this.writeBuffer.splice(0, this.writeBuffer.length);

    const db = getDB();

    if (!db.data.activities) {
      db.data.activities = [];
    }

    db.data.activities.push(...batch);

    // Prune oldest entries if the collection exceeds the cap
    if (db.data.activities.length > MAX_ACTIVITIES) {
      // Sort descending so we can keep the most recent entries
      db.data.activities.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      db.data.activities = db.data.activities.slice(0, MAX_ACTIVITIES);
    }

    await db.write();
  }

  /**
   * Schedule a debounced flush. Resets the timer on each call so that rapid
   * bursts of log entries are batched into a single write.
   *
   * @private
   */
  _scheduleFlush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    this.flushTimer = setTimeout(async () => {
      this.flushTimer = null;
      try {
        await this.flush();
      } catch (err) {
        console.error('[ActivityFeed] Failed to flush entries:', err);
      }
    }, FLUSH_INTERVAL_MS);
  }
}

export const activityFeed = new ActivityFeed();
export default activityFeed;
