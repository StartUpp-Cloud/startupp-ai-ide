import { containerManager } from '../containerManager.js';
import { logSalesforceAudit } from './salesforceAuditService.js';
import { redactSalesforceText, redactSalesforceObject, redactUsername } from './salesforceRedaction.js';
import { SalesforceApiError } from './salesforceErrors.js';

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const SAFE_ALIAS_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

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

export async function installSalesforceCli(context) {
  const startedAt = Date.now();
  const operation = 'cli.install';
  const audit = logSalesforceAudit({
    projectId: context.projectId,
    repoPath: context.repoPath,
    worktreePath: context.worktreePath,
    operation,
    riskLevel: 'setup',
    status: 'started',
  });

  const command = [
    `cd ${shellQuote(context.cwd)}`,
    'if command -v sf >/dev/null 2>&1; then sf --version; elif command -v npm >/dev/null 2>&1; then npm install --global @salesforce/cli && sf --version; else echo "npm is required to install Salesforce CLI" >&2; exit 127; fi',
  ].join(' && ');
  const output = await containerManager.execInContainerAsync(context.containerName, command, {
    timeout: 180000,
    maxBuffer: MAX_OUTPUT_BYTES,
  });

  if (output === null) {
    logSalesforceAudit({
      projectId: context.projectId,
      repoPath: context.repoPath,
      worktreePath: context.worktreePath,
      operation,
      riskLevel: 'setup',
      status: 'failed',
      errorCode: 'CLI_INSTALL_FAILED',
      durationMs: Date.now() - startedAt,
    });
    throw new SalesforceApiError('CLI_INSTALL_FAILED', 'Salesforce CLI install failed inside the project container', 502);
  }

  logSalesforceAudit({
    projectId: context.projectId,
    repoPath: context.repoPath,
    worktreePath: context.worktreePath,
    operation,
    riskLevel: 'setup',
    status: 'succeeded',
    outputPreview: output,
    durationMs: Date.now() - startedAt,
  });

  return { raw: redactSalesforceText(output), version: output.split('\n').filter(Boolean).at(-1) || null, auditId: audit.id };
}

function extractSalesforceAuthUrl(input) {
  const value = String(input || '').trim();
  if (!value) throw new SalesforceApiError('AUTH_URL_REQUIRED', 'Paste the Salesforce auth URL before importing', 400);

  try {
    const parsed = JSON.parse(value);
    const url = parsed?.result?.sfdxAuthUrl || parsed?.sfdxAuthUrl || parsed?.authUrl;
    if (url) return String(url).trim();
  } catch {
    // Plain auth URL paste is expected; JSON paste is optional convenience.
  }

  return value;
}

export async function importSalesforceAuthUrl(context, { authUrl, alias, setDefault = true } = {}) {
  const normalizedAuthUrl = extractSalesforceAuthUrl(authUrl);
  if (!normalizedAuthUrl.startsWith('force://')) {
    throw new SalesforceApiError('INVALID_AUTH_URL', 'Expected an SFDX auth URL starting with force://', 400);
  }
  if (alias && !SAFE_ALIAS_PATTERN.test(alias)) {
    throw new SalesforceApiError('INVALID_ALIAS', 'Alias can contain only letters, numbers, dots, underscores, and dashes', 400);
  }

  const startedAt = Date.now();
  const operation = 'org.auth.import';
  const audit = logSalesforceAudit({
    projectId: context.projectId,
    repoPath: context.repoPath,
    worktreePath: context.worktreePath,
    operation,
    riskLevel: 'auth_write',
    status: 'started',
  });

  const encodedAuthUrl = Buffer.from(normalizedAuthUrl, 'utf8').toString('base64');
  const args = ['sf', 'org', 'login', 'sfdx-url', '--sfdx-url-file', '$tmp', '--json'];
  if (alias) args.push('--alias', alias);
  if (setDefault) args.push('--set-default');
  const command = [
    `cd ${shellQuote(context.cwd)}`,
    'tmp=$(mktemp)',
    'trap "rm -f $tmp" EXIT',
    `printf %s ${shellQuote(encodedAuthUrl)} | base64 -d > "$tmp"`,
    args.map((arg) => (arg === '$tmp' ? '"$tmp"' : shellQuote(arg))).join(' '),
  ].join(' && ');
  const output = await containerManager.execInContainerAsync(context.containerName, command, {
    timeout: 30000,
    maxBuffer: MAX_OUTPUT_BYTES,
  });

  if (output === null) {
    logSalesforceAudit({
      projectId: context.projectId,
      repoPath: context.repoPath,
      worktreePath: context.worktreePath,
      operation,
      riskLevel: 'auth_write',
      status: 'failed',
      errorCode: 'AUTH_IMPORT_FAILED',
      durationMs: Date.now() - startedAt,
    });
    throw new SalesforceApiError('AUTH_IMPORT_FAILED', 'Salesforce auth import failed inside the project container', 502);
  }

  logSalesforceAudit({
    projectId: context.projectId,
    repoPath: context.repoPath,
    worktreePath: context.worktreePath,
    operation,
    riskLevel: 'auth_write',
    status: 'succeeded',
    outputPreview: output,
    durationMs: Date.now() - startedAt,
  });

  try {
    return { raw: redactSalesforceText(output), json: redactSalesforceObject(JSON.parse(output)), auditId: audit.id };
  } catch {
    return { raw: redactSalesforceText(output), json: null, auditId: audit.id };
  }
}
