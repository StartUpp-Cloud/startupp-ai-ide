import { containerManager } from '../containerManager.js';
import { detectSalesforceProject } from './salesforceDetectionService.js';
import { indexFlows } from './salesforceFlowService.js';
import { listSalesforceOrgs } from './salesforceOrgService.js';
import { redactUsername } from './salesforceRedaction.js';

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

async function countFiles(context, pattern) {
  const output = await containerManager.execInContainerAsync(
    context.containerName,
    `cd ${shellQuote(context.cwd)} && find . -path './.git' -prune -o -name ${shellQuote(pattern)} -type f -print 2>/dev/null | wc -l`,
    { timeout: 8000, maxBuffer: 64 * 1024 },
  );
  return Number(output?.trim()) || 0;
}

async function currentBranch(context) {
  const output = await containerManager.execInContainerAsync(
    context.containerName,
    `cd ${shellQuote(context.cwd)} && git branch --show-current 2>/dev/null || true`,
    { timeout: 5000, maxBuffer: 64 * 1024 },
  );
  return output?.trim() || null;
}

export async function buildCompactSalesforceContext(context) {
  const [detection, branch, apexClassCount, triggerCount, objectMetadataCount, flowIndex] = await Promise.all([
    detectSalesforceProject(context),
    currentBranch(context),
    countFiles(context, '*.cls-meta.xml'),
    countFiles(context, '*.trigger-meta.xml'),
    countFiles(context, '*.object-meta.xml'),
    indexFlows(context),
  ]);

  let defaultOrg = null;
  try {
    const orgs = (await listSalesforceOrgs(context)).orgs;
    const selected = orgs.find((org) => org.username === context.project.salesforce?.defaultOrgUsername) || orgs.find((org) => org.isDefault) || null;
    if (selected) {
      defaultOrg = {
        alias: selected.alias || null,
        usernameRedacted: selected.usernameRedacted || redactUsername(selected.username),
        orgType: selected.orgType || 'unknown',
      };
    }
  } catch {
    defaultOrg = null;
  }

  return {
    stack: 'salesforce',
    repoPath: context.repoPath,
    worktreePath: context.worktreePath,
    gitBranch: context.branch || branch,
    packageDirectories: detection.packageDirectories || [],
    metadataRoots: detection.metadataRoots || [],
    defaultOrg,
    indexedMetadataSummary: {
      apexClassCount,
      triggerCount,
      flowCount: flowIndex.flows.length,
      objectMetadataCount,
    },
  };
}
