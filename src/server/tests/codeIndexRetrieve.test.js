import assert from 'node:assert/strict';
import { serializeVector } from '../codeIndexMath.js';
import { rankChunks } from '../codeIndex.js';

const rows = [
  { file_path: 'a.js', start_line: 1, end_line: 60, summary: 'alpha', embedding: serializeVector([1, 0]) },
  { file_path: 'a.js', start_line: 50, end_line: 110, summary: 'alpha2', embedding: serializeVector([0.95, 0.05]) },
  { file_path: 'b.js', start_line: 1, end_line: 60, summary: 'beta', embedding: serializeVector([0, 1]) },
];

const pointers = rankChunks([1, 0], rows, 8);
// dedup keeps one pointer per file; a.js (best cosine) ranks above b.js
assert.equal(pointers.length, 2, 'one pointer per file');
assert.equal(pointers[0].filePath, 'a.js', 'closest file first');
assert.equal(pointers[1].filePath, 'b.js', 'orthogonal file last');
assert.ok('startLine' in pointers[0] && 'summary' in pointers[0], 'pointer shape: path+lines+summary');
assert.ok(!('text' in pointers[0]) && !('embedding' in pointers[0]), 'pointers carry NO file text or raw vector');
