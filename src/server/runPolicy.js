import { v4 as uuidv4 } from 'uuid';

const TOOL_NAMES = new Set(['claude', 'codex', 'opencode', 'aider', 'ollama', 'shell']);
const RISK_RULES = [
  { risk: 'critical', pattern: /(?:rm\s+-rf|drop\s+(?:database|table)|force[- ]push|production\s+deploy|delete\s+production)/i, reason: 'destructive or production operation' },
  { risk: 'high', pattern: /(?:deploy|publish|release|push\s+to|migrate|chmod|curl\s+.*\|\s*(?:bash|sh))/i, reason: 'external or irreversible side effect' },
  { risk: 'medium', pattern: /(?:install|upgrade|write|edit|modify|create|delete|remove|run\s+tests?)/i, reason: 'workspace mutation' },
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
    approvalMode: ['never', 'on-risk', 'always'].includes(policy.approvalMode) ? policy.approvalMode : 'on-risk',
    autoConfirmCommands: policy.autoConfirmCommands === true,
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
    risk: risk || 'high',
    reasons: reasons.slice(0, 8),
    policy: normalizeRunPolicy(policy),
    createdAt: new Date().toISOString(),
  };
}

export function needsRunApproval({ content = '', policy = {} } = {}) {
  const normalized = normalizeRunPolicy(policy);
  const assessment = classifyRunRisk(content);
  const requiresApproval = normalized.approvalMode === 'always'
    || (normalized.approvalMode === 'on-risk' && ['high', 'critical'].includes(assessment.risk) && !normalized.autoConfirmCommands);
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
