import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { isOpencodeQuietCompletion, parseOpencodeJsonOutput } from '../opencodeOutput.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const opencodeOutput = [
  '{"sessionID":"ses_test","type":"step-finish","reason":"stop","tokens":{"total":123},"cost":0}',
  '{"type":"step-start","part":{"type":"step-start"}}',
  '{"type":"text","part":{"type":"text","text":"Completed after a later text event."}}',
].join('\n');

const parsed = parseOpencodeJsonOutput(opencodeOutput, 'opencode run test --format json');
assert.equal(parsed.sessionId, 'ses_test');
assert.equal(parsed.finishReason, 'stop');
assert.equal(parsed.isError, false);
assert.equal(parsed.text, 'Completed after a later text event.');
assert.equal(isOpencodeQuietCompletion(opencodeOutput), true);

const telemetryOnly = parseOpencodeJsonOutput(
  [
    '{"sessionID":"ses_test","type":"step-finish","tokens":{"total":87047,"input":1932,"output":123},"cost":0}',
    '{"type":"step-start","part":{"type":"step-start"}}',
    '{"type":"text","timestamp":1778684398985,"part":{"type":"text","text":"I found the relevant code path."}}',
  ].join('\n'),
  'opencode run test --format json',
);
assert.equal(telemetryOnly.sessionId, 'ses_test');
assert.equal(telemetryOnly.isError, false);
assert.equal(telemetryOnly.text, 'I found the relevant code path.');

const contextLimit = parseOpencodeJsonOutput(
  '{"sessionID":"ses_test","type":"step-finish","reason":"length"}',
  'opencode run test --format json',
);
assert.equal(contextLimit.finishReason, 'length');
assert.equal(contextLimit.isError, true);

const explicitError = parseOpencodeJsonOutput(
  '{"sessionID":"ses_test","type":"error","error":{"message":"provider failed"}}',
  'opencode run test --format json',
);
assert.equal(explicitError.isError, true);

const nonzeroExit = parseOpencodeJsonOutput(
  '{"sessionID":"ses_test","type":"result","exitCode":1}',
  'opencode run test --format json',
);
assert.equal(nonzeroExit.isError, true);

const missingModel = parseOpencodeJsonOutput(
  'ProviderModelNotFoundError: Model not found: {"modelID":"\\\\s*["}',
  'opencode run test --format json',
);
assert.equal(missingModel.isError, true);
assert.equal(missingModel.isPermanentError, true);
assert.match(missingModel.text, /could not find this Ollama model/i);
assert.doesNotMatch(missingModel.text, /\\s\*\[/);

assert.equal(isOpencodeQuietCompletion('{"type":"step-start","part":{"type":"step-start"}}'), false);
assert.equal(isOpencodeQuietCompletion('{"type":"text","part":{"type":"text","text":"still streaming"}}'), false);

const gatewaySource = readFileSync(resolve(__dirname, '../agentGateway.js'), 'utf8');
assert.match(gatewaySource, /_silenceRetryMs\(tool, runCtx\)/);
assert.match(gatewaySource, /if \(tool === 'opencode'\) return CLI_SILENCE_RETRY_MS;/);
assert.match(gatewaySource, /tool === 'opencode' && isOpencodeQuietCompletion\(clean\)/);

console.log('agentGatewayOpencode tests passed');
