import assert from 'node:assert/strict';
import { pickEmbeddingProvider } from '../llmProvider.js';

// active provider is embedding-capable → use it
assert.deepEqual(
  pickEmbeddingProvider({ provider: 'openai', openai: {}, ollama: {} }),
  { provider: 'openai', model: 'text-embedding-3-small' },
  'openai active → openai embeddings',
);
assert.deepEqual(
  pickEmbeddingProvider({ provider: 'ollama', ollama: { embedModel: 'nomic-embed-text' } }),
  { provider: 'ollama', model: 'nomic-embed-text' },
  'ollama active → ollama embeddings',
);
// non-embedding provider (deepseek/github/opencode) → fall back to local ollama
assert.deepEqual(
  pickEmbeddingProvider({ provider: 'deepseek', ollama: {} }),
  { provider: 'ollama', model: 'nomic-embed-text' },
  'deepseek active → ollama fallback',
);
// explicit per-provider embed model override is honored
assert.deepEqual(
  pickEmbeddingProvider({ provider: 'openai', openai: { embedModel: 'text-embedding-3-large' } }),
  { provider: 'openai', model: 'text-embedding-3-large' },
  'openai embedModel override honored',
);
