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

/**
 * Get the SFDX auth URL from a host-authenticated org.
 * Runs: sf org display --target-org <usernameOrAlias> --verbose --json
 * The --verbose flag includes sfdxAuthUrl in the output.
 */
export function getOrgSfdxAuthUrl(usernameOrAlias) {
  const output = runHostCommand(
    `sf org display --target-org ${JSON.stringify(usernameOrAlias)} --verbose --json 2>/dev/null`,
    { timeout: 20000 }
  );
  if (!output) throw new SalesforceApiError('CLI_ORG_DISPLAY_FAILED', 'Could not retrieve org details from CLI. Ensure the org is authenticated on the host.', 502);

  try {
    const parsed = JSON.parse(output);
    const result = parsed?.result || parsed;
    if (!result.sfdxAuthUrl) {
      throw new SalesforceApiError('AUTH_URL_MISSING', 'CLI returned org info but no sfdxAuthUrl. Re-authenticate with: sf org login web', 401);
    }
    return {
      sfdxAuthUrl: result.sfdxAuthUrl,
      accessToken: result.accessToken,
      instanceUrl: result.instanceUrl?.replace(/\/+$/, ''),
      username: result.username,
      orgId: result.id || result.orgId,
      alias: result.alias || null,
      apiVersion: result.apiVersion || null,
    };
  } catch (error) {
    if (error instanceof SalesforceApiError) throw error;
    throw new SalesforceApiError('CLI_PARSE_ERROR', 'Failed to parse CLI output', 502);
  }
}

/**
 * Connect a Salesforce environment for a project.
 * 1. Gets SFDX auth URL from host CLI
 * 2. Imports it into the project container with the appropriate alias
 * 3. Stores connection metadata in the project model
 *
 * @param {string} projectId
 * @param {string} envType - 'sandbox' or 'production'
 * @param {string} hostUsernameOrAlias - the org username/alias on the host CLI
 */
export async function connectEnvironment(projectId, envType, hostUsernameOrAlias) {
  if (!['sandbox', 'production'].includes(envType)) {
    throw new SalesforceApiError('INVALID_ENV_TYPE', 'envType must be "sandbox" or "production"', 400);
  }

  const containerAlias = envType === 'sandbox' ? 'my-sandbox' : 'production';

  // 1. Get auth URL and token from host
  const orgInfo = getOrgSfdxAuthUrl(hostUsernameOrAlias);

  // 2. Validate the token with a REST API call
  const resolvedApiVersion = orgInfo.apiVersion ? `v${orgInfo.apiVersion}` : 'v62.0';
  await testConnection(orgInfo.instanceUrl, orgInfo.accessToken, resolvedApiVersion);

  // 3. Import auth URL into container
  const project = Project.findById(projectId);
  if (!project) throw new SalesforceApiError('PROJECT_NOT_FOUND', 'Project not found', 404);
  if (!project.containerName) throw new SalesforceApiError('NO_CONTAINER', 'Project has no container', 400);

  // Use importSalesforceAuthUrl from command service
  const { importSalesforceAuthUrl } = await import('./salesforceCommandService.js');
  const { resolveSalesforceContext } = await import('./salesforceContextResolver.js');

  const context = await resolveSalesforceContext({ projectId });
  await importSalesforceAuthUrl(context, {
    authUrl: orgInfo.sfdxAuthUrl,
    alias: containerAlias,
    setDefault: envType === 'production',
  });

  // 4. Store connection metadata in project model
  const existingEnvs = project.salesforce?.environments || {};
  const envData = {
    connected: true,
    username: orgInfo.username,
    instanceUrl: orgInfo.instanceUrl,
    orgId: orgInfo.orgId,
    apiVersion: resolvedApiVersion,
    connectedAt: new Date().toISOString(),
    alias: containerAlias,
    accessToken: encrypt(orgInfo.accessToken),
  };

  await Project.update(projectId, {
    stack: 'salesforce',
    salesforce: {
      ...(project.salesforce || {}),
      environments: {
        ...existingEnvs,
        [envType]: envData,
      },
      // Keep legacy connection field pointing to the most recently connected env
      connection: {
        accessToken: encrypt(orgInfo.accessToken),
        instanceUrl: orgInfo.instanceUrl,
        apiVersion: resolvedApiVersion,
        username: orgInfo.username,
        orgId: orgInfo.orgId,
        connectedAt: new Date().toISOString(),
      },
    },
  });

  logSalesforceAudit({
    projectId,
    operation: `auth.connect.${envType}`,
    riskLevel: 'auth_write',
    status: 'succeeded',
  });

  return {
    envType,
    alias: containerAlias,
    username: orgInfo.username,
    instanceUrl: orgInfo.instanceUrl,
    orgId: orgInfo.orgId,
    apiVersion: resolvedApiVersion,
  };
}

