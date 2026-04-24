import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import Project from './models/Project.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data/ollama-orchestrator');
const JOBS_DIR = path.join(DATA_DIR, 'jobs');
const RESEARCH_DIR = path.join(DATA_DIR, 'research-cache');

const MAX_FILES = 5000;
const MAX_FILE_BYTES = 250000;
const MAX_SNIPPET_CHARS = 6000;
const CONTEXT_FILE_LIMIT = 24;
const RESEARCH_TIMEOUT_MS = 8000;
const MAX_RESEARCH_SOURCES = 6;

const IGNORE_NAMES = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', '.cache',
  '__pycache__', '.pytest_cache', 'venv', '.venv', 'env', '.DS_Store', '.idea',
]);

const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.md', '.txt', '.css', '.scss',
  '.html', '.yml', '.yaml', '.toml', '.py', '.go', '.rs', '.java', '.kt', '.php', '.rb',
  '.sh', '.sql', '.dockerfile', '.env.example', '.gitignore', '.editorconfig', '.xml', '.csv',
]);

const STACK_GUIDANCE = {
  javascript: [
    'Validate input at API boundaries and keep validation close to route handlers or service entry points.',
    'Run dependency checks with npm audit/pnpm audit and pair them with code-level review for auth, injection, and unsafe deserialization.',
    'Prefer structured logging with request IDs for audit trails; avoid logging secrets or full tokens.',
  ],
  typescript: [
    'Prefer typed request/response boundaries, strict null checks, and explicit domain types for security-sensitive data.',
    'Treat type assertions around external data as risk points unless paired with runtime validation.',
    'Run typecheck, lint, tests, and dependency audits before accepting automated edits.',
  ],
  react: [
    'Check client-side auth assumptions against server authorization; UI hiding is not authorization.',
    'Review dangerous HTML usage, external links, token storage, and user-controlled rendering paths.',
    'Prefer accessible, deterministic UI states for security and audit workflows.',
  ],
  express: [
    'Verify every state-changing route has authentication, authorization, input validation, error handling, and audit logging.',
    'Use secure middleware defaults: helmet, CORS restrictions, rate limits, body limits, and safe file upload handling.',
    'Map routes to data writes so SOC2 audit logging can prove who did what, when, and from where.',
  ],
  docker: [
    'Use least-privilege containers, pinned base images where practical, no secrets in images, and explicit network/volume boundaries.',
    'Scan images and Dockerfiles with deterministic tools such as Trivy or Docker Scout when available.',
  ],
  soc2: [
    'Look for evidence, not claims: access control, change management, audit logs, incident response hooks, encryption, backup/restore, and monitoring.',
    'Flag missing audit logging for authentication, authorization changes, data exports, admin actions, destructive operations, and security setting changes.',
    'Each recommendation should cite files and explain the control objective it supports.',
  ],
};

const RESEARCH_SOURCES = {
  soc2: [
    { title: 'AICPA SOC 2 overview', url: 'https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services' },
    { title: 'OWASP Logging Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html' },
    { title: 'OWASP Authorization Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html' },
  ],
  security: [
    { title: 'OWASP Top 10', url: 'https://owasp.org/www-project-top-ten/' },
    { title: 'OWASP Node.js Security Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html' },
    { title: 'GitHub Advisory Database', url: 'https://github.com/advisories' },
  ],
  express: [
    { title: 'Express production security best practices', url: 'https://expressjs.com/en/advanced/best-practice-security.html' },
  ],
  react: [
    { title: 'React security guidance', url: 'https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html' },
  ],
  docker: [
    { title: 'Docker build best practices', url: 'https://docs.docker.com/build/building/best-practices/' },
  ],
};

const PHASES = [
  'understand',
  'workspace-index',
  'stack-research',
  'retrieval',
  'task-planning',
  'evidence-ledger',
  'critique-gates',
  'verification-plan',
  'synthesis',
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function safeRelative(root, filePath) {
  const rel = path.relative(root, filePath).replace(/\\/g, '/');
  return rel || '.';
}

function isTextFile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  const ext = path.extname(name);
  return TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(name) || name === 'dockerfile';
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function inferPurpose(file) {
  const p = file.path.toLowerCase();
  const name = path.basename(p);
  const ext = path.extname(p);

  if (name === 'package.json') return 'Node package manifest with scripts, dependencies, and project metadata.';
  if (name.includes('dockerfile')) return 'Docker image definition for runtime or development environment.';
  if (name.includes('compose')) return 'Docker Compose service and dependency configuration.';
  if (name.includes('readme')) return 'Human-facing project documentation.';
  if (name.includes('claude')) return 'AI assistant/project convention instructions.';
  if (name.includes('eslint')) return 'JavaScript/TypeScript linting configuration.';
  if (name === 'tsconfig.json') return 'TypeScript compiler configuration.';
  if (p.includes('/routes/') || /route[s]?\./.test(name)) return 'HTTP/API route definitions or route helpers.';
  if (p.includes('/models/')) return 'Data model or persistence abstraction.';
  if (p.includes('/components/')) return 'Reusable frontend UI component.';
  if (p.includes('/pages/')) return 'Frontend route/page-level view.';
  if (p.includes('/hooks/')) return 'Frontend state/effect hook.';
  if (p.includes('/tests/') || /\.(test|spec)\./.test(name)) return 'Automated test or smoke test.';
  if (p.includes('/migrations/')) return 'Database migration or schema transition.';
  if (ext === '.md') return 'Markdown documentation or instructions.';
  if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) return 'Application source code.';
  if (['.yml', '.yaml'].includes(ext)) return 'Configuration, CI/CD, or infrastructure metadata.';
  return 'Project file; purpose inferred from path and nearby context.';
}

