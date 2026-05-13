/**
 * Direct Salesforce REST API client.
 * Bypasses the CLI for faster, structured API calls.
 * Handles token management, API versioning, caching, and error normalization.
 */
import { SalesforceApiError } from './salesforceErrors.js';
import { logSalesforceAudit } from './salesforceAuditService.js';
import { redactSalesforceObject } from './salesforceRedaction.js';

const DEFAULT_API_VERSION = 'v62.0';
const REQUEST_TIMEOUT_MS = 30000;
const DESCRIBE_CACHE_TTL_MS = 10 * 60 * 1000;

const describeCache = new Map();

function buildUrl(instanceUrl, path, apiVersion = DEFAULT_API_VERSION) {
  const base = instanceUrl.replace(/\/+$/, '');
  if (path.startsWith('/services/')) return `${base}${path}`;
  return `${base}/services/data/${apiVersion}${path}`;
}

async function sfFetch(instanceUrl, accessToken, path, options = {}) {
  const {
    method = 'GET',
    body = undefined,
    apiVersion = DEFAULT_API_VERSION,
    timeout = REQUEST_TIMEOUT_MS,
  } = options;

  const url = buildUrl(instanceUrl, path, apiVersion);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (res.status === 204) return { status: 204, data: null };

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!res.ok) {
      const errorBody = Array.isArray(data) ? data[0] : data;
      const code = errorBody?.errorCode || `HTTP_${res.status}`;
      const message = errorBody?.message || `Salesforce API error: ${res.status}`;
      throw new SalesforceApiError(code, message, res.status, { url: path, method });
    }

    return { status: res.status, data };
  } catch (error) {
    if (error instanceof SalesforceApiError) throw error;
    if (error.name === 'AbortError') {
      throw new SalesforceApiError('REQUEST_TIMEOUT', `Salesforce API request timed out after ${timeout}ms`, 504);
    }
    throw new SalesforceApiError('NETWORK_ERROR', `Salesforce API network error: ${error.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function testConnection(instanceUrl, accessToken, apiVersion = DEFAULT_API_VERSION) {
  const res = await sfFetch(instanceUrl, accessToken, '/', { apiVersion });
  return res.data;
}

export async function getOrgInfo(instanceUrl, accessToken, apiVersion = DEFAULT_API_VERSION) {
  const [identity, limits] = await Promise.all([
    sfFetch(instanceUrl, accessToken, '/services/oauth2/userinfo'),
    sfFetch(instanceUrl, accessToken, '/limits', { apiVersion }).catch(() => ({ data: null })),
  ]);
  return { identity: identity.data, limits: limits.data };
}

export async function listSObjects(instanceUrl, accessToken, apiVersion = DEFAULT_API_VERSION) {
  const res = await sfFetch(instanceUrl, accessToken, '/sobjects', { apiVersion });
  return (res.data?.sobjects || []).map((obj) => ({
    name: obj.name,
    label: obj.label,
    custom: obj.custom,
    queryable: obj.queryable,
    createable: obj.createable,
    updateable: obj.updateable,
    deletable: obj.deletable,
    keyPrefix: obj.keyPrefix,
  }));
}

export async function describeSObject(instanceUrl, accessToken, objectName, { apiVersion = DEFAULT_API_VERSION, refresh = false } = {}) {
  const key = `${instanceUrl}:${objectName}:${apiVersion}`;
  if (!refresh) {
    const cached = describeCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.value, cached: true };
  }

  const res = await sfFetch(instanceUrl, accessToken, `/sobjects/${encodeURIComponent(objectName)}/describe`, { apiVersion });
  const value = {
    name: res.data.name,
    label: res.data.label,
    labelPlural: res.data.labelPlural,
    custom: res.data.custom,
    keyPrefix: res.data.keyPrefix,
    recordTypeInfos: res.data.recordTypeInfos || [],
    fields: (res.data.fields || []).map((f) => ({
      name: f.name,
      label: f.label,
      type: f.type,
      length: f.length,
      custom: f.custom,
      nillable: f.nillable,
      unique: f.unique,
      defaultValue: f.defaultValue,
      picklistValues: f.picklistValues?.length ? f.picklistValues : undefined,
      referenceTo: f.referenceTo?.length ? f.referenceTo : undefined,
      relationshipName: f.relationshipName || undefined,
      calculated: f.calculated,
      formulaTreatNullNumberAsZero: f.formulaTreatNullNumberAsZero,
      inlineHelpText: f.inlineHelpText,
      externalId: f.externalId,
    })),
    childRelationships: (res.data.childRelationships || []).slice(0, 100).map((cr) => ({
      childSObject: cr.childSObject,
      field: cr.field,
      relationshipName: cr.relationshipName,
    })),
    cached: false,
  };

  describeCache.set(key, { value, expiresAt: Date.now() + DESCRIBE_CACHE_TTL_MS });
  return value;
}

export async function runSoqlQuery(instanceUrl, accessToken, query, { apiVersion = DEFAULT_API_VERSION } = {}) {
  const res = await sfFetch(instanceUrl, accessToken, `/query?q=${encodeURIComponent(query)}`, { apiVersion });
  return {
    totalSize: res.data.totalSize,
    done: res.data.done,
    records: (res.data.records || []).map((r) => {
      const { attributes, ...fields } = r;
      return fields;
    }),
    nextRecordsUrl: res.data.nextRecordsUrl || null,
  };
}

export async function runToolingQuery(instanceUrl, accessToken, query, { apiVersion = DEFAULT_API_VERSION } = {}) {
  const res = await sfFetch(instanceUrl, accessToken, `/tooling/query?q=${encodeURIComponent(query)}`, { apiVersion });
  return {
    totalSize: res.data.totalSize,
    done: res.data.done,
    records: (res.data.records || []).map((r) => {
      const { attributes, ...fields } = r;
      return fields;
    }),
  };
}

export async function executeAnonymousApex(instanceUrl, accessToken, apexBody, { apiVersion = DEFAULT_API_VERSION } = {}) {
  const res = await sfFetch(instanceUrl, accessToken, `/tooling/executeAnonymous?anonymousBody=${encodeURIComponent(apexBody)}`, {
    apiVersion,
    timeout: 60000,
  });
  return {
    compiled: res.data.compiled,
    success: res.data.success,
    compileProblem: res.data.compileProblem || null,
    exceptionMessage: res.data.exceptionMessage || null,
    exceptionStackTrace: res.data.exceptionStackTrace || null,
    line: res.data.line,
    column: res.data.column,
  };
}

export async function getDebugLogs(instanceUrl, accessToken, { limit = 20, apiVersion = DEFAULT_API_VERSION } = {}) {
  const query = `SELECT Id, Application, DurationMilliseconds, Location, LogLength, LogUser.Name, Operation, Request, StartTime, Status FROM ApexLog ORDER BY StartTime DESC LIMIT ${Math.min(limit, 100)}`;
  return runToolingQuery(instanceUrl, accessToken, query, { apiVersion });
}

export async function getDebugLogBody(instanceUrl, accessToken, logId, { apiVersion = DEFAULT_API_VERSION } = {}) {
  const res = await sfFetch(instanceUrl, accessToken, `/sobjects/ApexLog/${encodeURIComponent(logId)}/Body`, { apiVersion });
  return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
}

export async function getFlowDefinitions(instanceUrl, accessToken, { apiVersion = DEFAULT_API_VERSION } = {}) {
  const query = `SELECT Id, DeveloperName, MasterLabel, ActiveVersionId, LatestVersionId, ProcessType, Description, IsActive, LastModifiedDate, LastModifiedBy.Name FROM FlowDefinition ORDER BY MasterLabel ASC`;
  return runToolingQuery(instanceUrl, accessToken, query, { apiVersion });
}

export async function getFlowVersions(instanceUrl, accessToken, flowDefinitionId, { apiVersion = DEFAULT_API_VERSION } = {}) {
  const query = `SELECT Id, FlowDefinitionViewId, DurableId, ApiVersion, Label, Description, ProcessType, Status, VersionNumber FROM FlowVersionView WHERE FlowDefinitionViewId = '${flowDefinitionId}' ORDER BY VersionNumber DESC`;
  return runToolingQuery(instanceUrl, accessToken, query, { apiVersion });
}

export async function restRequest(instanceUrl, accessToken, { method = 'GET', path, body, apiVersion = DEFAULT_API_VERSION } = {}) {
  return sfFetch(instanceUrl, accessToken, path, { method, body, apiVersion, timeout: 45000 });
}

export async function createRecord(instanceUrl, accessToken, objectName, fields, { apiVersion = DEFAULT_API_VERSION } = {}) {
  const res = await sfFetch(instanceUrl, accessToken, `/sobjects/${encodeURIComponent(objectName)}`, {
    method: 'POST',
    body: fields,
    apiVersion,
  });
  return res.data;
}

export async function updateRecord(instanceUrl, accessToken, objectName, recordId, fields, { apiVersion = DEFAULT_API_VERSION } = {}) {
  await sfFetch(instanceUrl, accessToken, `/sobjects/${encodeURIComponent(objectName)}/${encodeURIComponent(recordId)}`, {
    method: 'PATCH',
    body: fields,
    apiVersion,
  });
  return { id: recordId, success: true };
}

export async function deleteRecord(instanceUrl, accessToken, objectName, recordId, { apiVersion = DEFAULT_API_VERSION } = {}) {
  await sfFetch(instanceUrl, accessToken, `/sobjects/${encodeURIComponent(objectName)}/${encodeURIComponent(recordId)}`, {
    method: 'DELETE',
    apiVersion,
  });
  return { id: recordId, success: true };
}

export function clearDescribeCache() {
  describeCache.clear();
}
