/**
 * Pure file chunking + pointer dedup for the semantic code index.
 */

export function isProbablyBinary(content) {
  const sample = content.slice(0, 4000);
  return sample.includes('\x00');
}

function firstNonBlankLine(text) {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line) return line.slice(0, 120);
  }
  return '';
}

export function chunkFile(filePath, content, { windowLines = 60, overlapLines = 10 } = {}) {
  const lines = content.split('\n');
  const total = lines.length;
  const step = Math.max(1, windowLines - overlapLines);
  const chunks = [];
  for (let start = 0; start < total; start += step) {
    const end = Math.min(total, start + windowLines);
    const text = lines.slice(start, end).join('\n');
    chunks.push({
      filePath,
      startLine: start + 1,
      endLine: end,
      text,
      summary: firstNonBlankLine(text),
    });
    if (end >= total) break;
  }
  return chunks;
}

export function dedupePointers(pointers) {
  const bestByFile = new Map();
  for (const p of pointers) {
    const existing = bestByFile.get(p.filePath);
    if (!existing || p.score > existing.score) bestByFile.set(p.filePath, p);
  }
  return [...bestByFile.values()].sort((a, b) => b.score - a.score);
}
