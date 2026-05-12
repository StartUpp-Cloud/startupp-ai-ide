import { checkSalesforceCli } from './salesforceCommandService.js';
import { listSalesforceOrgs } from './salesforceOrgService.js';
import { detectSalesforceProject } from './salesforceDetectionService.js';

export async function getSalesforceStatus(context) {
  const [cli, detection] = await Promise.all([
    checkSalesforceCli(context),
    detectSalesforceProject(context),
  ]);

  let orgs = [];
  let orgWarning = null;
  if (cli.available) {
    try {
      orgs = (await listSalesforceOrgs(context)).orgs;
    } catch {
      orgWarning = 'Salesforce CLI is available, but org discovery failed. Check CLI auth in the project terminal.';
    }
  }

  return {
    projectId: context.projectId,
    stack: context.project.stack || 'generic',
    stackManualOverride: context.project.stackManualOverride === true,
    detection,
    container: { name: context.containerName, running: true },
    context: {
      cwd: context.cwd,
      repoPath: context.repoPath,
      worktreePath: context.worktreePath,
      branch: context.branch,
    },
    cli,
    orgs,
    selectedOrg: orgs.find((org) => org.username === context.project.salesforce?.defaultOrgUsername) || orgs.find((org) => org.isDefault) || null,
    packageDirectories: detection.packageDirectories || [],
    metadataRoots: detection.metadataRoots || [],
    warnings: [orgWarning].filter(Boolean),
  };
}
