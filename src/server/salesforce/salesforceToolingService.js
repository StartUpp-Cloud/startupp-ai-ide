/**
 * Salesforce Tooling API service.
 * Provides Execute Anonymous, debug log management, and flow interview data.
 */
import { SalesforceApiError } from './salesforceErrors.js';
import { getProjectConnection } from './salesforceAuthService.js';
import {
  executeAnonymousApex,
  getDebugLogs,
  getDebugLogBody,
  getFlowDefinitions,
  getFlowVersions,
  runToolingQuery,
} from './salesforceRestClient.js';
import { logSalesforceAudit } from './salesforceAuditService.js';

function requireConnection(projectId) {
  const conn = getProjectConnection(projectId);
  if (!conn) throw new SalesforceApiError('NOT_CONNECTED', 'No active Salesforce connection. Connect first.', 401);
  return conn;
}

export async function executeApex(projectId, apexCode) {
  if (!apexCode || typeof apexCode !== 'string' || !apexCode.trim()) {
    throw new SalesforceApiError('APEX_CODE_REQUIRED', 'Apex code is required', 400);
  }
  if (apexCode.length > 100000) {
    throw new SalesforceApiError('APEX_CODE_TOO_LARGE', 'Apex code must be under 100KB', 400);
  }

  const conn = requireConnection(projectId);
  const startedAt = Date.now();

  logSalesforceAudit({
    projectId,
    operation: 'tooling.executeAnonymous',
    riskLevel: 'org_write',
    status: 'started',
  });

  try {
    const result = await executeAnonymousApex(conn.instanceUrl, conn.accessToken, apexCode, { apiVersion: conn.apiVersion });

    logSalesforceAudit({
      projectId,
      operation: 'tooling.executeAnonymous',
      riskLevel: 'org_write',
      status: result.success ? 'succeeded' : 'failed',
      errorCode: result.compileProblem || result.exceptionMessage || null,
      durationMs: Date.now() - startedAt,
    });

    return result;
  } catch (error) {
    logSalesforceAudit({
      projectId,
      operation: 'tooling.executeAnonymous',
      riskLevel: 'org_write',
      status: 'failed',
      errorCode: error.code || error.message,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export async function listDebugLogs(projectId, { limit = 20 } = {}) {
  const conn = requireConnection(projectId);
  const result = await getDebugLogs(conn.instanceUrl, conn.accessToken, { limit, apiVersion: conn.apiVersion });

  logSalesforceAudit({
    projectId,
    operation: 'tooling.debugLogs',
    riskLevel: 'read_only',
    status: 'succeeded',
  });

  return result;
}

export async function fetchDebugLogBody(projectId, logId) {
  if (!logId) throw new SalesforceApiError('LOG_ID_REQUIRED', 'Debug log ID is required', 400);

  const conn = requireConnection(projectId);
  const body = await getDebugLogBody(conn.instanceUrl, conn.accessToken, logId, { apiVersion: conn.apiVersion });

  logSalesforceAudit({
    projectId,
    operation: 'tooling.debugLogBody',
    riskLevel: 'read_only',
    status: 'succeeded',
  });

  return body;
}

export async function listFlowDefinitions(projectId) {
  const conn = requireConnection(projectId);
  const result = await getFlowDefinitions(conn.instanceUrl, conn.accessToken, { apiVersion: conn.apiVersion });

  logSalesforceAudit({
    projectId,
    operation: 'tooling.flowDefinitions',
    riskLevel: 'read_only',
    status: 'succeeded',
  });

  return result;
}

export async function listFlowVersionsForDefinition(projectId, flowDefinitionId) {
  if (!flowDefinitionId) throw new SalesforceApiError('FLOW_ID_REQUIRED', 'Flow definition ID is required', 400);

  const conn = requireConnection(projectId);
  return getFlowVersions(conn.instanceUrl, conn.accessToken, flowDefinitionId, { apiVersion: conn.apiVersion });
}

export async function getFlowInterviewCounts(projectId) {
  const conn = requireConnection(projectId);

  // Get active flow count and flow type breakdown via FlowDefinition
  const definitions = await getFlowDefinitions(conn.instanceUrl, conn.accessToken, { apiVersion: conn.apiVersion });

  const counts = {
    total: definitions.totalSize,
    active: 0,
    inactive: 0,
    byProcessType: {},
  };

  for (const flow of definitions.records) {
    if (flow.IsActive || flow.ActiveVersionId) {
      counts.active++;
    } else {
      counts.inactive++;
    }
    const pt = flow.ProcessType || 'Unknown';
    counts.byProcessType[pt] = (counts.byProcessType[pt] || 0) + 1;
  }

  return { counts, flows: definitions.records };
}

export async function searchFlowsByTaskAssignment(projectId, assignee) {
  if (!assignee || typeof assignee !== 'string') {
    throw new SalesforceApiError('ASSIGNEE_REQUIRED', 'Assignee (user, queue, or role name) is required', 400);
  }

  const conn = requireConnection(projectId);
  const searchTerm = assignee.trim().toLowerCase();

  // Get all flow definitions
  const definitions = await getFlowDefinitions(conn.instanceUrl, conn.accessToken, { apiVersion: conn.apiVersion });

  // For each active flow, check flow metadata for task/action assignments
  // This requires reading the flow XML from the Tooling API
  const matchingFlows = [];

  for (const flow of definitions.records) {
    if (!flow.ActiveVersionId) continue;

    try {
      const versionQuery = `SELECT Id, FullName, Metadata FROM Flow WHERE Id = '${flow.ActiveVersionId}'`;
      const versionResult = await runToolingQuery(conn.instanceUrl, conn.accessToken, versionQuery, { apiVersion: conn.apiVersion });

      if (!versionResult.records?.length) continue;

      const metadata = versionResult.records[0].Metadata;
      if (!metadata) continue;

      // Search through action calls, record creates, and assignments for task references
      const metadataStr = JSON.stringify(metadata).toLowerCase();
      if (metadataStr.includes('task') && metadataStr.includes(searchTerm)) {
        matchingFlows.push({
          id: flow.Id,
          name: flow.DeveloperName,
          label: flow.MasterLabel,
          processType: flow.ProcessType,
          isActive: !!(flow.IsActive || flow.ActiveVersionId),
          lastModified: flow.LastModifiedDate,
          lastModifiedBy: flow.LastModifiedBy?.Name,
          matchReason: 'Flow metadata references task creation with matching assignee',
        });
      }
    } catch {
      // Skip flows we can't read — may be managed packages
    }
  }

  logSalesforceAudit({
    projectId,
    operation: 'tooling.flowTaskSearch',
    riskLevel: 'read_only',
    status: 'succeeded',
  });

  return { assignee, matchingFlows, totalFlowsSearched: definitions.records.filter((f) => f.ActiveVersionId).length };
}

export async function runCustomToolingQuery(projectId, query) {
  if (!query || typeof query !== 'string') {
    throw new SalesforceApiError('QUERY_REQUIRED', 'Tooling API query is required', 400);
  }
  if (!/^select\b/i.test(query.trim())) {
    throw new SalesforceApiError('TOOLING_QUERY_NOT_READ_ONLY', 'Only SELECT queries are allowed via Tooling API', 400);
  }

  const conn = requireConnection(projectId);
  return runToolingQuery(conn.instanceUrl, conn.accessToken, query, { apiVersion: conn.apiVersion });
}
