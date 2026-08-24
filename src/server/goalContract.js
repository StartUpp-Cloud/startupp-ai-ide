/**
 * Normalize the user intent that the coding harness carries across routing,
 * retries, recovery, and final verification.
 *
 * The contract is deliberately data-only. It does not attempt to invent
 * acceptance criteria from prose; callers may provide those explicitly and
 * the agent is required to report when they remain unspecified.
 */

export const GOAL_CONTRACT_VERSION = 1;

function normalizeText(value, maxLength = 1200) {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function normalizeList(value, maxItems = 12, maxLength = 500) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(item => normalizeText(item, maxLength))
    .filter(Boolean))].slice(0, maxItems);
}

export function normalizeGoalContract({
  content = '',
  goal = '',
  acceptanceCriteria = [],
  verificationCommands = [],
  deliverables = [],
  constraints = [],
  targetWorkspace = null,
} = {}) {
  const normalizedGoal = normalizeText(goal || content, 2000);
  return {
    version: GOAL_CONTRACT_VERSION,
    objective: normalizedGoal,
    acceptanceCriteria: normalizeList(acceptanceCriteria),
    verificationCommands: normalizeList(verificationCommands, 12, 300),
    deliverables: normalizeList(deliverables),
    constraints: normalizeList(constraints),
    targetWorkspace: normalizeText(targetWorkspace, 500) || null,
    criteriaSpecified: normalizeList(acceptanceCriteria).length > 0,
  };
}

export function formatGoalContract(contract = {}) {
  const normalized = normalizeGoalContract(contract);
  const lines = [
    `Contract version: ${normalized.version}`,
    `Objective: ${normalized.objective || '(not specified)'}`,
    `Acceptance criteria: ${normalized.acceptanceCriteria.length ? normalized.acceptanceCriteria.join(' | ') : '(not specified; derive only from the objective and report that clearly)'}`,
    `Verification commands: ${normalized.verificationCommands.length ? normalized.verificationCommands.join(' | ') : '(choose the smallest relevant checks and report the exact commands)'}`,
    `Deliverables: ${normalized.deliverables.length ? normalized.deliverables.join(' | ') : '(not specified)'}`,
    `Constraints: ${normalized.constraints.length ? normalized.constraints.join(' | ') : '(none specified)'}`,
    `Target workspace: ${normalized.targetWorkspace || '(use the IDE-selected workspace)'}`,
  ];
  return lines.join('\n');
}

export default {
  GOAL_CONTRACT_VERSION,
  normalizeGoalContract,
  formatGoalContract,
};