function classifyRisk(file) {
  const p = file.path.toLowerCase();
  const text = `${file.snippet || ''}`.toLowerCase();
  const tags = [];
  if (/auth|login|token|session|password|permission|role|rbac|jwt/.test(p + text)) tags.push('auth');
  if (/audit|log|logger|event|activity/.test(p + text)) tags.push('audit-logging');
  if (/route|api|express|fastify|controller|endpoint/.test(p + text)) tags.push('api');
  if (/docker|compose|kubernetes|helm|terraform|ci|workflow/.test(p)) tags.push('infra');
  if (/secret|apikey|api_key|private_key|credential/.test(text)) tags.push('secret-risk');
  if (/sql|query|exec\(|spawn\(|execsync|eval\(|innerhtml|dangerouslysetinnerhtml/.test(text)) tags.push('injection-risk');
  return [...new Set(tags)];
}

function detectLanguageFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
    '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java', '.php': 'php', '.rb': 'ruby',
  };
  return map[ext] || null;
}

function summarizeDirectory(pathName, files) {
  const childFiles = files.filter((file) => file.path === pathName || file.path.startsWith(`${pathName}/`));
  const tags = [...new Set(childFiles.flatMap((file) => file.riskTags || []))];
  const types = [...new Set(childFiles.map((file) => file.language || file.extension || 'unknown'))].slice(0, 8);
  return {
    path: pathName,
    purpose: childFiles.length
      ? `Contains ${childFiles.length} indexed file(s), mainly ${types.join(', ')} assets.`
      : 'Directory discovered during workspace scan.',
    riskTags: tags,
    fileCount: childFiles.length,
  };
}

function detectTaskKind(prompt) {
  const p = prompt.toLowerCase();
  if (/soc\s*2|soc2|audit|compliance|logging|controls?/.test(p)) return 'audit';
  if (/vulnerab|security|owasp|cve|secret|exploit/.test(p)) return 'security';
  if (/bug|why|error|failing|broken|crash|issue/.test(p)) return 'debug';
  if (/implement|change|fix|add|remove|refactor|update|modify|write|create/.test(p)) return 'implementation';
  return 'analysis';
}

function wantsFileChanges(prompt) {
  return /\b(implement|change|fix|add|remove|refactor|update|modify|write|create|patch)\b/i.test(prompt);
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .filter((token) => token.length > 2);
}

function scoreFile(file, queryTokens, taskKind) {
  const haystack = `${file.path} ${file.purpose} ${(file.riskTags || []).join(' ')} ${file.snippet || ''}`.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) score += token.length > 5 ? 3 : 1;
  }
  if (taskKind === 'audit' && file.riskTags?.includes('audit-logging')) score += 8;
  if (taskKind === 'security' && file.riskTags?.some((tag) => tag.includes('risk') || tag === 'auth' || tag === 'api')) score += 8;
  if (taskKind === 'debug' && /test|route|component|page|service|manager|error/.test(file.path.toLowerCase())) score += 3;
  if (taskKind === 'implementation' && ['.js', '.jsx', '.ts', '.tsx'].includes(file.extension)) score += 2;
  return score;
}

class OllamaWorkspaceOrchestrator {
  constructor() {
    ensureDir(DATA_DIR);
    ensureDir(JOBS_DIR);
    ensureDir(RESEARCH_DIR);
  }

  isOllamaAssistant(tool) {
    return tool === 'ollama';
  }

