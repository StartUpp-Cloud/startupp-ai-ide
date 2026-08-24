import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, '../agentOrchestrator.js'), 'utf8');

assert.match(
  source,
  /const workContext = this\._runWorkContext\(run\);[\s\S]*?_xmlBlock\('ide_selected_workspace', workContext\)/,
  'Child task prompts should include an XML-delimited IDE-selected workspace context block',
);

assert.match(
  source,
  /lines\.push\(`- Branch: \$\{branch \|\| '\(none selected\)'\}`\);[\s\S]*?lines\.push\(`- repoPath: \$\{repoPath \|\| '\(none selected\)'\}`\);[\s\S]*?lines\.push\(`- worktreePath: \$\{worktreePath \|\| '\(none selected\)'\}`\);[\s\S]*?lines\.push\(`- Working directory: \$\{workDir\}`\);/,
  'Workspace context should include branch, repoPath, worktreePath, and resolved working directory',
);

assert.match(
  source,
  /All file reads, edits, commands, tests, commits, deploys, and PR operations must target \$\{workDir\}\./,
  'Task prompts should explicitly instruct child agents to use the resolved working directory',
);

assert.match(
  source,
  /for \(const field of \['branch', 'repoPath', 'worktreePath', 'workDir', 'cwd'\]\) \{[\s\S]*?if \(parentSession\?\.\[field\]\) inheritedContext\[field\] = parentSession\[field\];[\s\S]*?parentSessionId: run\.sessionId,[\s\S]*?\.\.\.inheritedContext/,
  'Child agent sessions should inherit parent branch/repo/worktree/cwd metadata and parentSessionId',
);

assert.match(
  source,
  /const sessionWorkDir = task\.data\?\.workDir[\s\S]*?inheritedContext\.workDir \|\| inheritedContext\.cwd \|\| this\._sessionWorkDirFromMeta\(inheritedContext\);/,
  'Child session workDir should prefer inherited workDir/cwd before worktree/repo fallback',
);

console.log('orchestratorContext tests passed');
