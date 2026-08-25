import { v4 as uuidv4 } from 'uuid';

const TOOL_NAMES = new Set(['claude', 'codex', 'opencode', 'aider', 'ollama', 'shell']);

/**
 * Risk rules for optional human gates.
 * Keep these narrow — StartUpp is a localhost/LAN IDE where the orchestrator
 * should proceed by default. Only exceptional, irreversible ops escalate.
 */
const RISK_RULES = [
  {
    risk: 'critical',
    pattern: /(?:\brm\s+-rf\s+(?:\/|~|\$HOME|\.)|\bdrop\s+(?:database|table)\b|\b(?:git\s+push\b[^\n]*\s--force|--force\s+push|force[- ]push)\b|\b(?:delete|wipe|destroy)\s+production\b|\bformat\s+(?:the\s+)?(?:disk|drive)\b)/i,
    reason: 'destructive or irreversible production operation',
  },
  {
    risk: 'high',
    pattern: /(?:\bdeploy(?:ing|ment)?\s+to\s+prod(?:uction)?\b|\bproduction\s+deploy(?:ment|ing)?\b|\bnpm\s+publish\b|\bcurl\s+[^\n]*\|\s*(?:bash|sh)\b|\bchmod\s+-R\s+777\b)/i,
    reason: 'explicit production publish or dangerous shell pipeline',
  },
  {
    risk: 'medium',
    pattern: /(?:\b(?:install|upgrade|migrate|deploy|publish|release)\b|\b(?:write|edit|modify|create|delete|remove)\b|\brun\s+tests?\b)/i,
    reason: 'workspace mutation',
  },
];

export const RUN_RISK_ORDER = ['safe', 'low', 'medium', 'high', 'critical'];

function normalizeList(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 100);
}

export function normalizeRunPolicy(policy = {}, { tool = 'claude', projectRuntime = 'container' } = {}) {
  const requestedTool = policy.tool || tool;
  const normalizedTool = TOOL_NAMES.has(requestedTool) ? requestedTool : 'claude';
  const effectiveRuntime = policy.projectRuntime || projectRuntime;
  const defaultTools = normalizedTool === 'shell' ? ['read', 'shell'] : ['read', 'write', 'shell', 'test'];
  return {
    version: 1,
    allowedTools: normalizeList(policy.allowedTools, defaultTools),
    filesystemScope: policy.filesystemScope === 'workspace' ? 'workspace' : 'project',
    networkScope: ['none', 'container', 'host', 'provider-required'].includes(policy.networkScope)
      ? policy.networkScope : 'provider-required',
    containerBoundary: effectiveRuntime === 'host' ? 'host-project' : 'project-container',
    // Default: orchestrator proceeds without asking. Opt into on-risk/always explicitly.
    approvalMode: ['never', 'on-risk', 'always'].includes(policy.approvalMode) ? policy.approvalMode : 'never',
    // When on-risk is enabled, still auto-confirm non-critical command prompts.
    autoConfirmCommands: policy.autoConfirmCommands !== false,
    projectRuntime: effectiveRuntime,
    tool: normalizedTool,
    redaction: 'secrets-and-tokens',
  };
}

export function classifyRunRisk(text = '') {
  const source = String(text || '');
  for (const rule of RISK_RULES) {
    if (rule.pattern.test(source)) return { risk: rule.risk, reasons: [rule.reason] };
  }
  return { risk: 'safe', reasons: [] };
}

export function buildApprovalRequest({ runId, operation, policy, risk, reasons = [] } = {}) {
  return {
    id: uuidv4(),
    runId,
    type: 'run-policy-escalation',
    status: 'pending',
    operation: String(operation || '').trim().slice(0, 500),
    risk: risk || 'critical',
    reasons: reasons.slice(0, 8),
    policy: normalizeRunPolicy(policy),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Human approval is exceptional. With default policy (never + autoConfirm),
 * only an explicit approvalMode of "always", or on-risk + critical risk,
 * will pause a run.
 */
export function needsRunApproval({ content = '', policy = {} } = {}) {
  const normalized = normalizeRunPolicy(policy);
  const assessment = classifyRunRisk(content);
  if (normalized.approvalMode === 'never') {
    return { ...assessment, requiresApproval: false };
  }
  if (normalized.approvalMode === 'always') {
    return { ...assessment, requiresApproval: true };
  }
  // on-risk: only critical ops pause the run. High-risk still proceeds when
  // autoConfirmCommands is enabled (the default).
  const critical = assessment.risk === 'critical';
  const highWithoutAutoconfirm = assessment.risk === 'high' && !normalized.autoConfirmCommands;
  const requiresApproval = critical || highWithoutAutoconfirm;
  return { ...assessment, requiresApproval };
}

export function summarizePolicy(policy = {}) {
  const normalized = normalizeRunPolicy(policy);
  return {
    tools: normalized.allowedTools,
    filesystem: normalized.filesystemScope,
    network: normalized.networkScope,
    boundary: normalized.containerBoundary,
    approvals: normalized.approvalMode,
  };
}
