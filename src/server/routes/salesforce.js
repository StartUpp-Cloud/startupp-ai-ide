import express from 'express';
import Project from '../models/Project.js';
import { resolveSalesforceContext, salesforceErrorResponse } from '../salesforce/salesforceContextResolver.js';
import { detectSalesforceProject } from '../salesforce/salesforceDetectionService.js';
import { getSalesforceStatus } from '../salesforce/salesforceStatusService.js';
import { listSalesforceOrgs } from '../salesforce/salesforceOrgService.js';
import { describeObject, listObjects } from '../salesforce/salesforceObjectService.js';
import { runReadOnlySoql, validateReadOnlySoql } from '../salesforce/salesforceSoqlService.js';
import { searchFlows, indexFlows, answerFlowQuestion } from '../salesforce/salesforceFlowService.js';
import { buildCompactSalesforceContext } from '../salesforce/salesforceContextService.js';
import { analyzeSalesforceDependency } from '../salesforce/salesforceDependencyService.js';
import { importSalesforceAuthUrl, installSalesforceCli } from '../salesforce/salesforceCommandService.js';

const router = express.Router();

function boolQuery(value) {
  return value === true || value === '1' || value === 'true';
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

router.get('/status', async (req, res) => {
  try {
    const context = await contextFromRequest(req);
    const status = await getSalesforceStatus(context);
    res.json({ ok: true, data: status, warnings: status.warnings });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.post('/cli/install', async (req, res) => {
  try {
    const context = await contextFromRequest(req);
    const result = await installSalesforceCli(context);
    res.json({ ok: true, data: { version: result.version }, auditId: result.auditId });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.post('/auth/import', async (req, res) => {
  try {
    const context = await contextFromRequest(req, { requireRepo: true });
    const result = await importSalesforceAuthUrl(context, {
      authUrl: req.body.authUrl,
      alias: req.body.alias,
      setDefault: req.body.setDefault !== false,
    });
    res.json({ ok: true, data: { imported: true, result: result.json?.result || null }, auditId: result.auditId });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.get('/orgs', async (req, res) => {
  try {
    const context = await contextFromRequest(req, { requireRepo: true });
    const result = await listSalesforceOrgs(context);
    res.json({ ok: true, data: { orgs: result.orgs }, auditId: result.auditId });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.get('/objects', async (req, res) => {
  try {
    const context = await contextFromRequest(req, { requireRepo: true });
    const targetOrg = req.query.targetOrg;
    if (!targetOrg) return res.status(400).json({ ok: false, error: { code: 'TARGET_ORG_REQUIRED', message: 'targetOrg is required' } });
    const result = await listObjects(context, targetOrg, { refresh: boolQuery(req.query.refresh) });
    res.json({ ok: true, data: { objects: result.objects, cached: result.cached }, auditId: result.auditId });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.get('/objects/:objectName', async (req, res) => {
  try {
    const context = await contextFromRequest(req, { requireRepo: true });
    const targetOrg = req.query.targetOrg;
    if (!targetOrg) return res.status(400).json({ ok: false, error: { code: 'TARGET_ORG_REQUIRED', message: 'targetOrg is required' } });
    const result = await describeObject(context, targetOrg, req.params.objectName, { refresh: boolQuery(req.query.refresh) });
    res.json({ ok: true, data: { describe: result.describe, cached: result.cached }, auditId: result.auditId });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

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
    const context = await contextFromRequest(req, { requireRepo: true });
    if (!req.body.targetOrg) return res.status(400).json({ ok: false, error: { code: 'TARGET_ORG_REQUIRED', message: 'targetOrg is required' } });
    const result = await runReadOnlySoql(context, req.body.targetOrg, req.body.query, { maxLimit: req.body.maxLimit || undefined });
    res.json({
      ok: true,
      data: {
        query: result.query,
        columns: Object.keys(result.records[0] || {}).filter((key) => key !== 'attributes'),
        rows: result.records,
        totalSize: result.totalSize,
        done: result.done,
        truncated: false,
      },
      warnings: [],
      auditId: result.auditId,
    });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

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
    res.json({
      ok: true,
      data: {
        answer: result.answer,
        llmUsed: result.llmUsed,
        provider: result.provider,
        model: result.model,
        fallbackReason: result.fallbackReason,
        candidates: result.candidates,
        parseWarnings: result.parseWarnings,
        indexedAt: result.indexedAt,
        cached: result.cached,
      },
    });
  } catch (error) {
    salesforceErrorResponse(res, error);
  }
});

router.post('/dependencies/analyze', async (req, res) => {
  try {
    const context = await contextFromRequest(req, { requireRepo: true });
    const result = await analyzeSalesforceDependency(context, {
      objectName: req.body.objectName,
      fieldName: req.body.fieldName,
      refresh: boolQuery(req.body.refresh),
    });
    res.json({
      ok: true,
      data: {
        target: result.target,
        risk: result.risk,
        referenceCount: result.referenceCount,
        references: result.references,
        suggestedRemovalOrder: result.suggestedRemovalOrder,
        verificationSteps: result.verificationSteps,
        plan: result.plan,
        llmUsed: result.llmUsed,
        provider: result.provider,
        model: result.model,
        fallbackReason: result.fallbackReason,
        parseWarnings: result.parseWarnings,
        indexedAt: result.indexedAt,
        cached: result.cached,
      },
    });
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