  async prepareTaskContext({ projectId, sessionId = null, prompt, model = null, forceRefresh = false }) {
    const project = Project.findById(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const taskKind = detectTaskKind(prompt);
    const editRequested = wantsFileChanges(prompt);
    const job = this.createJob({ projectId, sessionId, prompt, model, taskKind, editRequested });

    this.markPhase(job, 'understand', 'completed', {
      taskKind,
      editRequested,
      expectedDeliverable: this.getExpectedDeliverable(taskKind, editRequested),
      riskLevel: this.getRiskLevel(taskKind, editRequested),
    });

    const index = await this.getOrBuildIndex(project, { forceRefresh });
    this.markPhase(job, 'workspace-index', 'completed', {
      indexId: index.id,
      stats: index.stats,
      stack: index.stack,
      source: index.source,
    });

    const research = await this.buildResearchContext({ taskKind, stack: index.stack });
    this.markPhase(job, 'stack-research', 'completed', {
      sources: research.sources.map((source) => ({ title: source.title, url: source.url, cached: source.cached, ok: source.ok })),
    });

    const relevantFiles = this.searchIndex(index, prompt, { taskKind, limit: CONTEXT_FILE_LIMIT });
    this.markPhase(job, 'retrieval', 'completed', {
      relevantPaths: relevantFiles.map((file) => file.path),
    });

    const plan = this.planTask({ prompt, taskKind, index, relevantFiles, model });
    this.markPhase(job, 'task-planning', 'completed', { plan });

    const evidenceLedger = this.buildEvidenceLedger({ prompt, taskKind, relevantFiles, index });
    this.writeArtifact(job, 'evidence-ledger', evidenceLedger);
    this.markPhase(job, 'evidence-ledger', 'completed', {
      claims: evidenceLedger.claims.length,
      evidenceItems: evidenceLedger.claims.reduce((sum, claim) => sum + claim.evidence.length, 0),
    });

    const critiqueGates = this.buildCritiqueGates({ taskKind, editRequested });
    this.writeArtifact(job, 'critique-gates', critiqueGates);
    this.markPhase(job, 'critique-gates', 'completed', { gates: critiqueGates.gates.length });

    const verificationPlan = this.buildVerificationPlan({ taskKind, editRequested, stack: index.stack, relevantFiles });
    this.writeArtifact(job, 'verification-plan', verificationPlan);
    this.markPhase(job, 'verification-plan', 'completed', { commands: verificationPlan.commands.length });

    const finalJob = this.completeJob(job.id, {
      indexId: index.id,
      relevantPaths: relevantFiles.map((file) => file.path),
      artifacts: ['evidence-ledger', 'critique-gates', 'verification-plan'],
    });

    return {
      job: finalJob,
      index,
      taskKind,
      research,
      relevantFiles,
      plan,
      evidenceLedger,
      critiqueGates,
      verificationPlan,
      augmentedPrompt: this.buildAugmentedPrompt({
        prompt,
        index,
        research,
        relevantFiles,
        plan,
        taskKind,
        job: finalJob,
        evidenceLedger,
        critiqueGates,
        verificationPlan,
      }),
    };
  }

  async getOrBuildIndex(project, options = {}) {
    const existing = this.readIndex(project.id);
    if (!options.forceRefresh && existing && !this.isStale(existing, project)) {
      return existing;
    }
    return this.buildIndex(project);
  }

  createJob({ projectId, sessionId, prompt, model, taskKind, editRequested }) {
    const now = new Date().toISOString();
    const job = {
      id: uuidv4(),
      projectId,
      sessionId,
      prompt: prompt.slice(0, 20000),
      model: model || null,
      taskKind,
      editRequested,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      phases: PHASES.map((name) => ({ name, status: 'pending', startedAt: null, completedAt: null, summary: null, metadata: {} })),
      artifacts: {},
      quality: {
        requiresEvidenceForClaims: true,
        requiresCritiquePasses: true,
        requiresVerificationPlan: true,
        internetResearchEnabled: true,
      },
    };
    this.saveJob(job);
    return job;
  }

  markPhase(job, name, status, metadata = {}) {
    const phase = job.phases.find((item) => item.name === name);
    if (!phase) return job;
    const now = new Date().toISOString();
    if (!phase.startedAt) phase.startedAt = now;
    phase.status = status;
    phase.metadata = { ...phase.metadata, ...metadata };
    if (status === 'completed' || status === 'failed') phase.completedAt = now;
    job.updatedAt = now;
    this.saveJob(job);
    return job;
  }

  completeJob(jobId, metadata = {}) {
    const job = this.getJob(jobId);
    if (!job) return null;
    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.updatedAt = job.completedAt;
    job.metadata = { ...(job.metadata || {}), ...metadata };
    this.saveJob(job);
    return job;
  }

  writeArtifact(job, name, content) {
    const artifactPath = this.artifactPath(job.id, name);
    fs.writeFileSync(artifactPath, JSON.stringify(content, null, 2), { mode: 0o600 });
    job.artifacts[name] = {
      name,
      path: artifactPath,
      updatedAt: new Date().toISOString(),
      type: 'json',
    };
    job.updatedAt = new Date().toISOString();
    this.saveJob(job);
  }

  getExpectedDeliverable(taskKind, editRequested) {
    if (editRequested) return 'Minimal patch-ready implementation with verification commands and risk notes.';
    if (taskKind === 'audit') return 'Evidence-backed audit report with severity, control relevance, and remediation recommendations.';
    if (taskKind === 'security') return 'Evidence-backed vulnerability review with confirmed findings, likely risks, and tool-backed verification plan.';
    if (taskKind === 'debug') return 'Root-cause hypotheses ranked by evidence, reproduction/verification steps, and minimal fix options.';
    return 'Evidence-backed technical answer grounded in workspace context and current stack guidance.';
  }

  getRiskLevel(taskKind, editRequested) {
    if (editRequested) return 'high';
    if (taskKind === 'security' || taskKind === 'audit') return 'medium';
    return 'low';
  }

  async buildResearchContext({ taskKind, stack }) {
    const keys = new Set();
    if (taskKind === 'audit') keys.add('soc2');
    if (taskKind === 'security') keys.add('security');
    for (const framework of stack.frameworks || []) keys.add(framework);
    for (const language of stack.languages || []) {
      if (language === 'javascript' || language === 'typescript') keys.add('security');
    }

    const candidates = [...keys]
      .flatMap((key) => RESEARCH_SOURCES[key] || [])
      .filter((source, index, all) => all.findIndex((item) => item.url === source.url) === index)
      .slice(0, MAX_RESEARCH_SOURCES);

    const sources = [];
    for (const source of candidates) {
      sources.push(await this.fetchResearchSource(source));
    }

    return {
      generatedAt: new Date().toISOString(),
      sources,
      summary: sources
        .filter((source) => source.ok || source.cached)
        .map((source) => `- ${source.title}: ${source.summary}`)
        .join('\n'),
    };
  }

  async fetchResearchSource(source) {
    const cachePath = this.researchPath(source.url);
    const cached = readJsonSafe(cachePath);
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
    if (cached && Date.now() - new Date(cached.retrievedAt).getTime() < maxAgeMs) {
      return { ...cached, cached: true };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RESEARCH_TIMEOUT_MS);
    try {
      const response = await fetch(source.url, { signal: controller.signal, headers: { 'User-Agent': 'StartUpp-AI-IDE-Orchestrator/1.0' } });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const stripped = stripHtml(text).slice(0, 12000);
      const entry = {
        title: source.title,
        url: source.url,
        ok: true,
        cached: false,
        retrievedAt: new Date().toISOString(),
        summary: summarizeResearchText(stripped),
        excerpt: stripped.slice(0, 3000),
      };
      fs.writeFileSync(cachePath, JSON.stringify(entry, null, 2), { mode: 0o600 });
      return entry;
    } catch (error) {
      clearTimeout(timeout);
      return {
        title: source.title,
        url: source.url,
        ok: false,
        cached: false,
        retrievedAt: new Date().toISOString(),
        summary: `Research source unavailable during this run: ${error.message}`,
        excerpt: '',
        error: error.message,
      };
    }
  }

  isStale(index, project) {
    const source = this.resolveSource(project);
    if (index.source?.type !== source.type || index.source?.root !== source.root) return true;
    if (source.type === 'host') {
      try {
        const stat = fs.statSync(source.root);
        return new Date(index.scannedAt).getTime() < stat.mtimeMs;
      } catch {
        return true;
      }
    }
    return false;
  }

  resolveSource(project) {
    if (project.folderPath && fs.existsSync(project.folderPath)) {
      return { type: 'host', root: project.folderPath };
    }
    if (project.containerName) {
      return { type: 'container', root: '/workspace', containerName: project.containerName };
    }
    return { type: 'host', root: process.cwd() };
  }

  buildIndex(project) {
    const source = this.resolveSource(project);
    const rawFiles = source.type === 'container'
      ? this.scanContainer(source)
      : this.scanHost(source.root);

    const files = rawFiles.map((file) => {
      const enriched = {
        ...file,
        language: detectLanguageFromPath(file.path),
        purpose: inferPurpose(file),
      };
      enriched.riskTags = classifyRisk(enriched);
      return enriched;
    });

    const directories = this.buildDirectorySummaries(files);
    const stack = this.detectStack(files);
    const guidance = this.buildGuidance(stack);

    const index = {
      id: uuidv4(),
      projectId: project.id,
      projectName: project.name,
      source: { type: source.type, root: source.root, containerName: source.containerName || null },
      scannedAt: new Date().toISOString(),
      stats: {
        totalFiles: files.length,
        summarizedFiles: files.filter((file) => file.snippet).length,
        directories: directories.length,
      },
      stack,
      guidance,
      files,
      directories,
    };

    this.writeIndex(project.id, index);
    return index;
  }

  scanHost(root) {
    const results = [];

    const walk = (current) => {
      if (results.length >= MAX_FILES) return;
      let entries = [];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (results.length >= MAX_FILES) break;
        if (IGNORE_NAMES.has(entry.name) || entry.name.endsWith('.log')) continue;
        const fullPath = path.join(current, entry.name);
        const relPath = safeRelative(root, fullPath);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        let stat;
        try { stat = fs.statSync(fullPath); } catch { continue; }
        const text = isTextFile(fullPath) && stat.size <= MAX_FILE_BYTES;
        results.push({
          path: relPath,
          extension: path.extname(entry.name).toLowerCase(),
          size: stat.size,
          snippet: text ? fs.readFileSync(fullPath, 'utf-8').slice(0, MAX_SNIPPET_CHARS) : '',
        });
      }
    };

    walk(root);
    return results;
  }

