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
}

{
  const agentOrchestratorSource = readFileSync(resolve(__dirname, '../agentOrchestrator.js'), 'utf8');

  assert.match(
    agentOrchestratorSource,
    subAgentInstruction,
    'Orchestrated child task prompts should encourage focused sub-agents with rich context',
  );
}

console.log('agentExecutionPrompts tests passed');
