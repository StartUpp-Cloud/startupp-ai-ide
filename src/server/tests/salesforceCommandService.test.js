import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, '../salesforce/salesforceCommandService.js'), 'utf8');
const orgSource = readFileSync(resolve(__dirname, '../salesforce/salesforceOrgService.js'), 'utf8');
const contextSource = readFileSync(resolve(__dirname, '../salesforce/salesforceContextResolver.js'), 'utf8');

assert.match(
  source,
  /'object\.list': \(\{ targetOrg \}\) => \(\{\s*args: \['sf', 'sobject', 'list', '--sobject', 'all', '--target-org', targetOrg, '--json'\]/,
  'object.list should use the required sf sobject list --sobject all flag',
);

assert.match(
  source,
  /'object\.describe': \(\{ targetOrg, objectName \}\) => \(\{\s*args: \['sf', 'sobject', 'describe', '--sobject', objectName, '--target-org', targetOrg, '--json'\]/,
  'object.describe should pass the object name with --sobject',
);

assert.match(
  source,
  /return \{ raw: redactedOutput, json: redactSalesforceObject\(json\), privateJson: json, auditId: audit\.id \};/,
  'default service JSON should stay redacted while privateJson remains available for internal follow-up actions',
);

assert.match(
  orgSource,
  /const data = result\.privateJson\?\.result \|\| result\.json\?\.result \|\| result\.json \|\| \{\};/,
  'org discovery should prefer private CLI JSON so targetOrg is usable for follow-up CLI actions',
);

assert.match(
  contextSource,
  /normalized !== '\/workspace' && !normalized\.startsWith\('\/workspace\/'\)/,
  'Salesforce context should reject cwd paths outside /workspace',
);

assert.match(
  contextSource,
  /cwd: resolvedWorktreePath \|\| resolvedRepoPath \|\| '\/workspace'/,
  'Salesforce context should prefer worktreePath, then repoPath, then /workspace',
);

console.log('salesforceCommandService tests passed');
