import express from 'express';
import Project from '../models/Project.js';
import { resolveSalesforceContext, salesforceErrorResponse } from '../salesforce/salesforceContextResolver.js';
import { detectSalesforceProject } from '../salesforce/salesforceDetectionService.js';
import { searchFlows, indexFlows, answerFlowQuestion } from '../salesforce/salesforceFlowService.js';
import { buildCompactSalesforceContext } from '../salesforce/salesforceContextService.js';
import { analyzeSalesforceDependency } from '../salesforce/salesforceDependencyService.js';
import { validateReadOnlySoql } from '../salesforce/salesforceSoqlValidation.js';
import { SalesforceApiError } from '../salesforce/salesforceErrors.js';

// New services
import {
  connectWithToken,
  connectWithCli,
  getConnectionStatus,
  disconnectProject,
  refreshConnectionFromCli,
  getProjectConnection,
  checkHostCli,
  listHostOrgs,
  getSetupStatus,
  connectEnvironment,
  disconnectEnvironment,
  refreshEnvironment,
} from '../salesforce/salesforceAuthService.js';
import {
  listSObjects,
  describeSObject,
  runSoqlQuery,
  restRequest,
  createRecord,
  updateRecord,
  deleteRecord,
} from '../salesforce/salesforceRestClient.js';
import {
  executeApex,
  listDebugLogs,
  fetchDebugLogBody,
  listFlowDefinitions,
  getFlowInterviewCounts,
  searchFlowsByTaskAssignment,
  runCustomToolingQuery,
} from '../salesforce/salesforceToolingService.js';

const router = express.Router();

function boolQuery(value) {
  return value === true || value === '1' || value === 'true';
}

function requireProjectId(req) {
  const projectId = req.method === 'GET' ? req.query.projectId : req.body.projectId;
  if (!projectId) throw new SalesforceApiError('PROJECT_ID_REQUIRED', 'projectId is required', 400);
  return projectId;
}

function requireConnection(projectId) {
  const conn = getProjectConnection(projectId);
  if (!conn) throw new SalesforceApiError('NOT_CONNECTED', 'No active Salesforce connection. Connect first.', 401);
  return conn;
}

function contextFromRequest(req, { requireRepo = false } = {}) {
  const source = req.method === 'GET' ? req.query : req.body;
  return resolveSalesforceContext({
    projectId: source.projectId,
    repoPath: source.repoPath,
    worktreePath: source.worktreePath,
    branch: source.branch,
    requireRepo,
  });
}

// ─── Connection Management ──────────────────────────────────────────────────

