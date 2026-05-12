import crypto from 'crypto';
import { SalesforceApiError } from './salesforceErrors.js';

const MAX_METADATA_FILES = 2000;
const MAX_METADATA_BYTES = 384 * 1024;
const CACHE_TTL_MS = 5 * 60 * 1000;
const dependencyCache = new Map();

const FILE_TYPE_RULES = [
  [/\.flow-meta\.xml$/i, 'flow'],
  [/\.cls$/i, 'apexClass'],
  [/\.trigger$/i, 'apexTrigger'],
  [/\.validationRule-meta\.xml$/i, 'validationRule'],
  [/\.layout-meta\.xml$/i, 'layout'],
  [/\.profile-meta\.xml$/i, 'profile'],
  [/\.permissionset-meta\.xml$/i, 'permissionSet'],
  [/\.flexipage-meta\.xml$/i, 'flexipage'],
  [/\.report-meta\.xml$/i, 'report'],
  [/\.email-meta\.xml$/i, 'emailTemplate'],
  [/\.field-meta\.xml$/i, 'fieldDefinition'],
  [/\.object-meta\.xml$/i, 'objectDefinition'],
  [/\.js$/i, 'javascript'],
  [/\.html$/i, 'markup'],
  [/\.cmp$/i, 'aura'],
];

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function normalizeName(value) {
  return String(value || '').trim();
}

function normalizeComparable(value) {
  return normalizeName(value).toLowerCase();
}

function cacheKey(context, target) {
  return JSON.stringify({ projectId: context.projectId, cwd: context.cwd, branch: context.branch, target });
}

