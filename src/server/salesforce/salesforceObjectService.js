import { runSalesforceOperation } from './salesforceCommandService.js';

const objectCache = new Map();
const TTL_MS = 10 * 60 * 1000;

function cacheKey(context, targetOrg, objectName = '') {
  return JSON.stringify({
    projectId: context.projectId,
    cwd: context.cwd,
    targetOrg,
    objectName,
  });
}

function getCached(key) {
  const entry = objectCache.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    objectCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key, value) {
  objectCache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

export async function listObjects(context, targetOrg, { refresh = false } = {}) {
  const key = cacheKey(context, targetOrg);
  if (!refresh) {
    const cached = getCached(key);
    if (cached) return { ...cached, cached: true };
  }
  const result = await runSalesforceOperation(context, 'object.list', { targetOrg });
  const objects = Array.isArray(result.json?.result) ? result.json.result : [];
  return setCached(key, { objects, auditId: result.auditId, cached: false });
}

export async function describeObject(context, targetOrg, objectName, { refresh = false } = {}) {
  const key = cacheKey(context, targetOrg, objectName);
  if (!refresh) {
    const cached = getCached(key);
    if (cached) return { ...cached, cached: true };
  }
  const result = await runSalesforceOperation(context, 'object.describe', { targetOrg, objectName });
  const describe = result.json?.result || result.json;
  return setCached(key, { describe, auditId: result.auditId, cached: false });
}
