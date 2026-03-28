/**
 * Task Queue
 * Manages a priority queue of plan executions. Tasks are persisted in the
 * database and processed one at a time. Emits a 'next-task' event when a
 * queued item is ready for execution.
 *
 * @module taskQueue
 */

import { v4 as uuidv4 } from 'uuid';
import { getDB } from './db.js';
import { EventEmitter } from 'events';

/**
 * @typedef {Object} TaskEntry
 * @property {string}  id           - UUID v4
 * @property {string}  planId       - Associated plan
 * @property {string}  planType     - Type of plan (e.g. 'big-project', 'quick')
 * @property {string}  projectId    - Associated project
 * @property {number}  priority     - Lower number = higher priority
 * @property {'queued'|'running'|'completed'|'failed'|'cancelled'} status
 * @property {string}  addedAt      - ISO timestamp
 * @property {string|null}  startedAt    - ISO timestamp
 * @property {string|null}  completedAt  - ISO timestamp
 * @property {string|null}  executionId  - Orchestrator execution ID once running
 * @property {string|null}  error        - Error message if failed
 */

class TaskQueue extends EventEmitter {
  constructor() {
    super();
    this.processing = false;
  }

  /**
   * Add a task to the queue.
   *
   * @param {string} planId    - The plan to execute
   * @param {string} planType  - Type of plan
   * @param {string} projectId - Associated project
   * @param {number} [priority=10] - Lower number = higher priority
   * @returns {Promise<TaskEntry>} The created task entry
   */
  async enqueue(planId, planType, projectId, priority = 10) {
    const db = getDB();

    if (!db.data.taskQueue) {
      db.data.taskQueue = [];
    }

    /** @type {TaskEntry} */
    const task = {
      id: uuidv4(),
      planId,
      planType,
      projectId,
      priority,
      status: 'queued',
      addedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      executionId: null,
      error: null,
    };

    db.data.taskQueue.push(task);
    await db.write();

    return task;
  }

  /**
   * Get the next queued item by priority (ascending), then by addedAt (ascending).
   *
   * @returns {TaskEntry|null} The next task or null if the queue is empty
   */
  dequeue() {
    const db = getDB();
    const queue = db.data.taskQueue || [];

    const queued = queue
      .filter((t) => t.status === 'queued')
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        return a.addedAt.localeCompare(b.addedAt);
      });

    return queued.length > 0 ? queued[0] : null;
  }

  /**
   * Get the current queue, optionally filtered by project.
   *
   * @param {string|null} [projectId=null] - Filter by project ID
   * @returns {TaskEntry[]} Array of task entries sorted by priority then addedAt
   */
  getQueue(projectId = null) {
    const db = getDB();
    const queue = db.data.taskQueue || [];

    let filtered = queue;
    if (projectId) {
      filtered = queue.filter((t) => t.projectId === projectId);
    }

    return filtered.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.addedAt.localeCompare(b.addedAt);
    });
  }

  /**
   * Cancel a queued task.
   *
   * @param {string} taskId
   * @returns {Promise<boolean>} True if the task was cancelled
   */
  async cancel(taskId) {
    const db = getDB();
    const queue = db.data.taskQueue || [];

    const task = queue.find((t) => t.id === taskId);
    if (!task || task.status !== 'queued') {
      return false;
    }

    task.status = 'cancelled';
    task.completedAt = new Date().toISOString();
    await db.write();

    return true;
  }

  /**
   * Change the priority of a queued task.
   *
   * @param {string} taskId
   * @param {number} newPriority
   * @returns {Promise<boolean>} True if the task was reordered
   */
  async reorder(taskId, newPriority) {
    const db = getDB();
    const queue = db.data.taskQueue || [];

    const task = queue.find((t) => t.id === taskId);
    if (!task || task.status !== 'queued') {
      return false;
    }

    task.priority = newPriority;
    await db.write();

    return true;
  }

  /**
   * Mark a task as running and associate it with an orchestrator execution.
   *
   * @param {string} taskId
   * @param {string} executionId - The orchestrator execution ID
   * @returns {Promise<boolean>} True if the task was marked as running
   */
  async markRunning(taskId, executionId) {
    const db = getDB();
    const queue = db.data.taskQueue || [];

    const task = queue.find((t) => t.id === taskId);
    if (!task || task.status !== 'queued') {
      return false;
    }

    task.status = 'running';
    task.startedAt = new Date().toISOString();
    task.executionId = executionId;
    await db.write();

    return true;
  }

  /**
   * Mark a task as completed.
   *
   * @param {string} taskId
   * @returns {Promise<boolean>} True if the task was marked as completed
   */
  async markCompleted(taskId) {
    const db = getDB();
    const queue = db.data.taskQueue || [];

    const task = queue.find((t) => t.id === taskId);
    if (!task || task.status !== 'running') {
      return false;
    }

    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    await db.write();

    return true;
  }

  /**
   * Mark a task as failed.
   *
   * @param {string} taskId
   * @param {string} error - Error message describing the failure
   * @returns {Promise<boolean>} True if the task was marked as failed
   */
  async markFailed(taskId, error) {
    const db = getDB();
    const queue = db.data.taskQueue || [];

    const task = queue.find((t) => t.id === taskId);
    if (!task || task.status !== 'running') {
      return false;
    }

    task.status = 'failed';
    task.completedAt = new Date().toISOString();
    task.error = error;
    await db.write();

    return true;
  }

  /**
   * Attempt to process the next queued task.
   * Returns the next task if one is available, or null if the queue is empty.
   * Emits a 'next-task' event with the task entry when a task is ready.
   *
   * @returns {TaskEntry|null} The next task to process, or null
   */
  processNext() {
    const next = this.dequeue();
    if (!next) {
      return null;
    }

    this.emit('next-task', next);
    return next;
  }
}

export const taskQueue = new TaskQueue();
export default taskQueue;
