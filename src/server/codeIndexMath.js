/**
 * Pure vector math + BLOB serialization for the semantic code index.
 * No DB, no I/O — unit-testable in isolation.
 */

export function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function serializeVector(vec) {
  const f32 = Float32Array.from(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

export function deserializeVector(buf) {
  // Copy into an aligned ArrayBuffer to be safe across Buffer pooling.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return Array.from(new Float32Array(ab));
}

export function topKByCosine(queryVec, rows, k) {
  const scored = rows.map(row => ({ ...row, score: cosineSimilarity(queryVec, row.embedding) }));
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, k);
}
