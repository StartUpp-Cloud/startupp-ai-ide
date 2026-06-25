import assert from 'node:assert/strict';
import { chunkFile, isProbablyBinary, dedupePointers } from '../codeIndexChunker.js';

// chunking: a 150-line file with window 60 / overlap 10 → 3 chunks covering all lines
const content = Array.from({ length: 150 }, (_, i) => `line ${i + 1}`).join('\n');
const chunks = chunkFile('src/foo.js', content, { windowLines: 60, overlapLines: 10 });
assert.ok(chunks.length >= 3, 'splits into multiple windows');
assert.equal(chunks[0].startLine, 1, 'first chunk starts at line 1');
assert.equal(chunks[0].filePath, 'src/foo.js', 'filePath carried');
assert.ok(chunks[chunks.length - 1].endLine >= 150, 'last chunk reaches EOF');
// overlap: second chunk starts before previous chunk ends
assert.ok(chunks[1].startLine < chunks[0].endLine, 'windows overlap');

// summary is first non-blank line
const c2 = chunkFile('a.js', '\n\n  hello world  \nmore', { windowLines: 60 });
assert.equal(c2[0].summary, 'hello world', 'summary = first non-blank trimmed line');

// binary detection
assert.equal(isProbablyBinary('plain text'), false, 'text is not binary');
assert.equal(isProbablyBinary('abc\x00def'), true, 'NUL byte → binary');

// dedupe: keep best score per file
const deduped = dedupePointers([
  { filePath: 'a.js', startLine: 1, endLine: 60, summary: 'x', score: 0.4 },
  { filePath: 'a.js', startLine: 50, endLine: 110, summary: 'y', score: 0.9 },
  { filePath: 'b.js', startLine: 1, endLine: 60, summary: 'z', score: 0.7 },
]);
assert.equal(deduped.length, 2, 'one pointer per file');
assert.equal(deduped[0].filePath, 'a.js', 'highest score first');
assert.equal(deduped[0].score, 0.9, 'kept the best chunk for a.js');
