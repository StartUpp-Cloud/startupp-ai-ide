import { containerManager } from '../containerManager.js';
import { logSalesforceAudit } from './salesforceAuditService.js';
import { redactSalesforceText, redactSalesforceObject, redactUsername } from './salesforceRedaction.js';
import { SalesforceApiError } from './salesforceErrors.js';

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

const OPERATIONS = {
  'cli.version': { args: () => ['sf', '--version'], timeout: 10000, riskLevel: 'read_only' },
  'org.list': { args: () => ['sf', 'org', 'list', '--json'], timeout: 20000, riskLevel: 'org_read' },
  'object.list': ({ targetOrg }) => ({
    args: ['sf', 'sobject', 'list', '--target-org', targetOrg, '--json'],
    timeout: 30000,
    riskLevel: 'org_read',
  }),
  'object.describe': ({ targetOrg, objectName }) => ({
    args: ['sf', 'sobject', 'describe', objectName, '--target-org', targetOrg, '--json'],
    timeout: 45000,
    riskLevel: 'org_read',
  }),
  'soql.query': ({ targetOrg, query }) => ({
    args: ['sf', 'data', 'query', '--query', query, '--target-org', targetOrg, '--json'],
    timeout: 45000,
    riskLevel: 'org_read',
  }),
};

function getOperationConfig(operation, args) {
  const entry = OPERATIONS[operation];
  if (!entry) throw new SalesforceApiError('OPERATION_NOT_ALLOWED', 'Salesforce operation is not allowed', 400);
  const config = typeof entry === 'function' ? entry(args) : entry;
  const operationArgs = typeof config.args === 'function' ? config.args(args) : config.args;
  if (operationArgs.some((arg) => arg === undefined || arg === null || arg === '')) {
    throw new SalesforceApiError('INVALID_OPERATION_ARGS', 'Missing Salesforce operation argument', 400);
  }
  return { ...config, args: operationArgs };
}

export async function runSalesforceOperation(context, operation, args = {}) {
  const startedAt = Date.now();
  const config = getOperationConfig(operation, args);
  const audit = logSalesforceAudit({
    projectId: context.projectId,
    repoPath: context.repoPath,
    worktreePath: context.worktreePath,
    operation,
    riskLevel: config.riskLevel,
    orgUsernameRedacted: redactUsername(args.targetOrg),
    status: 'started',
  });

  const command = `cd ${shellQuote(context.cwd)} && ${config.args.map(shellQuote).join(' ')}`;
  const output = await containerManager.execInContainerAsync(context.containerName, command, {
    timeout: config.timeout,
    maxBuffer: MAX_OUTPUT_BYTES,
  });

  if (output === null) {
    logSalesforceAudit({
      projectId: context.projectId,
      repoPath: context.repoPath,
      worktreePath: context.worktreePath,
      operation,
      riskLevel: config.riskLevel,
      status: 'failed',
      errorCode: 'COMMAND_FAILED',
      durationMs: Date.now() - startedAt,
    });
    throw new SalesforceApiError('COMMAND_FAILED', `Salesforce CLI operation failed: ${operation}`, 502);
  }

  if (Buffer.byteLength(output, 'utf8') > MAX_OUTPUT_BYTES) {
    throw new SalesforceApiError('OUTPUT_TOO_LARGE', 'Salesforce CLI output exceeded the allowed size', 413);
  }

  logSalesforceAudit({
    projectId: context.projectId,
    repoPath: context.repoPath,
    worktreePath: context.worktreePath,
    operation,
    riskLevel: config.riskLevel,
    status: 'succeeded',
    outputPreview: output,
    durationMs: Date.now() - startedAt,
  });

  const redactedOutput = redactSalesforceText(output);
  try {
    return { raw: redactedOutput, json: redactSalesforceObject(JSON.parse(output)), auditId: audit.id };
  } catch {
    return { raw: redactedOutput, json: null, auditId: audit.id };
  }
}

export async function checkSalesforceCli(context) {
  try {
    const result = await runSalesforceOperation(context, 'cli.version');
    return { available: true, command: 'sf', version: result.raw?.split('\n')[0] || null };
  } catch {
    return { available: false, command: null, version: null };
  }
}