  scanContainer(source) {
    const script = `
const fs = require('fs');
const path = require('path');
const root = '/workspace';
const ignore = new Set(${JSON.stringify([...IGNORE_NAMES])});
const textExt = new Set(${JSON.stringify([...TEXT_EXTENSIONS])});
const maxFiles = ${MAX_FILES};
const maxBytes = ${MAX_FILE_BYTES};
const maxSnippet = ${MAX_SNIPPET_CHARS};
const out = [];
function isText(file) {
  const name = path.basename(file).toLowerCase();
  const ext = path.extname(name);
  return textExt.has(ext) || textExt.has(name) || name === 'dockerfile';
}
function walk(dir) {
  if (out.length >= maxFiles) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (out.length >= maxFiles) break;
    if (ignore.has(entry.name) || entry.name.endsWith('.log')) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replace(/\\\\/g, '/');
    if (entry.isDirectory()) { walk(full); continue; }
    if (!entry.isFile()) continue;
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    let snippet = '';
    if (isText(full) && stat.size <= maxBytes) {
      try { snippet = fs.readFileSync(full, 'utf8').slice(0, maxSnippet); } catch {}
    }
    out.push({ path: rel, extension: path.extname(entry.name).toLowerCase(), size: stat.size, snippet });
  }
}
walk(root);
process.stdout.write(JSON.stringify(out));`;

    try {
      const output = execFileSync('docker', ['exec', source.containerName, 'node', '-e', script], {
        encoding: 'utf-8',
        timeout: 120000,
        maxBuffer: 50 * 1024 * 1024,
      });
      return JSON.parse(output);
    } catch (error) {
      throw new Error(`Failed to scan container workspace: ${error.message}`);
    }
  }

