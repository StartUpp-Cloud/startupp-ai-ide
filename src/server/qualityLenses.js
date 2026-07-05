/**
 * Quality Lenses — project-type-aware "senior engineer / designer eye" nudges.
 *
 * A lens is a compact, high-signal checklist for a domain (backend, UI, …). The
 * orchestrator uses each lens at TWO stages:
 *   - GUIDANCE  (draft): injected into the coding agent's preamble so it builds
 *     it right the first time.
 *   - RUBRIC (finalize): injected into the finalizer prompt so it grades the
 *     actual diff against the same checklist and fixes violations.
 *
 * The value multiplier is GROUNDING: instead of generic advice, we detect the
 * project's real conventions (validation lib, date lib, ORM, framework, i18n)
 * and phrase the nudges in terms of the tools already in use. Lenses are
 * auto-selected by project type — nothing to install per project.
 *
 * This first lens is BACKEND ROBUSTNESS (A1): validation, string lengths, data
 * types, dates/timezones, pagination, i18n, security. Deliberately self-gating
 * ("when you touch server/API/data code…") so it's harmless on mixed monorepos.
 */

import fs from 'fs';
import path from 'path';

// ── Dependency → tool maps (first match wins, in rough preference order) ──
const VALIDATION_LIBS = ['zod', 'valibot', '@sinclair/typebox', 'yup', 'joi', 'class-validator', 'superstruct', 'io-ts', 'ajv'];
const DATE_LIBS = ['luxon', 'dayjs', 'date-fns-tz', 'date-fns', '@js-joda/core', 'moment-timezone', 'moment'];
const ORMS = ['@prisma/client', 'prisma', 'drizzle-orm', 'typeorm', 'sequelize', 'kysely', 'knex', 'mongoose'];
const BACKEND_FRAMEWORKS = ['@nestjs/core', 'express', 'fastify', 'hono', 'koa', '@hapi/hapi', 'next'];
const I18N_LIBS = ['i18next', 'react-i18next', 'next-intl', '@lingui/core', '@formatjs/intl', 'vue-i18n'];

const PRETTY = {
  '@prisma/client': 'Prisma', 'prisma': 'Prisma', 'drizzle-orm': 'Drizzle', 'typeorm': 'TypeORM',
  'sequelize': 'Sequelize', 'kysely': 'Kysely', 'knex': 'Knex', 'mongoose': 'Mongoose',
  '@nestjs/core': 'NestJS', 'express': 'Express', 'fastify': 'Fastify', 'hono': 'Hono',
  'koa': 'Koa', '@hapi/hapi': 'hapi', 'next': 'Next.js',
  '@sinclair/typebox': 'TypeBox', 'class-validator': 'class-validator', 'date-fns-tz': 'date-fns-tz',
  'react-i18next': 'react-i18next', 'next-intl': 'next-intl', '@lingui/core': 'Lingui',
  '@formatjs/intl': 'FormatJS', 'vue-i18n': 'vue-i18n', '@js-joda/core': 'js-joda',
  'moment-timezone': 'moment-timezone',
};
const pretty = (dep) => PRETTY[dep] || dep;

// ── Convention detection (cached by folderPath) ──
const _cache = new Map(); // folderPath -> { at, conventions }
const CACHE_TTL_MS = 5 * 60 * 1000;

function firstPresent(depSet, list) {
  for (const dep of list) if (depSet.has(dep)) return dep;
  return null;
}

/**
 * Walk the project (bounded) collecting dependency names from every package.json
 * and noting whether TypeScript is in play. Monorepo-friendly: reads workspace
 * package.json files too, skipping node_modules/.git/build dirs.
 */
function collectDeps(folderPath) {
  const deps = new Set();
  let hasTsconfig = false;
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.turbo', 'vendor']);
  let filesRead = 0;
  const MAX_FILES = 60;

  const walk = (dir, depth) => {
    if (depth > 3 || filesRead >= MAX_FILES) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (filesRead >= MAX_FILES) return;
      if (e.isDirectory()) {
        if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else if (e.name === 'package.json') {
        filesRead++;
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(dir, e.name), 'utf8'));
          for (const k of Object.keys(pkg.dependencies || {})) deps.add(k);
          for (const k of Object.keys(pkg.devDependencies || {})) deps.add(k);
        } catch { /* ignore malformed */ }
      } else if (e.name === 'tsconfig.json') {
        hasTsconfig = true;
      }
    }
  };

  try { walk(folderPath, 0); } catch { /* ignore */ }
  return { deps, hasTsconfig };
}

export function detectConventions(folderPath) {
  if (!folderPath) return null;
  const cached = _cache.get(folderPath);
  // Date.now via a monotonic-ish check; acceptable for a soft cache.
  const now = Date.now();
  if (cached && (now - cached.at) < CACHE_TTL_MS) return cached.conventions;

  if (!fs.existsSync(folderPath)) return null;
  const { deps, hasTsconfig } = collectDeps(folderPath);

  const validation = firstPresent(deps, VALIDATION_LIBS);
  const dateLib = firstPresent(deps, DATE_LIBS);
  const orm = firstPresent(deps, ORMS);
  const framework = firstPresent(deps, BACKEND_FRAMEWORKS);
  const i18n = firstPresent(deps, I18N_LIBS);
  const isTs = hasTsconfig || deps.has('typescript');

  const conventions = {
    isTs,
    validation,
    dateLib,
    orm,
    framework,
    i18n,
    // Backend if it has a server framework or an ORM/query builder.
    hasBackend: !!(orm || framework),
  };

  _cache.set(folderPath, { at: now, conventions });
  return conventions;
}

