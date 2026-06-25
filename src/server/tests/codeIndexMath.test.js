import assert from 'node:assert/strict';
import { cosineSimilarity, serializeVector, deserializeVector, topKByCosine } from '../codeIndexMath.js';

// cosine of identical vectors = 1
assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [1, 0, 0]) - 1) < 1e-6, 'identical → 1');
// cosine of orthogonal vectors = 0
assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-6, 'orthogonal → 0');
// zero vector → 0 (no NaN)
assert.equal(cosineSimilarity([0, 0], [1, 1]), 0, 'zero vector → 0, not NaN');

// serialize/deserialize round-trips within float32 precision
const v = [0.5, -0.25, 1.5, 0];
const round = deserializeVector(serializeVector(v));
assert.equal(round.length, v.length, 'length preserved');
for (let i = 0; i < v.length; i++) assert.ok(Math.abs(round[i] - v[i]) < 1e-6, `elem ${i} preserved`);

// topK ranks by similarity and attaches score, respects k
const rows = [
  { id: 'a', embedding: [1, 0] },
  { id: 'b', embedding: [0, 1] },
  { id: 'c', embedding: [0.9, 0.1] },
];
const top = topKByCosine([1, 0], rows, 2);
assert.equal(top.length, 2, 'returns k results');
assert.equal(top[0].id, 'a', 'best match first');
assert.equal(top[1].id, 'c', 'second best second');
assert.ok(typeof top[0].score === 'number', 'score attached');
