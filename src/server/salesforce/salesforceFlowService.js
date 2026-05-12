import crypto from 'crypto';
import { containerManager } from '../containerManager.js';
import { parseFlowMetadata, flowMatches } from './salesforceFlowParser.js';

const MAX_FLOW_FILES = 500;
const MAX_FLOW_BYTES = 256 * 1024;
const CACHE_TTL_MS = 5 * 60 * 1000;
const flowCache = new Map();

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function cacheKey(context) {
  return JSON.stringify({ projectId: context.projectId, cwd: context.cwd, branch: context.branch });
}

function excerpt(xml, tokens) {
  const lines = String(xml || '').split('\n');
  const loweredTokens = tokens.filter(Boolean).map((token) => String(token).toLowerCase());
  const matches = [];
  lines.forEach((line, index) => {
    const lowered = line.toLowerCase();
    if (loweredTokens.some((token) => lowered.includes(token))) {
      matches.push(`${index + 1}: ${line.trim()}`.slice(0, 300));
    }
  });
  return matches.slice(0, 8);
}

async function listFlowFiles(context) {
  const output = await containerManager.execInContainerAsync(
    context.containerName,
    `cd ${shellQuote(context.cwd)} && find . -path './.git' -prune -o -name '*.flow-meta.xml' -type f -print 2>/dev/null | head -${MAX_FLOW_FILES}`,
    { timeout: 10000, maxBuffer: 512 * 1024 },
  );
  return output ? output.split('\n').map((line) => line.trim()).filter(Boolean) : [];
}

async function readFlowFile(context, relativePath) {
  return containerManager.execInContainerAsync(
    context.containerName,
    `cd ${shellQuote(context.cwd)} && test -f ${shellQuote(relativePath)} && head -c ${MAX_FLOW_BYTES} ${shellQuote(relativePath)}`,
    { timeout: 8000, maxBuffer: MAX_FLOW_BYTES + 1024 },
  );
}

export async function indexFlows(context, { refresh = false } = {}) {
  const key = cacheKey(context);
  const cached = flowCache.get(key);
  if (!refresh && cached && cached.expiresAt > Date.now()) return { ...cached.value, cached: true };

  const files = await listFlowFiles(context);
  const entries = [];
  const parseWarnings = [];

  for (const filePath of files) {
    try {
      const xml = await readFlowFile(context, filePath);
      if (!xml) continue;
      const parsed = parseFlowMetadata(xml, filePath);
      const tokens = [parsed.flowName, parsed.label, ...parsed.references.objects, ...parsed.references.fields];
      entries.push({
        ...parsed,
        filePath: filePath.replace(/^\.\//, ''),
        fileHash: crypto.createHash('sha1').update(xml).digest('hex'),
        excerpts: excerpt(xml, tokens),
        parseWarnings: [],
      });
    } catch (error) {
      parseWarnings.push(`${filePath}: ${error.message}`);
    }
  }

  const value = { flows: entries, parseWarnings, indexedAt: new Date().toISOString(), cached: false };
  flowCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function searchFlows(context, filters = {}) {
  const index = await indexFlows(context, { refresh: filters.refresh });
  return {
    ...index,
    results: index.flows.filter((entry) => flowMatches(entry, filters)).slice(0, 100),
  };
}
