import { runSalesforceOperation } from './salesforceCommandService.js';
import { redactUsername } from './salesforceRedaction.js';

function normalizeOrg(raw, isDefault = false) {
  const username = raw.username || raw.alias || raw.loginUrl || 'unknown';
  const targetOrg = raw.alias || username;
  const orgType = raw.isScratchOrg ? 'scratch' : raw.isDevHub ? 'devhub' : raw.isSandbox ? 'sandbox' : raw.isSandbox === false ? 'production' : 'unknown';
  return {
    alias: raw.alias || null,
    username,
    targetOrg,
    usernameRedacted: redactUsername(username),
    orgId: raw.orgId || null,
    instanceUrl: raw.instanceUrl || null,
    isDefault: Boolean(isDefault || raw.isDefaultUsername || raw.isDefaultDevHubUsername),
    isExpired: Boolean(raw.isExpired || raw.connectedStatus === 'Expired'),
    orgType,
  };
}

export async function listSalesforceOrgs(context) {
  const result = await runSalesforceOperation(context, 'org.list');
  const data = result.privateJson?.result || result.json?.result || result.json || {};
  const orgs = [];
  const nonScratch = Array.isArray(data.nonScratchOrgs) ? data.nonScratchOrgs : [];
  const scratch = Array.isArray(data.scratchOrgs) ? data.scratchOrgs : [];
  for (const org of nonScratch) orgs.push(normalizeOrg(org));
  for (const org of scratch) orgs.push(normalizeOrg({ ...org, isScratchOrg: true }));
  return { orgs, auditId: result.auditId };
}
