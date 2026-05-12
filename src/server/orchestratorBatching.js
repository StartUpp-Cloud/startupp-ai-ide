/**
 * Pure task-batching logic for the agent orchestrator.
 * Extracted so it can be tested without importing node:sqlite or other heavy deps.
 */

/**
 * Partition tasks into sequential batches: contiguous research/investigation
 * tasks explicitly marked parallelSafe are grouped into a single parallel
 * batch; all other tasks each become their own serial batch.
 *
 * @param {Array<{parallelSafe: boolean, [key: string]: any}>} tasks
 * @returns {Array<{parallel: boolean, tasks: Array}>}
 */
export function batchTasks(tasks) {
  const batches = [];
  let parallelGroup = [];

  const isParallelEligible = (task) => (
    task.parallelSafe === true
    && ['research', 'investigation'].includes(task.taskType)
  );

  const flushParallel = () => {
    if (parallelGroup.length > 0) {
      batches.push({ parallel: true, tasks: parallelGroup });
      parallelGroup = [];
    }
  };

  for (const task of tasks) {
    if (isParallelEligible(task)) {
      parallelGroup.push(task);
    } else {
      flushParallel();
      batches.push({ parallel: false, tasks: [task] });
    }
  }
  flushParallel();
  return batches;
}