  buildDirectorySummaries(files) {
    const dirs = new Set();
    for (const file of files) {
      const parts = file.path.split('/');
      for (let i = 1; i < parts.length; i += 1) {
        dirs.add(parts.slice(0, i).join('/'));
      }
    }
    return [...dirs].sort().map((dir) => summarizeDirectory(dir, files));
  }

  detectStack(files) {
    const extensions = {};
    for (const file of files) {
      if (!file.extension) continue;
      extensions[file.extension] = (extensions[file.extension] || 0) + 1;
    }

    const packages = files
      .filter((file) => file.path.endsWith('package.json') && file.snippet)
      .map((file) => ({ file: file.path, json: safeJson(file.snippet) }))
      .filter((entry) => entry.json);

    const deps = new Set();
    const scripts = {};
    for (const pkg of packages) {
      for (const dep of Object.keys({ ...(pkg.json.dependencies || {}), ...(pkg.json.devDependencies || {}) })) deps.add(dep);
      Object.assign(scripts, pkg.json.scripts || {});
    }

    const languages = [];
    if (extensions['.ts'] || extensions['.tsx']) languages.push('typescript');
    if (extensions['.js'] || extensions['.jsx'] || extensions['.mjs'] || extensions['.cjs']) languages.push('javascript');
    if (extensions['.py']) languages.push('python');
    if (extensions['.go']) languages.push('go');
    if (extensions['.rs']) languages.push('rust');

    const frameworks = [];
    if (deps.has('react')) frameworks.push('react');
    if (deps.has('express')) frameworks.push('express');
    if (deps.has('vite')) frameworks.push('vite');
    if (deps.has('next')) frameworks.push('next');
    if (files.some((file) => file.path.toLowerCase().includes('dockerfile') || file.path.includes('docker-compose'))) frameworks.push('docker');

    return {
      languages,
      frameworks,
      packageManagers: this.detectPackageManagers(files),
      dependencies: [...deps].sort().slice(0, 200),
      scripts,
      extensions,
    };
  }

  detectPackageManagers(files) {
    const paths = new Set(files.map((file) => path.basename(file.path)));
    return [
      paths.has('pnpm-lock.yaml') ? 'pnpm' : null,
      paths.has('yarn.lock') ? 'yarn' : null,
      paths.has('package-lock.json') ? 'npm' : null,
      paths.has('bun.lockb') ? 'bun' : null,
    ].filter(Boolean);
  }