function classifyFile(filePath) {
  const rule = FILE_TYPE_RULES.find(([pattern]) => pattern.test(filePath));
  return rule?.[1] || 'metadata';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function targetTokens({ objectName, fieldName }) {
  const object = normalizeName(objectName);
  const field = normalizeName(fieldName);
  const objectField = `${object}.${field}`;
  return unique([
    object,
    field,
    objectField,
    `${object}.${field.replace(/__c$/i, '__r')}`,
    `${object.replace(/__c$/i, '__r')}.${field}`,
  ]);
}

function lineMatches(line, tokens, { objectName, fieldName }) {
  const lowered = line.toLowerCase();
  const object = normalizeComparable(objectName);
  const field = normalizeComparable(fieldName);
  const relationshipField = normalizeComparable(fieldName).replace(/__c$/i, '__r');
  const hasFieldReference = lowered.includes(field) || lowered.includes(relationshipField) || lowered.includes(`${object}.${field}`);
  const matchedTokens = hasFieldReference ? tokens.filter((token) => lowered.includes(token.toLowerCase())) : [];

  const strongMatch = lowered.includes(`${object}.${field}`)
    || /<field>[^<]*<\/field>/i.test(line) && lowered.includes(field)
    || /<fullName>[^<]*<\/fullName>/i.test(line) && lowered.includes(field)
    || /<members>[^<]*<\/members>/i.test(line) && lowered.includes(field)
    || /\bfield\b/i.test(line) && lowered.includes(field);

  return { matchedTokens, strongMatch };
}

function referenceRisk(type, strongMatch) {
  if (type === 'fieldDefinition' || type === 'objectDefinition') return 'blocking';
  if (['apexClass', 'apexTrigger', 'flow', 'validationRule'].includes(type)) return 'high';
  if (['layout', 'profile', 'permissionSet', 'flexipage'].includes(type)) return 'medium';
  return strongMatch ? 'medium' : 'low';
}

function overallRisk(references) {
  if (references.some((entry) => entry.risk === 'blocking')) return 'blocking';
  if (references.some((entry) => entry.risk === 'high')) return 'high';
  if (references.some((entry) => entry.risk === 'medium')) return 'medium';
  return references.length ? 'low' : 'low';
}

function suggestedRemovalOrder(references, target) {
  if (!references.length) {
    return [
      `Confirm ${target.objectName}.${target.fieldName} exists in the target org and no references were missed outside local metadata.`,
      'Remove the field metadata in a separate reviewed change only after org-level checks pass.',
    ];
  }

  const order = [
    ['profile', 'permissionSet', 'layout', 'flexipage'],
    ['report', 'emailTemplate', 'metadata'],
    ['flow', 'validationRule'],
    ['apexClass', 'apexTrigger', 'javascript', 'markup', 'aura'],
    ['fieldDefinition'],
  ];

  return order
    .map((types) => references.filter((entry) => types.includes(entry.type)))
    .filter((group) => group.length)
    .map((group) => `Review and remove ${unique(group.map((entry) => entry.type)).join('/')} references: ${group.map((entry) => entry.filePath).slice(0, 8).join(', ')}${group.length > 8 ? '...' : ''}`);
}

function verificationSteps(target) {
  return [
    `Re-run dependency analysis for ${target.objectName}.${target.fieldName} and confirm zero blocking/high references remain.`,
    'Run Salesforce project tests and static checks that cover Apex, Flow, and UI metadata touched by the removal.',
    'Validate source deploy/check-only in the intended org before any destructive delete package is prepared.',
    'After manual approval, delete the field metadata and deploy destructively only through the normal release process.',
  ];
}

function summarizeReference(filePath, content, target) {
  const tokens = targetTokens(target);
  const lines = String(content || '').split('\n');
  const matches = [];
  let strong = false;

  lines.forEach((line, index) => {
    const result = lineMatches(line, tokens, target);
    if (!result.matchedTokens.length) return;
    strong = strong || result.strongMatch;
    matches.push({
      line: index + 1,
      text: line.trim().slice(0, 300),
      matchedTokens: result.matchedTokens,
    });
  });

  if (!matches.length) return null;

  const type = classifyFile(filePath);
  return {
    filePath: filePath.replace(/^\.\//, ''),
    type,
    risk: referenceRisk(type, strong),
    matchCount: matches.length,
    matches: matches.slice(0, 12),
    fileHash: crypto.createHash('sha1').update(String(content || '')).digest('hex'),
  };
}

export function analyzeMetadataReferences(files, target) {
  const objectName = normalizeName(target?.objectName);
  const fieldName = normalizeName(target?.fieldName);
  if (!objectName) throw new SalesforceApiError('OBJECT_NAME_REQUIRED', 'objectName is required');
  if (!fieldName) throw new SalesforceApiError('FIELD_NAME_REQUIRED', 'fieldName is required');

  const normalizedTarget = { objectName, fieldName };
  const references = files
    .map((file) => summarizeReference(file.filePath, file.content, normalizedTarget))
    .filter(Boolean)
    .sort((a, b) => {
      const riskOrder = { blocking: 0, high: 1, medium: 2, low: 3 };
      return riskOrder[a.risk] - riskOrder[b.risk] || a.filePath.localeCompare(b.filePath);
    });

  return {
    target: normalizedTarget,
    referenceCount: references.length,
    references,
    risk: overallRisk(references),
    suggestedRemovalOrder: suggestedRemovalOrder(references, normalizedTarget),
    verificationSteps: verificationSteps(normalizedTarget),
  };
}

export function buildDependencyPlanPrompt(analysis) {
  return `Salesforce dependency analysis target:\n${analysis.target.objectName}.${analysis.target.fieldName}\n\nDeterministic local metadata evidence:\n${JSON.stringify({ risk: analysis.risk, referenceCount: analysis.referenceCount, references: analysis.references }, null, 2)}\n\nGenerate a concise, viable deletion plan grounded only in this evidence. Include references, risk, suggested order of removal, and verification steps. Keep it read-only and do not instruct the app to delete metadata, deploy changes, mutate an org, or store credentials. If evidence is incomplete, say exactly what needs manual verification.`;
}

function buildLocalPlan(analysis) {
  const referenceLines = analysis.references.slice(0, 20).map((entry) => `- [${entry.risk}] ${entry.type}: ${entry.filePath} (${entry.matchCount} match${entry.matchCount === 1 ? '' : 'es'})`);
  return [
    `Risk: ${analysis.risk}. Found ${analysis.referenceCount} local metadata reference${analysis.referenceCount === 1 ? '' : 's'} for ${analysis.target.objectName}.${analysis.target.fieldName}.`,
    referenceLines.length ? `References:\n${referenceLines.join('\n')}` : 'References:\n- No local metadata references were found in the indexed files.',
    `Suggested order:\n${analysis.suggestedRemovalOrder.map((step, index) => `${index + 1}. ${step}`).join('\n')}`,
    `Verification:\n${analysis.verificationSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`,
  ].join('\n\n');
}

async function listMetadataFiles(context) {
  const { containerManager } = await import('../containerManager.js');
  const output = await containerManager.execInContainerAsync(
    context.containerName,
    `cd ${shellQuote(context.cwd)} && find . -path './.git' -prune -o -type f \\( -name '*.xml' -o -name '*.cls' -o -name '*.trigger' -o -name '*.js' -o -name '*.html' -o -name '*.cmp' \\) -print 2>/dev/null | head -${MAX_METADATA_FILES}`,
    { timeout: 10000, maxBuffer: 1024 * 1024 },
  );
  return output ? output.split('\n').map((line) => line.trim()).filter(Boolean) : [];
}

async function readMetadataFile(context, relativePath) {
  const { containerManager } = await import('../containerManager.js');
  return containerManager.execInContainerAsync(
    context.containerName,
    `cd ${shellQuote(context.cwd)} && test -f ${shellQuote(relativePath)} && head -c ${MAX_METADATA_BYTES} ${shellQuote(relativePath)}`,
    { timeout: 8000, maxBuffer: MAX_METADATA_BYTES + 1024 },
  );
}

async function indexMetadataFiles(context, { refresh = false } = {}) {
  const key = cacheKey(context, 'metadata-files');
  const cached = dependencyCache.get(key);
  if (!refresh && cached && cached.expiresAt > Date.now()) return { ...cached.value, cached: true };

  const paths = await listMetadataFiles(context);
  const files = [];
  const parseWarnings = [];

  for (const filePath of paths) {
    try {
      const content = await readMetadataFile(context, filePath);
      if (content) files.push({ filePath, content });
    } catch (error) {
      parseWarnings.push(`${filePath}: ${error.message}`);
    }
  }

  const value = { files, parseWarnings, indexedAt: new Date().toISOString(), cached: false };
  dependencyCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function analyzeSalesforceDependency(context, { objectName, fieldName, refresh = false } = {}, { llm = null, indexer = indexMetadataFiles } = {}) {
  const index = await indexer(context, { refresh });
  const analysis = analyzeMetadataReferences(index.files, { objectName, fieldName });
  const prompt = buildDependencyPlanPrompt(analysis);

  try {
    const provider = llm || (await import('../llmProvider.js')).default;
    const result = await provider.generateResponse(prompt, {
      systemPrompt: 'You generate read-only Salesforce metadata dependency deletion plans from deterministic local evidence. Stay grounded in the supplied JSON and never instruct the app to mutate an org, deploy, delete metadata, or store credentials.',
      maxTokens: 1000,
      temperature: 0.1,
    });

    return {
      ...analysis,
      plan: result.response,
      llmUsed: true,
      provider: result.provider,
      model: result.model,
      parseWarnings: index.parseWarnings,
      indexedAt: index.indexedAt,
      cached: index.cached,
    };
  } catch (error) {
    return {
      ...analysis,
      plan: buildLocalPlan(analysis),
      llmUsed: false,
      fallbackReason: error.message,
      parseWarnings: index.parseWarnings,
      indexedAt: index.indexedAt,
      cached: index.cached,
    };
  }
}
