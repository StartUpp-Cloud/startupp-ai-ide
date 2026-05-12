import crypto from 'crypto';
import { SalesforceApiError } from './salesforceErrors.js';
import { parseFlowMetadata, flowMatches } from './salesforceFlowParser.js';

const MAX_FLOW_FILES = 500;
const MAX_FLOW_BYTES = 256 * 1024;
const MAX_FLOW_AI_CANDIDATES = 20;
const CACHE_TTL_MS = 5 * 60 * 1000;
const flowCache = new Map();

const QUESTION_STOPWORDS = new Set([
  'a', 'about', 'all', 'an', 'and', 'any', 'are', 'ask', 'by', 'can', 'do', 'does', 'explain', 'find', 'flow', 'flows', 'for', 'from', 'i', 'in', 'is', 'it', 'me', 'metadata', 'of', 'on', 'or', 'related', 'salesforce', 'show', 'that', 'the', 'things', 'to', 'use', 'uses', 'what', 'where', 'which', 'with',
]);

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

function searchableText(entry) {
  return [
    entry.flowName,
    entry.label,
    entry.status,
    entry.processType,
    entry.filePath,
    ...(entry.references?.objects || []),
    ...(entry.references?.fields || []),
    ...(entry.references?.apexActions || []),
    ...(entry.references?.subflows || []),
    ...(entry.excerpts || []),
  ].filter(Boolean).join(' ');
}

export function tokenizeFlowQuestion(question) {
  return [...new Set(String(question || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9_]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 2 && !QUESTION_STOPWORDS.has(token)))];
}

export function rankFlowsForQuestion(flows, question) {
  const tokens = tokenizeFlowQuestion(question);
  if (!tokens.length) return flows.slice(0, MAX_FLOW_AI_CANDIDATES).map((entry) => ({ ...entry, matchScore: 0 }));

  return flows
    .map((entry) => {
      const haystack = searchableText(entry).toLowerCase();
      const objectRefs = (entry.references?.objects || []).map((value) => value.toLowerCase());
      const fieldRefs = (entry.references?.fields || []).map((value) => value.toLowerCase());
      const actionRefs = (entry.references?.apexActions || []).map((value) => value.toLowerCase());
      let score = 0;

      for (const token of tokens) {
        if (haystack.includes(token)) score += 1;
        if (objectRefs.some((value) => value.includes(token))) score += 3;
        if (fieldRefs.some((value) => value.includes(token))) score += 3;
        if (actionRefs.some((value) => value.includes(token))) score += 2;
      }

      return { ...entry, matchScore: score };
    })
    .filter((entry) => entry.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore || String(a.flowName).localeCompare(String(b.flowName)))
    .slice(0, MAX_FLOW_AI_CANDIDATES);
}

function serializeFlowForPrompt(entry) {
  return {
    flowName: entry.flowName,
    label: entry.label,
    status: entry.status,
    processType: entry.processType,
    filePath: entry.filePath,
    matchScore: entry.matchScore,
    references: entry.references,
    excerpts: entry.excerpts,
  };
}

export function buildFlowQuestionPrompt(question, candidates, { indexedAt, parseWarnings = [] } = {}) {
  const summarizedCandidates = candidates.map(serializeFlowForPrompt);
  return `User question:\n${question}\n\nLocal Salesforce flow metadata index timestamp: ${indexedAt || 'unknown'}\nParse warnings: ${parseWarnings.length ? parseWarnings.slice(0, 10).join('; ') : 'none'}\n\nCandidate flows and flow-related references from deterministic local parsing:\n${JSON.stringify(summarizedCandidates, null, 2)}\n\nAnswer the user's question using only this local metadata. If the candidates do not prove an answer, say what was searched and what is missing. Include relevant flow names and file paths. Do not suggest Salesforce org mutations, credential storage, deployments, or destructive changes.`;
}

function buildLocalFlowAnswer(question, candidates, index) {
  if (!candidates.length) {
    return `No matching Salesforce flows were found in the local metadata index for: "${question}". Indexed ${index.flows.length} flow(s). Try asking with a flow label, API name, object, field, Apex action, or subflow name.`;
  }

  const lines = candidates.slice(0, 8).map((entry) => {
    const refs = [];
    if (entry.references?.objects?.length) refs.push(`objects: ${entry.references.objects.join(', ')}`);
    if (entry.references?.fields?.length) refs.push(`fields: ${entry.references.fields.join(', ')}`);
    if (entry.references?.apexActions?.length) refs.push(`Apex: ${entry.references.apexActions.join(', ')}`);
    if (entry.references?.subflows?.length) refs.push(`subflows: ${entry.references.subflows.join(', ')}`);
    return `- ${entry.flowName}${entry.label ? ` (${entry.label})` : ''} at ${entry.filePath}${refs.length ? `; ${refs.join('; ')}` : ''}`;
  });

  return `Found ${candidates.length} likely Salesforce flow match(es) for: "${question}".\n${lines.join('\n')}`;
}

async function listFlowFiles(context) {
  const { containerManager } = await import('../containerManager.js');
  const output = await containerManager.execInContainerAsync(
    context.containerName,
    `cd ${shellQuote(context.cwd)} && find . -path './.git' -prune -o -name '*.flow-meta.xml' -type f -print 2>/dev/null | head -${MAX_FLOW_FILES}`,
    { timeout: 10000, maxBuffer: 512 * 1024 },
  );
  return output ? output.split('\n').map((line) => line.trim()).filter(Boolean) : [];
}

async function readFlowFile(context, relativePath) {
  const { containerManager } = await import('../containerManager.js');
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

export async function answerFlowQuestion(context, { question, refresh = false } = {}, { llm = null, indexer = indexFlows } = {}) {
  const normalizedQuestion = String(question || '').trim();
  if (!normalizedQuestion) {
    throw new SalesforceApiError('FLOW_QUESTION_REQUIRED', 'question is required');
  }

  const index = await indexer(context, { refresh });
  const candidates = rankFlowsForQuestion(index.flows, normalizedQuestion);
  const prompt = buildFlowQuestionPrompt(normalizedQuestion, candidates, index);

  try {
    const provider = llm || (await import('../llmProvider.js')).default;
    const result = await provider.generateResponse(prompt, {
      systemPrompt: 'You answer read-only questions about Salesforce Flow metadata from deterministic local parsing. Stay grounded in the supplied JSON. Do not invent metadata and do not propose mutations unless explicitly framed as a future manual review step.',
      maxTokens: 900,
      temperature: 0.1,
    });

    return {
      answer: result.response,
      llmUsed: true,
      provider: result.provider,
      model: result.model,
      candidates,
      indexedAt: index.indexedAt,
      parseWarnings: index.parseWarnings,
      cached: index.cached,
    };
  } catch (error) {
    return {
      answer: buildLocalFlowAnswer(normalizedQuestion, candidates, index),
      llmUsed: false,
      fallbackReason: error.message,
      candidates,
      indexedAt: index.indexedAt,
      parseWarnings: index.parseWarnings,
      cached: index.cached,
    };
  }
}