  buildGuidance(stack) {
    const keys = new Set(['soc2']);
    for (const language of stack.languages) keys.add(language);
    for (const framework of stack.frameworks) keys.add(framework);
    return [...keys].flatMap((key) => (STACK_GUIDANCE[key] || []).map((item) => ({ source: key, recommendation: item })));
  }

  searchIndex(index, query, options = {}) {
    const queryTokens = tokenize(query);
    const taskKind = options.taskKind || detectTaskKind(query);
    return index.files
      .map((file) => ({ ...file, score: scoreFile(file, queryTokens, taskKind) }))
      .filter((file) => file.score > 0)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, options.limit || CONTEXT_FILE_LIMIT);
  }

  planTask({ prompt, taskKind, index, relevantFiles, model }) {
    const editRequested = wantsFileChanges(prompt);
    const steps = [
      'Confirm the requested task type and success criteria.',
      'Use the workspace index first; inspect cited files before making claims.',
      'Apply stack guidance and deterministic checks where relevant.',
    ];

    if (taskKind === 'audit') {
      steps.push('Map findings to compliance/control themes and cite concrete files or gaps.');
      steps.push('Prioritize missing audit logging, access control, change management, and evidence collection.');
    } else if (taskKind === 'security') {
      steps.push('Review auth, API boundaries, dependency/config risk, secret exposure, and injection surfaces.');
      steps.push('Separate confirmed vulnerabilities from recommendations and unknowns.');
    } else if (taskKind === 'debug') {
      steps.push('Trace likely execution paths, identify hypotheses, and propose verification commands.');
      steps.push('Prefer minimal fixes backed by evidence from the relevant files.');
    } else if (taskKind === 'implementation') {
      steps.push('Identify the smallest file set needed for the change.');
      steps.push('Produce patch-ready instructions or unified diffs and list verification commands.');
    }

    if (editRequested) {
      steps.push('If changes are required, return explicit file paths and patch-ready edits; do not invent files that were not retrieved unless necessary.');
    } else {
      steps.push('Do not propose file modifications unless the user asks; answer from gathered evidence.');
    }

    return {
      id: uuidv4(),
      model: model || null,
      taskKind,
      editRequested,
      createdAt: new Date().toISOString(),
      relevantPaths: relevantFiles.map((file) => file.path),
      steps,
      loops: [
        'retrieve relevant context',
        'analyze in focused passes',
        'cross-check claims against indexed evidence',
        'produce final answer with confidence and verification steps',
      ],
    };
  }

  buildEvidenceLedger({ prompt, taskKind, relevantFiles, index }) {
    const claims = [];
    const now = new Date().toISOString();

    for (const file of relevantFiles.slice(0, 20)) {
      claims.push({
        id: uuidv4(),
        claim: `${file.path} is relevant to the requested ${taskKind} task.`,
        evidence: [
          {
            path: file.path,
            reason: file.purpose,
            riskTags: file.riskTags || [],
            score: file.score,
          },
        ],
        confidence: Math.min(0.95, 0.45 + (file.score / 25)),
        severity: this.deriveSeverity(file, taskKind),
        controlRelevance: this.deriveControlRelevance(file, taskKind),
        status: 'candidate',
        missingEvidence: file.snippet ? [] : ['File content was not embedded because it is binary, too large, or unavailable.'],
      });
    }

    return {
      createdAt: now,
      prompt: prompt.slice(0, 1000),
      rules: [
        'Final answer may only state confirmed technical claims when backed by file paths, command output, or cited research.',
        'Unsupported model guesses must be labeled as hypotheses or unknowns.',
        'High-severity findings require direct evidence and a concrete remediation path.',
      ],
      workspaceEvidence: {
        indexedFiles: index.stats.totalFiles,
        source: index.source,
      },
      claims,
    };
  }

  deriveSeverity(file, taskKind) {
    if (file.riskTags?.includes('secret-risk')) return 'critical';
    if (taskKind === 'security' && file.riskTags?.some((tag) => ['auth', 'injection-risk'].includes(tag))) return 'high';
    if (taskKind === 'audit' && file.riskTags?.some((tag) => ['auth', 'audit-logging', 'api'].includes(tag))) return 'medium';
    return 'info';
  }

  deriveControlRelevance(file, taskKind) {
    if (taskKind === 'audit' || file.riskTags?.includes('audit-logging')) {
      return ['audit logging', 'access control', 'change evidence'];
    }
    if (taskKind === 'security') {
      return ['vulnerability management', 'secure development', 'access control'];
    }
    return [];
  }

  buildCritiqueGates({ taskKind, editRequested }) {
    const gates = [
      {
        name: 'evidence-check',
        prompt: 'List every claim in the draft answer that lacks a concrete file path, command result, or cited research source. Remove or downgrade unsupported claims.',
        mustPass: true,
      },
      {
        name: 'false-positive-check',
        prompt: 'Challenge each finding. Identify alternate explanations, false positives, and missing files that could contradict the finding.',
        mustPass: true,
      },
      {
        name: 'missing-scope-check',
        prompt: 'Identify relevant routes, configs, tests, logs, dependencies, or docs that were not inspected but may affect the conclusion.',
        mustPass: true,
      },
    ];

    if (taskKind === 'audit' || taskKind === 'security') {
      gates.push({
        name: 'severity-check',
        prompt: 'Re-rank severity using exploitability, data sensitivity, user impact, and presence of compensating controls. Do not overstate severity.',
        mustPass: true,
      });
    }

    if (editRequested) {
      gates.push({
        name: 'patch-risk-check',
        prompt: 'Review proposed edits for regressions, backwards compatibility concerns, touched-file scope, test coverage, and simpler alternatives.',
        mustPass: true,
      });
    }

    return {
      createdAt: new Date().toISOString(),
      gates,
      minimumPassesBeforeFinal: editRequested ? 3 : 2,
    };
  }

  buildVerificationPlan({ taskKind, editRequested, stack, relevantFiles }) {
    const commands = [];
    const scripts = stack.scripts || {};
    const packageManager = stack.packageManagers?.[0] || 'npm';

    if (scripts.lint) commands.push({ command: `${packageManager} run lint`, purpose: 'Check style/static errors after analysis or edits.', requiredForEdits: true });
    if (scripts.test) commands.push({ command: `${packageManager} test`, purpose: 'Run project test suite.', requiredForEdits: true });
    if (scripts.build) commands.push({ command: `${packageManager} run build`, purpose: 'Verify production build still succeeds.', requiredForEdits: true });
    if (scripts.typecheck) commands.push({ command: `${packageManager} run typecheck`, purpose: 'Verify TypeScript types.', requiredForEdits: true });

    if (stack.dependencies?.length) {
      commands.push({ command: `${packageManager} audit`, purpose: 'Check known dependency vulnerabilities.', requiredForEdits: false });
    }

    if (taskKind === 'security' || taskKind === 'audit') {
      commands.push(
        { command: 'semgrep scan --config auto .', purpose: 'Static security scan if Semgrep is installed.', optional: true },
        { command: 'gitleaks detect --source .', purpose: 'Secret scanning if Gitleaks is installed.', optional: true },
        { command: 'trivy fs .', purpose: 'Filesystem/dependency/container risk scan if Trivy is installed.', optional: true },
      );
    }

    if (commands.length === 0) {
      commands.push({ command: 'Review relevant files manually and run the project-specific test/build command if available.', purpose: 'No deterministic project scripts were detected.', manual: true });
    }

    return {
      createdAt: new Date().toISOString(),
      taskKind,
      editRequested,
      relevantPaths: relevantFiles.map((file) => file.path),
      commands,
      acceptanceCriteria: [
        'All final claims cite workspace evidence or research sources.',
        'Known uncertainty is explicitly listed.',
        editRequested ? 'Proposed edits include verification commands and rollback/risk notes.' : 'No file changes are proposed unless explicitly requested.',
      ],
    };
  }

  buildAugmentedPrompt({ prompt, index, research, relevantFiles, plan, taskKind, job, evidenceLedger, critiqueGates, verificationPlan }) {
    const stackLines = [
      `Languages: ${index.stack.languages.join(', ') || 'unknown'}`,
      `Frameworks/tools: ${index.stack.frameworks.join(', ') || 'unknown'}`,
      `Package managers: ${index.stack.packageManagers.join(', ') || 'unknown'}`,
      `Indexed files: ${index.stats.totalFiles}; source: ${index.source.type}:${index.source.root}`,
    ].join('\n');

    const guidance = index.guidance
      .slice(0, 18)
      .map((item) => `- [${item.source}] ${item.recommendation}`)
      .join('\n');

    const files = relevantFiles.map((file) => {
      const tags = file.riskTags?.length ? ` Tags: ${file.riskTags.join(', ')}` : '';
      const snippet = file.snippet ? `\nSnippet:\n\`\`\`\n${file.snippet.slice(0, 2400)}\n\`\`\`` : '';
      return `### ${file.path}\nPurpose: ${file.purpose}.${tags}\nScore: ${file.score}${snippet}`;
    }).join('\n\n');

    const evidence = evidenceLedger.claims
      .slice(0, 18)
      .map((claim) => `- [${claim.severity}] ${claim.claim} Evidence: ${claim.evidence.map((item) => item.path).join(', ')} Confidence: ${claim.confidence.toFixed(2)}`)
      .join('\n');

    const critique = critiqueGates.gates
      .map((gate, index) => `${index + 1}. ${gate.name}: ${gate.prompt}`)
      .join('\n');

    const verification = verificationPlan.commands
      .map((item) => `- ${item.command} — ${item.purpose}${item.optional ? ' (optional)' : ''}`)
      .join('\n');

    const researchLines = research?.sources?.length
      ? research.sources.map((source) => `- ${source.title} (${source.url}) — ${source.summary}`).join('\n')
      : '- No external research sources were available for this task.';

    return `You are the Ollama coding assistant inside StartUpp AI IDE. The IDE is orchestrating your work because local models have limited context. Follow the IDE plan exactly, use only provided evidence unless you state that more inspection is needed, and keep claims tied to file paths.

## User Task
${prompt}

## Orchestrator Scope
- This orchestration applies only because the selected AI Coding Assistant is Ollama.
- Orchestration job: ${job?.id || 'not persisted'}
- Task kind: ${taskKind}
- File changes requested: ${plan.editRequested ? 'yes' : 'no'}
- If file changes are requested, return concrete patch-ready edits or unified diffs and verification commands.
- If file changes are not requested, do not modify files; provide an evidence-based response.

## Workspace Stack
${stackLines}

## Current Best-Practice Guidance
${guidance || '- No stack-specific guidance detected.'}

## Current Internet Research Cache
${researchLines}

## Plan
${plan.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}

## Evidence Ledger Rules
${evidenceLedger.rules.map((rule) => `- ${rule}`).join('\n')}

## Candidate Evidence Ledger
${evidence || '- No candidate evidence yet. Ask for a broader scan before making firm claims.'}

## Mandatory Critique Gates Before Final Answer
Run these critique passes internally before answering. If a gate fails, revise first.
${critique}

## Deterministic Verification Plan
Mention the relevant commands in the final answer. If you cannot run them, say they are recommended verification steps.
${verification}

## Relevant Workspace Evidence
${files || 'No specific files matched. Ask for or request a broader scan if needed.'}

## Response Requirements
- Lead with the direct answer or findings.
- Cite file paths for every technical claim.
- Separate confirmed evidence, likely risks, and recommended next steps.
- For SOC2/security work, include severity and control/audit relevance.
- For bug investigations, include hypotheses and verification commands.
- For implementation requests, include minimal patch-ready changes and verification commands.
- Include a short "Residual Risk" section listing what was not verified.
`;
  }

  readIndex(projectId) {
    const filePath = this.indexPath(projectId);
    if (!fs.existsSync(filePath)) return null;
    return readJsonSafe(filePath);
  }

  writeIndex(projectId, index) {
    ensureDir(DATA_DIR);
    fs.writeFileSync(this.indexPath(projectId), JSON.stringify(index, null, 2), { mode: 0o600 });
  }

  indexPath(projectId) {
    return path.join(DATA_DIR, `${projectId}.json`);
  }

  jobPath(jobId) {
    return path.join(JOBS_DIR, `${jobId}.json`);
  }

  artifactPath(jobId, name) {
    const dir = path.join(JOBS_DIR, jobId);
    ensureDir(dir);
    return path.join(dir, `${name}.json`);
  }

  researchPath(url) {
    const safeName = Buffer.from(url).toString('base64url');
    return path.join(RESEARCH_DIR, `${safeName}.json`);
  }

  saveJob(job) {
    ensureDir(JOBS_DIR);
    fs.writeFileSync(this.jobPath(job.id), JSON.stringify(job, null, 2), { mode: 0o600 });
  }

  getJob(jobId) {
    const filePath = this.jobPath(jobId);
    if (!fs.existsSync(filePath)) return null;
    return readJsonSafe(filePath);
  }

  getJobArtifact(jobId, name) {
    const filePath = this.artifactPath(jobId, name);
    if (!fs.existsSync(filePath)) return null;
    return readJsonSafe(filePath);
  }

  listJobs(projectId, sessionId = null, limit = 20) {
    ensureDir(JOBS_DIR);
    return fs.readdirSync(JOBS_DIR)
      .filter((file) => file.endsWith('.json'))
      .map((file) => readJsonSafe(path.join(JOBS_DIR, file)))
      .filter((job) => job && job.projectId === projectId && (!sessionId || job.sessionId === sessionId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  getStatus(projectId) {
    const index = this.readIndex(projectId);
    const recentJobs = this.listJobs(projectId, null, 5).map((job) => ({
      id: job.id,
      taskKind: job.taskKind,
      status: job.status,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    }));
    if (!index) return { indexed: false, recentJobs };
    return {
      indexed: true,
      scannedAt: index.scannedAt,
      stats: index.stats,
      stack: index.stack,
      source: index.source,
      recentJobs,
    };
  }
}

function safeJson(content) {
  try { return JSON.parse(content); } catch { return null; }
}

function stripHtml(content) {
  return String(content || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeResearchText(text) {
  const sentences = String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 60 && item.length < 500);
  return sentences.slice(0, 3).join(' ' ) || String(text || '').slice(0, 500);
}

export const ollamaWorkspaceOrchestrator = new OllamaWorkspaceOrchestrator();
export default ollamaWorkspaceOrchestrator;