/**
 * Get comprehensive setup status for a project's Salesforce environments.
 */
export async function getSetupStatus(projectId) {
  const hostCli = checkHostCli();
  const hostOrgs = hostCli.available ? listHostOrgs() : [];

  const project = Project.findById(projectId);
  if (!project) throw new SalesforceApiError('PROJECT_NOT_FOUND', 'Project not found', 404);

  const environments = project.salesforce?.environments || {};

  // Check container CLI if container exists and is running
  let containerCli = { available: false, version: null };
  if (project.containerName) {
    try {
      const { resolveSalesforceContext } = await import('./salesforceContextResolver.js');
      const { checkSalesforceCli } = await import('./salesforceCommandService.js');
      const context = await resolveSalesforceContext({ projectId });
      containerCli = await checkSalesforceCli(context);
    } catch {
      // Container not running or not found
    }
  }

  // For each environment, check if token is still valid
  const envStatus = {};
  for (const envType of ['sandbox', 'production']) {
    const env = environments[envType];
    if (!env?.connected || !env?.accessToken) {
      envStatus[envType] = { connected: false };
      continue;
    }

    try {
      const token = decrypt(env.accessToken);
      await testConnection(env.instanceUrl, token, env.apiVersion || 'v62.0');
      envStatus[envType] = {
        connected: true,
        username: env.username,
        instanceUrl: env.instanceUrl,
        orgId: env.orgId,
        apiVersion: env.apiVersion,
        connectedAt: env.connectedAt,
        alias: env.alias,
      };
    } catch {
      envStatus[envType] = {
        connected: false,
        tokenExpired: true,
        username: env.username,
        instanceUrl: env.instanceUrl,
      };
    }
  }

  return {
    hostCli,
    hostOrgs,
    containerCli,
    hasContainer: !!project.containerName,
    environments: envStatus,
  };
}

export async function disconnectEnvironment(projectId, envType) {
  if (!['sandbox', 'production'].includes(envType)) {
    throw new SalesforceApiError('INVALID_ENV_TYPE', 'envType must be "sandbox" or "production"', 400);
  }

  const project = Project.findById(projectId);
  if (!project) throw new SalesforceApiError('PROJECT_NOT_FOUND', 'Project not found', 404);

  const existingEnvs = project.salesforce?.environments || {};
  existingEnvs[envType] = { connected: false };

  await Project.update(projectId, {
    salesforce: {
      ...(project.salesforce || {}),
      environments: existingEnvs,
    },
  });

  logSalesforceAudit({
    projectId,
    operation: `auth.disconnect.${envType}`,
    riskLevel: 'auth_write',
    status: 'succeeded',
  });

  return { disconnected: true, envType };
}

export async function refreshEnvironment(projectId, envType) {
  const project = Project.findById(projectId);
  if (!project) throw new SalesforceApiError('PROJECT_NOT_FOUND', 'Project not found', 404);

  const env = project.salesforce?.environments?.[envType];
  if (!env?.username) {
    throw new SalesforceApiError('NO_CONNECTION', `No ${envType} connection found. Connect first.`, 400);
  }

  // Re-run the full connect flow using the stored username
  return connectEnvironment(projectId, envType, env.username);
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