export function clearConventionCache(folderPath = null) {
  if (folderPath) _cache.delete(folderPath);
  else _cache.clear();
}

// ── Backend robustness lens (grounded in detected conventions) ──

function backendGuidance(c) {
  const val = c.validation ? ` using ${pretty(c.validation)} (the project's validation lib)` : '';
  const date = c.dateLib ? ` via ${pretty(c.dateLib)}` : '';
  const ormNote = c.orm ? ` Use ${pretty(c.orm)} the way the existing models/queries do.` : '';
  const tsNote = c.isTs ? ' No `any` for data crossing a boundary — model the exact shape and parse, don\'t cast.' : '';
  const i18nNote = c.i18n ? ` User-facing strings go through ${pretty(c.i18n)}, never hardcoded.` : '';

  return [
    'BACKEND ROBUSTNESS — when you touch server / API / data / model / migration code, hold to these (they prevent the most common production bugs):',
    `- Validate & normalize EVERY external input at the boundary${val}. Bound every string with a max length; reject or clamp out-of-range numbers. Never trust client-supplied ids, counts, or pagination params.`,
    `- Pagination: any endpoint or query that returns a list MUST paginate and return a total count — never return an unbounded set (a table can hold thousands or millions of rows).`,
    `- Dates & timezones: store timestamps in UTC${date}; render in the user's timezone; ALWAYS specify the zone when constructing a date; use ISO-8601. Never rely on server-local time or ambiguous formats.`,
    '- Numbers: money and precise decimals are integer (cents) or a decimal type — never a float.',
    `- Types & state:${tsNote} Use typed enums/unions for status fields, not free strings.`,
    '- Nullability & errors: handle null / undefined / empty explicitly; fail with clear, typed errors; never silently swallow.',
    '- Security: parameterize every query (no string-built SQL); authorize every mutation; never log secrets or PII; rate-limit sensitive endpoints.',
    (i18nNote ? `-${i18nNote}` : null),
    `- Consistency beats novelty: reuse the project's established validator, date helper, and error type rather than introducing a new one.${ormNote}`,
  ].filter(Boolean).join('\n');
}

function backendRubric(c) {
  const val = c.validation ? ` (project uses ${pretty(c.validation)})` : '';
  const date = c.dateLib ? ` (project uses ${pretty(c.dateLib)})` : '';
  const i18nCheck = c.i18n ? ` Hardcoded user-facing strings where ${pretty(c.i18n)} should be used?` : '';
  return [
    'BACKEND ROBUSTNESS REVIEW — grade the drafter\'s diff against this rubric and FIX every violation. Report each as `file:line — issue → fix`:',
    `- Inputs validated & length-bounded at the boundary?${val} Any unbounded string or untrusted id/count/pagination param?`,
    '- Any list endpoint/query returning an unbounded set with no pagination + total?',
    `- Dates stored UTC, rendered in user TZ, zone always explicit, ISO-8601?${date} Any server-local or ambiguous date?`,
    '- Money/precise decimals as integer or decimal (never float)?',
    '- Boundary data strongly typed (no `any`); status fields as typed enums (not free strings)?',
    '- Null/undefined/empty handled; no swallowed errors?',
    '- Queries parameterized; mutations authorized; no secret/PII logging?' + i18nCheck,
    '- Consistent with the project\'s existing validator / date helper / error type / ORM patterns?',
  ].join('\n');
}

// Registry — one entry per lens. Future lenses (UI, etc.) slot in here.
const LENSES = [
  {
    id: 'backend-robustness',
    name: 'Backend Robustness',
    applies: (c) => !!c?.hasBackend,
    guidance: backendGuidance,
    rubric: backendRubric,
  },
];

function lensesEnabled(project) {
  // Default ON. Escape hatches: project.data flag or env kill-switch.
  if (process.env.DISABLE_QUALITY_LENSES === '1') return false;
  if (project?.lensesDisabled === true) return false;
  return true;
}

function selectLenses(project) {
  if (!lensesEnabled(project)) return { conventions: null, lenses: [] };
  const conventions = detectConventions(project?.folderPath);
  if (!conventions) return { conventions: null, lenses: [] };
  return { conventions, lenses: LENSES.filter((l) => l.applies(conventions)) };
}

/**
 * Draft-time guidance block for the agent preamble (or null if no lens applies).
 * @param {object} project - a Project record (needs folderPath; optional lensesDisabled)
 */
export function buildLensGuidance(project) {
  const { conventions, lenses } = selectLenses(project);
  if (!lenses.length) return null;
  const blocks = lenses.map((l) => l.guidance(conventions)).filter(Boolean);
  if (!blocks.length) return null;
  return blocks.join('\n\n');
}

/**
 * Finalizer-time review rubric block (or null if no lens applies). Injected into
 * the finalizer PROMPT so it survives lean context.
 */
export function buildLensRubric(project) {
  const { conventions, lenses } = selectLenses(project);
  if (!lenses.length) return null;
  const blocks = lenses.map((l) => l.rubric(conventions)).filter(Boolean);
  if (!blocks.length) return null;
  return blocks.join('\n\n');
}

/** Introspection for a future Doctor/settings panel. */
export function describeLenses(project) {
  const { conventions, lenses } = selectLenses(project);
  return { conventions, active: lenses.map((l) => ({ id: l.id, name: l.name })) };
}
