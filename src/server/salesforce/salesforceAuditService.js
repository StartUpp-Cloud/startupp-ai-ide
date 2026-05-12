import { activityFeed } from '../activityFeed.js';
import { redactSalesforceText } from './salesforceRedaction.js';

export function logSalesforceAudit({
  projectId,
  repoPath = null,
  worktreePath = null,
  operation,
  riskLevel = 'read_only',
  orgUsernameRedacted = null,
  orgType = 'unknown',
  status = 'started',
  errorCode = null,
  outputPreview = null,
  durationMs = null,
}) {
  return activityFeed.log({
    projectId,
    type: 'salesforce-operation',
    title: `Salesforce ${operation} ${status}`,
    detail: errorCode || undefined,
    duration: durationMs || undefined,
    metadata: {
      repoPath,
      worktreePath,
      operation,
      riskLevel,
      orgUsernameRedacted,
      orgType,
      status,
      errorCode,
      outputPreviewRedacted: outputPreview ? redactSalesforceText(outputPreview).slice(0, 1000) : null,
    },
  });
}
