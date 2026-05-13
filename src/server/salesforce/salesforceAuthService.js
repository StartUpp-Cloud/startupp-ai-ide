/**
 * Salesforce auth service.
 * Manages connection tokens (access token + instance URL) with encrypted storage.
 * Supports two auth paths:
 *   1. Manual token paste (access token + instance URL)
 *   2. CLI-based detection (reads token from `sf org display` on host)
 */
import { execSync } from 'child_process';
import Project from '../models/Project.js';
import { encrypt, decrypt } from '../fieldEncryption.js';
import { SalesforceApiError } from './salesforceErrors.js';
import { testConnection, getOrgInfo } from './salesforceRestClient.js';
import { logSalesforceAudit } from './salesforceAuditService.js';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

function runHostCommand(command, { timeout = 15000 } = {}) {
  try {
    return execSync(command, { encoding: 'utf8', timeout, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

export function checkHostCli() {
  const output = runHostCommand('sf --version 2>/dev/null');
  if (!output) return { available: false, version: null };
  return { available: true, version: output.split('\n')[0] || output };
}

export function listHostOrgs() {
  const output = runHostCommand('sf org list --json 2>/dev/null', { timeout: 20000 });
  if (!output) return [];
  try {
    const parsed = JSON.parse(output);
    const result = parsed?.result || parsed;
    const orgs = [...(result.nonScratchOrgs || []), ...(result.scratchOrgs || [])];
    return orgs.map((org) => ({
      alias: org.alias || null,
      username: org.username,
      orgId: org.orgId,
      instanceUrl: org.instanceUrl,
      isDefault: org.isDefaultUsername || org.isDefaultDevHubUsername || false,
      connectedStatus: org.connectedStatus,
      orgType: org.isDevHub ? 'devhub' : org.isScratch ? 'scratch' : org.isSandbox ? 'sandbox' : 'production',
    }));
  } catch {
    return [];
  }
}

export async function getOrgTokenFromCli(usernameOrAlias) {
  const output = runHostCommand(`sf org display --target-org ${JSON.stringify(usernameOrAlias)} --json 2>/dev/null`, { timeout: 20000 });
  if (!output) throw new SalesforceApiError('CLI_ORG_DISPLAY_FAILED', 'Could not retrieve org details from CLI. Ensure sf CLI is installed and the org is authenticated.', 502);

  try {
    const parsed = JSON.parse(output);
    const result = parsed?.result || parsed;
    if (!result.accessToken || !result.instanceUrl) {
      throw new SalesforceApiError('CLI_TOKEN_MISSING', 'CLI returned org info but no access token. The org session may have expired. Re-authenticate with: sf org login web', 401);
    }
    return {
      accessToken: result.accessToken,
      instanceUrl: result.instanceUrl.replace(/\/+$/, ''),
      username: result.username,
      orgId: result.id || result.orgId,
      alias: result.alias || null,
      apiVersion: result.apiVersion || null,
    };
  } catch (error) {
    if (error instanceof SalesforceApiError) throw error;
    throw new SalesforceApiError('CLI_PARSE_ERROR', 'Failed to parse CLI org display output', 502);
  }
}

export async function connectWithToken(projectId, { accessToken, instanceUrl, apiVersion }) {
  if (!accessToken || !instanceUrl) {
    throw new SalesforceApiError('TOKEN_REQUIRED', 'Both accessToken and instanceUrl are required', 400);
  }

  const cleanInstanceUrl = instanceUrl.replace(/\/+$/, '');
  const resolvedApiVersion = apiVersion || 'v62.0';

  // Validate the token by making a test API call
  const versionInfo = await testConnection(cleanInstanceUrl, accessToken, resolvedApiVersion);
  const orgInfo = await getOrgInfo(cleanInstanceUrl, accessToken, resolvedApiVersion);

  const connection = {
    accessToken: encrypt(accessToken),
    instanceUrl: cleanInstanceUrl,
    apiVersion: resolvedApiVersion,
    username: orgInfo.identity?.username || null,
    orgId: orgInfo.identity?.organization_id || null,
    displayName: orgInfo.identity?.display_name || null,
    orgType: orgInfo.identity?.organization_id ? 'unknown' : 'unknown',
    connectedAt: new Date().toISOString(),
  };

  await Project.update(projectId, {
    stack: 'salesforce',
    salesforce: { connection },
  });

  logSalesforceAudit({
    projectId,
    operation: 'auth.connect',
    riskLevel: 'auth_write',
    status: 'succeeded',
  });

  return {
    instanceUrl: cleanInstanceUrl,
    apiVersion: resolvedApiVersion,
    username: connection.username,
    orgId: connection.orgId,
    displayName: connection.displayName,
  };
}

export async function connectWithCli(projectId, usernameOrAlias) {
  const orgToken = await getOrgTokenFromCli(usernameOrAlias);
  return connectWithToken(projectId, {
    accessToken: orgToken.accessToken,
    instanceUrl: orgToken.instanceUrl,
    apiVersion: orgToken.apiVersion ? `v${orgToken.apiVersion}` : undefined,
  });
}

export function getProjectConnection(projectId) {
  const project = Project.findById(projectId);
  if (!project) throw new SalesforceApiError('PROJECT_NOT_FOUND', 'Project not found', 404);

  const conn = project.salesforce?.connection;
  if (!conn?.accessToken || !conn?.instanceUrl) return null;

  return {
    accessToken: decrypt(conn.accessToken),
    instanceUrl: conn.instanceUrl,
    apiVersion: conn.apiVersion || 'v62.0',
    username: conn.username,
    orgId: conn.orgId,
    displayName: conn.displayName,
    connectedAt: conn.connectedAt,
  };
}

export async function refreshConnectionFromCli(projectId) {
  const project = Project.findById(projectId);
  if (!project) throw new SalesforceApiError('PROJECT_NOT_FOUND', 'Project not found', 404);

  const conn = project.salesforce?.connection;
  if (!conn?.username) {
    throw new SalesforceApiError('NO_CONNECTION', 'No Salesforce connection found. Connect first.', 400);
  }

  return connectWithCli(projectId, conn.username);
}

export async function disconnectProject(projectId) {
  const project = Project.findById(projectId);
  if (!project) throw new SalesforceApiError('PROJECT_NOT_FOUND', 'Project not found', 404);

  await Project.update(projectId, {
    salesforce: { ...(project.salesforce || {}), connection: null },
  });

  logSalesforceAudit({
    projectId,
    operation: 'auth.disconnect',
    riskLevel: 'auth_write',
    status: 'succeeded',
  });

  return { disconnected: true };
}

export async function getConnectionStatus(projectId) {
  const cli = checkHostCli();
  const conn = getProjectConnection(projectId);

  if (!conn) {
    return {
      connected: false,
      cli,
      connection: null,
      hostOrgs: cli.available ? listHostOrgs() : [],
    };
  }

  // Test if current token is still valid
  try {
    await testConnection(conn.instanceUrl, conn.accessToken, conn.apiVersion);
    return {
      connected: true,
      cli,
      connection: {
        instanceUrl: conn.instanceUrl,
        apiVersion: conn.apiVersion,
        username: conn.username,
        orgId: conn.orgId,
        displayName: conn.displayName,
        connectedAt: conn.connectedAt,
      },
      hostOrgs: cli.available ? listHostOrgs() : [],
    };
  } catch {
    return {
      connected: false,
      tokenExpired: true,
      cli,
      connection: {
        instanceUrl: conn.instanceUrl,
        username: conn.username,
        orgId: conn.orgId,
      },
      hostOrgs: cli.available ? listHostOrgs() : [],
    };
  }
}