router.get('/connection/status', async (req, res) => {
  try {
    const projectId = requireProjectId(req);
    const status = await getConnectionStatus(projectId);
    res.json({ ok: true, data: status });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.post('/connection/token', async (req, res) => {
  try {
    const { projectId, accessToken, instanceUrl, apiVersion } = req.body;
    if (!projectId) return res.status(400).json({ ok: false, error: { code: 'PROJECT_ID_REQUIRED', message: 'projectId is required' } });
    const result = await connectWithToken(projectId, { accessToken, instanceUrl, apiVersion });
    res.json({ ok: true, data: result });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.post('/connection/cli', async (req, res) => {
  try {
    const { projectId, usernameOrAlias } = req.body;
    if (!projectId || !usernameOrAlias) {
      return res.status(400).json({ ok: false, error: { code: 'MISSING_PARAMS', message: 'projectId and usernameOrAlias are required' } });
    }
    const result = await connectWithCli(projectId, usernameOrAlias);
    res.json({ ok: true, data: result });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.post('/connection/refresh', async (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId) return res.status(400).json({ ok: false, error: { code: 'PROJECT_ID_REQUIRED', message: 'projectId is required' } });
    const result = await refreshConnectionFromCli(projectId);
    res.json({ ok: true, data: result });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.post('/connection/disconnect', async (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId) return res.status(400).json({ ok: false, error: { code: 'PROJECT_ID_REQUIRED', message: 'projectId is required' } });
    const result = await disconnectProject(projectId);
    res.json({ ok: true, data: result });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.get('/connection/cli-check', async (req, res) => {
  try {
    const cli = checkHostCli();
    const orgs = cli.available ? listHostOrgs() : [];
    res.json({ ok: true, data: { cli, orgs } });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

// ─── Environment-based Connection (host → container flow) ───────────────────

router.get('/connection/setup-status', async (req, res) => {
  try {
    const projectId = requireProjectId(req);
    const status = await getSetupStatus(projectId);
    res.json({ ok: true, data: status });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.post('/connection/connect-env', async (req, res) => {
  try {
    const { projectId, envType, hostUsernameOrAlias } = req.body;
    if (!projectId || !envType || !hostUsernameOrAlias) {
      return res.status(400).json({ ok: false, error: { code: 'MISSING_PARAMS', message: 'projectId, envType, and hostUsernameOrAlias are required' } });
    }
    const result = await connectEnvironment(projectId, envType, hostUsernameOrAlias);
    res.json({ ok: true, data: result });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.post('/connection/disconnect-env', async (req, res) => {
  try {
    const { projectId, envType } = req.body;
    if (!projectId || !envType) {
      return res.status(400).json({ ok: false, error: { code: 'MISSING_PARAMS', message: 'projectId and envType are required' } });
    }
    const result = await disconnectEnvironment(projectId, envType);
    res.json({ ok: true, data: result });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.post('/connection/refresh-env', async (req, res) => {
  try {
    const { projectId, envType } = req.body;
    if (!projectId || !envType) {
      return res.status(400).json({ ok: false, error: { code: 'MISSING_PARAMS', message: 'projectId and envType are required' } });
    }
    const result = await refreshEnvironment(projectId, envType);
    res.json({ ok: true, data: result });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

// ─── Schema Explorer ────────────────────────────────────────────────────────

router.get('/schema/objects', async (req, res) => {
  try {
    const projectId = requireProjectId(req);
    const conn = requireConnection(projectId);
    const objects = await listSObjects(conn.instanceUrl, conn.accessToken, conn.apiVersion);
    res.json({ ok: true, data: { objects } });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.get('/schema/objects/:objectName', async (req, res) => {
  try {
    const projectId = requireProjectId(req);
    const conn = requireConnection(projectId);
    const result = await describeSObject(conn.instanceUrl, conn.accessToken, req.params.objectName, {
      apiVersion: conn.apiVersion,
      refresh: boolQuery(req.query.refresh),
    });
    res.json({ ok: true, data: result });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

// ─── SOQL Studio ────────────────────────────────────────────────────────────

router.post('/soql/validate', async (req, res) => {
  try {
    const query = validateReadOnlySoql(req.body.query, { maxLimit: req.body.maxLimit || undefined });
    res.json({ ok: true, data: { query } });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.post('/soql/query', async (req, res) => {
  try {
    const projectId = requireProjectId(req);
    const conn = requireConnection(projectId);
    const safeQuery = validateReadOnlySoql(req.body.query, { maxLimit: req.body.maxLimit || undefined });
    const result = await runSoqlQuery(conn.instanceUrl, conn.accessToken, safeQuery, { apiVersion: conn.apiVersion });
    const columns = result.records.length ? Object.keys(result.records[0]) : [];
    res.json({
      ok: true,
      data: {
        query: safeQuery,
        columns,
        rows: result.records,
        totalSize: result.totalSize,
        done: result.done,
      },
    });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.post('/soql/ai-build', async (req, res) => {
  try {
    const { projectId, naturalLanguage, objectContext } = req.body;
    if (!naturalLanguage) return res.status(400).json({ ok: false, error: { code: 'INPUT_REQUIRED', message: 'naturalLanguage prompt is required' } });

    const conn = projectId ? getProjectConnection(projectId) : null;
    const contextInfo = objectContext ? `Available object context: ${JSON.stringify(objectContext)}` : '';

    const provider = (await import('../llmProvider.js')).default;
    const result = await provider.generateResponse(
      `Convert this natural language request into a valid Salesforce SOQL query:\n\n"${naturalLanguage}"\n\n${contextInfo}\n\nRespond with ONLY the SOQL query, no explanation. The query must be a SELECT statement. Include a reasonable LIMIT if not specified.`,
      {
        systemPrompt: 'You are a Salesforce SOQL expert. Generate only valid, read-only SELECT SOQL queries. Never generate DML statements. Always include a LIMIT clause. Return only the query text, no markdown or explanation.',
        maxTokens: 500,
        temperature: 0.1,
      },
    );

    // Clean up the response - remove any markdown formatting
    let soql = result.response.trim();
    soql = soql.replace(/^```(?:soql|sql)?\n?/i, '').replace(/\n?```$/i, '').trim();

    res.json({ ok: true, data: { soql, provider: result.provider, model: result.model } });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

// ─── Flow Analyzer ──────────────────────────────────────────────────────────

router.get('/flows/definitions', async (req, res) => {
  try {
    const projectId = requireProjectId(req);
    const result = await listFlowDefinitions(projectId);
    res.json({ ok: true, data: result });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.get('/flows/counts', async (req, res) => {
  try {
    const projectId = requireProjectId(req);
    const result = await getFlowInterviewCounts(projectId);
    res.json({ ok: true, data: result });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.post('/flows/task-search', async (req, res) => {
  try {
    const { projectId, assignee } = req.body;
    if (!projectId) return res.status(400).json({ ok: false, error: { code: 'PROJECT_ID_REQUIRED', message: 'projectId is required' } });
    const result = await searchFlowsByTaskAssignment(projectId, assignee);
    res.json({ ok: true, data: result });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.post('/flows/ai-explain', async (req, res) => {
  try {
    const { projectId, flowName, flowMetadata } = req.body;
    if (!flowName) return res.status(400).json({ ok: false, error: { code: 'FLOW_NAME_REQUIRED', message: 'flowName is required' } });

    const provider = (await import('../llmProvider.js')).default;
    const result = await provider.generateResponse(
      `Explain this Salesforce Flow in plain English:\n\nFlow Name: ${flowName}\nMetadata: ${JSON.stringify(flowMetadata, null, 2)}\n\nProvide:\n1. A brief summary of what this flow does\n2. The trigger/entry conditions\n3. Key actions it performs\n4. Any risks or concerns (e.g., DML in loops, missing error handling)`,
      {
        systemPrompt: 'You are a Salesforce Flow expert. Explain flows in clear, concise language. Focus on business impact and technical risks. Be specific about what the flow does, not general platitudes.',
        maxTokens: 800,
        temperature: 0.2,
      },
    );

    res.json({ ok: true, data: { explanation: result.response, provider: result.provider, model: result.model } });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

// Keep legacy local flow endpoints for container-based projects
router.post('/flows/index', async (req, res) => {
  try {
    const context = await contextFromRequest(req, { requireRepo: true });
    const result = await indexFlows(context, { refresh: boolQuery(req.body.refresh) });
    res.json({ ok: true, data: { flowCount: result.flows.length, parseWarnings: result.parseWarnings, indexedAt: result.indexedAt, cached: result.cached } });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.get('/flows/search', async (req, res) => {
  try {
    const context = await contextFromRequest(req, { requireRepo: true });
    const result = await searchFlows(context, {
      q: req.query.q,
      object: req.query.object,
      field: req.query.field,
      action: req.query.action,
      refresh: boolQuery(req.query.refresh),
    });
    res.json({ ok: true, data: { results: result.results, parseWarnings: result.parseWarnings, indexedAt: result.indexedAt, cached: result.cached } });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.post('/flows/ask', async (req, res) => {
  try {
    const context = await contextFromRequest(req, { requireRepo: true });
    const result = await answerFlowQuestion(context, {
      question: req.body.question,
      refresh: boolQuery(req.body.refresh),
    });
    res.json({ ok: true, data: result });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

// ─── Debug Console ──────────────────────────────────────────────────────────

router.post('/debug/execute-apex', async (req, res) => {
  try {
    const { projectId, code } = req.body;
    if (!projectId) return res.status(400).json({ ok: false, error: { code: 'PROJECT_ID_REQUIRED', message: 'projectId is required' } });
    const result = await executeApex(projectId, code);
    res.json({ ok: true, data: result });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.get('/debug/logs', async (req, res) => {
  try {
    const projectId = requireProjectId(req);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const result = await listDebugLogs(projectId, { limit });
    res.json({ ok: true, data: result });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.get('/debug/logs/:logId', async (req, res) => {
  try {
    const projectId = requireProjectId(req);
    const body = await fetchDebugLogBody(projectId, req.params.logId);
    res.json({ ok: true, data: { body } });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

// ─── REST Explorer ──────────────────────────────────────────────────────────

router.post('/rest/request', async (req, res) => {
  try {
    const { projectId, method, path, body } = req.body;
    if (!projectId) return res.status(400).json({ ok: false, error: { code: 'PROJECT_ID_REQUIRED', message: 'projectId is required' } });
    if (!path) return res.status(400).json({ ok: false, error: { code: 'PATH_REQUIRED', message: 'path is required' } });

    const allowedMethods = ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'];
    const normalizedMethod = (method || 'GET').toUpperCase();
    if (!allowedMethods.includes(normalizedMethod)) {
      return res.status(400).json({ ok: false, error: { code: 'INVALID_METHOD', message: `Method must be one of: ${allowedMethods.join(', ')}` } });
    }

    const conn = requireConnection(projectId);
    const startedAt = Date.now();
    const result = await restRequest(conn.instanceUrl, conn.accessToken, {
      method: normalizedMethod,
      path,
      body,
      apiVersion: conn.apiVersion,
    });

    res.json({
      ok: true,
      data: {
        status: result.status,
        body: result.data,
        durationMs: Date.now() - startedAt,
      },
    });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

// ─── Data Operations ────────────────────────────────────────────────────────

router.post('/data/create', async (req, res) => {
  try {
    const { projectId, objectName, fields } = req.body;
    if (!projectId || !objectName || !fields) {
      return res.status(400).json({ ok: false, error: { code: 'MISSING_PARAMS', message: 'projectId, objectName, and fields are required' } });
    }
    const conn = requireConnection(projectId);
    const result = await createRecord(conn.instanceUrl, conn.accessToken, objectName, fields, { apiVersion: conn.apiVersion });
    res.json({ ok: true, data: result });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.patch('/data/update', async (req, res) => {
  try {
    const { projectId, objectName, recordId, fields } = req.body;
    if (!projectId || !objectName || !recordId || !fields) {
      return res.status(400).json({ ok: false, error: { code: 'MISSING_PARAMS', message: 'projectId, objectName, recordId, and fields are required' } });
    }
    const conn = requireConnection(projectId);
    const result = await updateRecord(conn.instanceUrl, conn.accessToken, objectName, recordId, fields, { apiVersion: conn.apiVersion });
    res.json({ ok: true, data: result });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.delete('/data/delete', async (req, res) => {
  try {
    const { projectId, objectName, recordId } = req.body;
    if (!projectId || !objectName || !recordId) {
      return res.status(400).json({ ok: false, error: { code: 'MISSING_PARAMS', message: 'projectId, objectName, and recordId are required' } });
    }
    const conn = requireConnection(projectId);
    const result = await deleteRecord(conn.instanceUrl, conn.accessToken, objectName, recordId, { apiVersion: conn.apiVersion });
    res.json({ ok: true, data: result });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

// ─── Dependency Analysis ────────────────────────────────────────────────────

router.post('/dependencies/analyze', async (req, res) => {
  try {
    const context = await contextFromRequest(req, { requireRepo: true });
    const result = await analyzeSalesforceDependency(context, {
      objectName: req.body.objectName,
      fieldName: req.body.fieldName,
      refresh: boolQuery(req.body.refresh),
    });
    res.json({ ok: true, data: result });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

// ─── Tooling Queries ────────────────────────────────────────────────────────

router.post('/tooling/query', async (req, res) => {
  try {
    const { projectId, query } = req.body;
    if (!projectId) return res.status(400).json({ ok: false, error: { code: 'PROJECT_ID_REQUIRED', message: 'projectId is required' } });
    const result = await runCustomToolingQuery(projectId, query);
    res.json({ ok: true, data: result });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

// ─── Legacy/Context ─────────────────────────────────────────────────────────

router.post('/detect', async (req, res) => {
  try {
    const context = await contextFromRequest(req);
    const detection = await detectSalesforceProject(context);
    let appliedToProject = false;

    if (req.body.persist) {
      const updates = { stackDetection: detection };
      if (context.project.stackManualOverride !== true && detection.detectedStack === 'salesforce' && detection.confidence >= 0.75) {
        updates.stack = 'salesforce';
        appliedToProject = true;
      }
      await Project.update(context.projectId, updates);
    }

    res.json({ ok: true, data: { detection, appliedToProject } });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.put('/project-settings', async (req, res) => {
  try {
    const project = Project.findById(req.body.projectId);
    if (!project) return res.status(404).json({ ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } });
    const updates = {};
    if (req.body.stack !== undefined) {
      if (!['generic', 'salesforce'].includes(req.body.stack)) {
        return res.status(400).json({ ok: false, error: { code: 'INVALID_STACK', message: 'Stack must be generic or salesforce' } });
      }
      updates.stack = req.body.stack;
      updates.stackManualOverride = true;
    }
    if (req.body.stackManualOverride !== undefined) updates.stackManualOverride = req.body.stackManualOverride === true;
    if (req.body.salesforce !== undefined && typeof req.body.salesforce === 'object') {
      updates.salesforce = { ...(project.salesforce || {}), ...req.body.salesforce };
    }
    const updatedProject = await Project.update(req.body.projectId, updates);
    res.json({ ok: true, data: { project: updatedProject } });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.get('/context', async (req, res) => {
  try {
    const context = await contextFromRequest(req);
    const data = await buildCompactSalesforceContext(context);
    res.json({ ok: true, data });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

export default router;
