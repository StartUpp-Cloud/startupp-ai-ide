import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const subAgentInstruction = /Spin up as many focused sub-agents as needed to complete the task efficiently, promptly, and correctly; give each sub-agent proper, rich context\./;
const __dirname = dirname(fileURLToPath(import.meta.url));

{
  const agentGatewaySource = readFileSync(resolve(__dirname, '../agentGateway.js'), 'utf8');

  assert.match(
    agentGatewaySource,
    subAgentInstruction,
    'Autonomous execution preamble should encourage focused sub-agents with rich context',
  );
  assert.match(
    agentGatewaySource,
    /resolveSalesforceContext\(\{[\s\S]*repoPath: sessionMeta\?\.repoPath[\s\S]*worktreePath: sessionMeta\?\.worktreePath[\s\S]*branch: sessionMeta\?\.branch/,
    'Salesforce prompt context should use the selected repo/worktree/branch resolver context',
  );
  assert.match(
    agentGatewaySource,
    /fullMessage = `\$\{salesforceContext\}\\n\\n---\\n\\n\$\{fullMessage\}`/,
    'Salesforce compact context should be injected into CLI prompts',
  );
  assert.match(
    agentGatewaySource,
    /agentShellPool\.write\(shellSessionId, 'n\\n'\)/,
    'Unresolved auto-confirm prompts should receive a safe decline fallback',
  );
  assert.match(
    agentGatewaySource,
    /_resolveAttachmentPaths\(attachments, projectId\)/,
    'All attachments, including large CSV/text files, should get container-readable paths',
  );
  assert.match(
    agentGatewaySource,
    /Content of \$\{att\.name\} \(\$\{resolved\}\)/,
    'Inline text attachments should include the resolved container path for continuity',
  );
}

{
  const agentOrchestratorSource = readFileSync(resolve(__dirname, '../agentOrchestrator.js'), 'utf8');

  assert.match(
    agentOrchestratorSource,
    subAgentInstruction,
    'Orchestrated child task prompts should encourage focused sub-agents with rich context',
  );
  assert.match(
    agentOrchestratorSource,
    /for \(const field of \['branch', 'repoPath', 'worktreePath', 'workDir', 'cwd'\]\)/,
    'Orchestrated child sessions should inherit parent workspace metadata',
  );
  assert.match(
    agentOrchestratorSource,
    /active\.agentSessionIds\.add\(agentSession\.id\)/,
    'Orchestrator should track all active child agent sessions for cancellation',
  );
  assert.match(
    agentOrchestratorSource,
    /attachments: opts\.attachments \|\| \[\]/,
    'Orchestrated child agent sessions should receive the user attachments',
  );
  assert.match(
    agentOrchestratorSource,
    /this\._xmlBlock\('attached_files'/,
    'Orchestrator handoffs should explicitly list attached files',
  );
  assert.match(
    agentOrchestratorSource,
    /Treat attached files as authoritative/,
    'Coding agents should not substitute similarly named workspace files for uploads',
  );
}

console.log('agentExecutionPrompts tests passed');
