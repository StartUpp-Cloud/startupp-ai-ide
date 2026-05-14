import assert from 'node:assert/strict';
import { agentGateway } from '../agentGateway.js';

const resultEvent = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Waiting for your answers on those two questions before proceeding.',
  session_id: 'claude-session-1',
  permission_denials: [{
    tool_name: 'AskUserQuestion',
    tool_input: {
      questions: [
        {
          question: 'Where should docs live?',
          header: 'Docs location',
          options: [
            { label: 'Root docs/', description: 'Use root docs for cross-project docs' },
            { label: 'Repo docs/', description: 'Keep repo-specific docs in each repo' },
          ],
          multiSelect: false,
        },
        {
          question: 'Confirm these folders should be deleted: old-app/, tmp-repo/?',
          header: 'Remove items',
          options: [
            { label: 'Archive first', description: 'Move to archive/ before deletion' },
            { label: 'Delete now', description: 'Remove permanently' },
          ],
          multiSelect: false,
        },
      ],
    },
  }],
};

const parsed = agentGateway._parseJsonToolOutput(JSON.stringify(resultEvent), 'claude -p test');

assert.equal(parsed.sessionId, 'claude-session-1');
assert.equal(parsed.requiresUserInput, true);
assert.equal(parsed.isError, false);
assert.match(parsed.text, /The coding agent needs your input/i);
assert.match(parsed.text, /Where should docs live\?/);
assert.match(parsed.text, /Root docs\/.*cross-project docs/);
assert.match(parsed.text, /Confirm these folders should be deleted/);
assert.doesNotMatch(parsed.text, /^Waiting for your answers/i);

const toolUseOnly = agentGateway._parseJsonToolOutput([
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 'claude-session-2' }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'I need to inspect files.' }] }, session_id: 'claude-session-2' }),
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', stop_reason: 'tool_use', session_id: 'claude-session-2' }),
].join('\n'), 'claude -p test');

assert.equal(toolUseOnly.sessionId, 'claude-session-2');
assert.equal(toolUseOnly.isIncomplete, true);
assert.match(toolUseOnly.text, /tool-use turn before returning a final answer/i);

console.log('agentGatewayClaudeQuestions tests passed');
