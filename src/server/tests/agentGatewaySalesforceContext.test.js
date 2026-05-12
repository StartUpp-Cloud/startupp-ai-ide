import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const gatewaySource = readFileSync(resolve(__dirname, '../agentGateway.js'), 'utf8');
const resolverSource = readFileSync(resolve(__dirname, '../salesforce/salesforceContextResolver.js'), 'utf8');
const contextServiceSource = readFileSync(resolve(__dirname, '../salesforce/salesforceContextService.js'), 'utf8');

assert.match(
  gatewaySource,
  /if \(project\?\.stack !== 'salesforce'\) return '';/,
  'Salesforce compact context injection should be limited to Salesforce projects',
);

assert.match(
  gatewaySource,
  /resolveSalesforceContext\(\{[\s\S]*?projectId,[\s\S]*?repoPath: sessionMeta\?\.repoPath \|\| null,[\s\S]*?worktreePath: sessionMeta\?\.worktreePath \|\| null,[\s\S]*?branch: sessionMeta\?\.branch \|\| null,[\s\S]*?\}\)/,
  'Salesforce prompt context should preserve selected project, repoPath, worktreePath, and branch',
);

assert.match(
  gatewaySource,
  /const compact = await buildCompactSalesforceContext\(context\);/,
  'Agent gateway should build compact Salesforce context before prompt injection',
);

assert.match(
  gatewaySource,
  /\[Salesforce Project Context[\s\S]*?`- cwd: \$\{context\.cwd\}`,[\s\S]*?`- repoPath: \$\{compact\.repoPath \|\| '\(none selected\)'\}`,[\s\S]*?`- worktreePath: \$\{compact\.worktreePath \|\| '\(none selected\)'\}`,[\s\S]*?`- gitBranch: \$\{compact\.gitBranch \|\| '\(unknown\)'\}`/,
  'Compact Salesforce prompt context should include cwd, repoPath, worktreePath, and git branch',
);

assert.match(
  gatewaySource,
  /if \(salesforceContext\) \{\s*fullMessage = `\$\{salesforceContext\}\\n\\n---\\n\\n\$\{fullMessage\}`;\s*\}/,
  'Salesforce compact context should be injected ahead of CLI prompts',
);

assert.match(
  resolverSource,
  /if \(normalized\.includes\('\\0'\) \|\| \(normalized !== '\/workspace' && !normalized\.startsWith\('\/workspace\/'\)\)\) \{[\s\S]*?PATH_OUTSIDE_WORKSPACE/,
  'Salesforce context resolver should reject paths outside the /workspace boundary',
);

assert.match(
  resolverSource,
  /const resolvedWorktreePath = worktreePath \? assertWorkspacePath\(worktreePath, \{ allowWorkspaceRoot: false \}\) : null;[\s\S]*?const resolvedRepoPath = repoPath \? assertWorkspacePath\(repoPath, \{ allowWorkspaceRoot: false \}\) : null;[\s\S]*?cwd: resolvedWorktreePath \|\| resolvedRepoPath \|\| '\/workspace'/,
  'Salesforce context cwd should prefer validated worktreePath, then repoPath, then /workspace',
);

assert.match(
  contextServiceSource,
  /`cd \$\{shellQuote\(context\.cwd\)\} && git branch --show-current/,
  'Compact context discovery should run from the resolved Salesforce cwd',
);

console.log('agentGatewaySalesforceContext tests passed');
