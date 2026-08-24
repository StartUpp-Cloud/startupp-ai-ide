import assert from 'node:assert/strict';
import {
  FALLBACK_CHATGPT_CODEX_MODELS,
  listSupportedCodexModels,
  parseCodexModelsCache,
  unwrapCodexErrorMessage,
} from '../codexModels.js';

const cache = {
  models: [
    {
      slug: 'gpt-5.6-sol',
      display_name: 'GPT-5.6-Sol',
      visibility: 'list',
      supported_in_api: true,
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }, { effort: 'xhigh' }],
    },
    {
      slug: 'gpt-5.3-codex-spark',
      display_name: 'GPT-5.3-Codex-Spark',
      visibility: 'list',
      supported_in_api: false,
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' }],
    },
    {
      slug: 'gpt-5.3-codex',
      display_name: 'GPT-5.3-Codex',
      visibility: 'list',
      supported_in_api: true,
      supported_reasoning_levels: [{ effort: 'high' }],
    },
    {
      slug: 'codex-auto-review',
      display_name: 'Codex Auto Review',
      visibility: 'hide',
      supported_in_api: true,
    },
  ],
};

const parsed = parseCodexModelsCache(JSON.stringify(cache));
assert.equal(parsed.length, 4);
assert.equal(parsed[1].id, 'gpt-5.3-codex-spark');
assert.deepEqual(parsed[1].efforts, ['low', 'medium', 'high', 'xhigh']);

const supported = listSupportedCodexModels(parsed);
assert.deepEqual(supported.map((m) => m.id), ['gpt-5.6-sol', 'gpt-5.3-codex-spark']);
assert.ok(supported.every((m) => m.visibility === 'list'));
assert.ok(FALLBACK_CHATGPT_CODEX_MODELS.some((m) => m.id === 'gpt-5.3-codex-spark'));
assert.ok(!FALLBACK_CHATGPT_CODEX_MODELS.some((m) => m.id === 'gpt-5.3-codex'));

assert.equal(
  unwrapCodexErrorMessage('{"type":"error","error":{"message":"The \'gpt-5.3-codex\' model is not supported when using Codex with a ChatGPT account."}}'),
  "The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.",
);
assert.equal(unwrapCodexErrorMessage('plain error'), 'plain error');

console.log('codexModels tests passed');
