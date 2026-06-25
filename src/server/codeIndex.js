/**
 * Semantic codebase indexer.
 * Enumerates source files via `git ls-files` inside the project container,
 * chunks + embeds them, and stores Float32 vectors in code_chunks.
 * Indexing is incremental: only files whose content hash changed are re-embedded.
 */
import crypto from 'node:crypto';
import { containerManager } from './containerManager.js';
import { llmProvider } from './llmProvider.js';
import { chunkFile, isProbablyBinary, dedupePointers } from './codeIndexChunker.js';
import { serializeVector, deserializeVector, topKByCosine } from './codeIndexMath.js';
import * as store from './sqliteStore.js';

const ALLOW_EXT = ['.js', '.jsx', '.ts', '.tsx', '.py', '.go', '.rb', '.java', '.rs', '.php', '.c', '.cpp', '.h', '.cs', '.css', '.scss', '.html', '.vue', '.svelte', '.md', '.json', '.yml', '.yaml', '.sql', '.sh'];
const MAX_FILES = 2000;
const MAX_FILE_BYTES = 200 * 1024; // skip files larger than 200KB
const EMBED_BATCH = 32;

export function hashContent(content) {
  return crypto.createHash('sha1').update(content).digest('hex');
}

export function parseGitLsFiles(stdout, { maxFiles = MAX_FILES, allowExt = ALLOW_EXT } = {}) {
  const out = [];
  for (const raw of (stdout || '').split('\n')) {
    const path = raw.trim();
    if (!path) continue;
    const dot = path.lastIndexOf('.');
    const ext = dot >= 0 ? path.slice(dot).toLowerCase() : '';
    if (!allowExt.includes(ext)) continue;
    out.push(path);
    if (out.length >= maxFiles) break;
  }
  return out;
}

async function listSourceFiles(containerName) {
  const stdout = await containerManager.execInContainerAsync(
    containerName,
    'cd /workspace && git ls-files 2>/dev/null || find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*"',
    { timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
  );
  return parseGitLsFiles(stdout || '');
}

async function readFile(containerName, relPath) {
  // base64 to survive arbitrary content through bash -c
  const out = await containerManager.execInContainerAsync(
    containerName,
    `cd /workspace && [ $(wc -c < '${relPath}') -le ${MAX_FILE_BYTES} ] && base64 '${relPath}'`,
    { timeout: 15000, maxBuffer: 12 * 1024 * 1024 },
  );
  if (!out) return null;
  try { return Buffer.from(out, 'base64').toString('utf-8'); } catch { return null; }
}

async function embedAndStore(projectId, relPath, content, embedModel) {
  if (isProbablyBinary(content)) return 0;
  const chunks = chunkFile(relPath, content);
  const contentHash = hashContent(content);
  const stored = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const vectors = await llmProvider.generateEmbeddings(batch.map(c => c.text));
    batch.forEach((c, j) => {
      stored.push({
        startLine: c.startLine,
        endLine: c.endLine,
        summary: c.summary,
        contentHash,
        embedding: serializeVector(vectors[j]),
      });
    });
  }
  store.replaceFileChunks(projectId, relPath, embedModel, stored);
  return stored.length;
}

export async function indexProject(project, { full = false } = {}) {
  const projectId = project.id;
  const containerName = project.containerName;
  if (!containerName) return { indexed: 0, skipped: 0, removed: 0, chunkCount: 0 };

  const embedModel = llmProvider.embeddingModelId();
  const meta = store.getIndexMeta(projectId);
  // model changed → must rebuild from scratch
  if (meta && meta.embedModel !== embedModel) full = true;
  if (full) store.clearProjectIndex(projectId);

  store.setIndexMeta(projectId, { embedModel, status: 'indexing', fileCount: meta?.fileCount || 0, chunkCount: meta?.chunkCount || 0, lastIndexedAt: meta?.lastIndexedAt || null });

  const files = await listSourceFiles(containerName);
  const existingHashes = full ? new Map() : store.getFileHashes(projectId);
  const present = new Set(files);

  let indexed = 0; let skipped = 0; let chunkCount = 0;
  for (const relPath of files) {
    const content = await readFile(containerName, relPath);
    if (content == null) { skipped++; continue; }
    const hash = hashContent(content);
    if (!full && existingHashes.get(relPath) === hash) { skipped++; continue; }
    chunkCount += await embedAndStore(projectId, relPath, content, embedModel);
    indexed++;
  }

  // remove chunks for files that no longer exist
  let removed = 0;
  for (const relPath of existingHashes.keys()) {
    if (!present.has(relPath)) { store.deleteFileChunks(projectId, relPath); removed++; }
  }

  store.setIndexMeta(projectId, {
    embedModel,
    status: 'ready',
    fileCount: files.length,
    chunkCount: store.getProjectChunks(projectId).length,
    lastIndexedAt: new Date().toISOString(),
  });
  return { indexed, skipped, removed, chunkCount };
}

export async function indexChangedFiles(project, filePaths) {
  const projectId = project.id;
  const containerName = project.containerName;
  if (!containerName || !filePaths?.length) return;
  const embedModel = llmProvider.embeddingModelId();
  for (const relPath of filePaths) {
    const dot = relPath.lastIndexOf('.');
    const ext = dot >= 0 ? relPath.slice(dot).toLowerCase() : '';
    if (!ALLOW_EXT.includes(ext)) continue;
    const content = await readFile(containerName, relPath);
    if (content == null) { store.deleteFileChunks(projectId, relPath); continue; }
    await embedAndStore(projectId, relPath, content, embedModel);
  }
}

export function rankChunks(queryVec, rows, k) {
  const withVecs = rows.map(r => ({
    filePath: r.file_path,
    startLine: r.start_line,
    endLine: r.end_line,
    summary: r.summary,
    embedding: deserializeVector(r.embedding),
  }));
  const top = topKByCosine(queryVec, withVecs, Math.max(k * 3, k));
  const pointers = top.map(({ embedding, ...rest }) => ({ ...rest, score: rest.score }));
  return dedupePointers(pointers).slice(0, k);
}

export async function retrieveRelevant(projectId, query, { k = 8 } = {}) {
  const rows = store.getProjectChunks(projectId);
  if (!rows.length) return [];
  const queryVec = await llmProvider.generateEmbedding(query);
  return rankChunks(queryVec, rows, k);
}
