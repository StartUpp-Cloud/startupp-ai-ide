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

// ── Frontend / UI stack ──
const UI_FRAMEWORKS = ['next', 'react', 'vue', 'svelte', '@angular/core', 'solid-js', 'preact'];
const CSS_FRAMEWORKS = ['tailwindcss', 'unocss', 'styled-components', '@emotion/react', '@vanilla-extract/css', '@stitches/react', 'sass', 'less'];
const COMPONENT_LIBS_EXACT = ['@mui/material', '@chakra-ui/react', 'antd', '@mantine/core', '@headlessui/react', 'react-aria-components'];
const THEME_LIBS = ['next-themes'];

const PRETTY = {
  '@prisma/client': 'Prisma', 'prisma': 'Prisma', 'drizzle-orm': 'Drizzle', 'typeorm': 'TypeORM',
  'sequelize': 'Sequelize', 'kysely': 'Kysely', 'knex': 'Knex', 'mongoose': 'Mongoose',
  '@nestjs/core': 'NestJS', 'express': 'Express', 'fastify': 'Fastify', 'hono': 'Hono',
  'koa': 'Koa', '@hapi/hapi': 'hapi', 'next': 'Next.js',
  '@sinclair/typebox': 'TypeBox', 'class-validator': 'class-validator', 'date-fns-tz': 'date-fns-tz',
  'react-i18next': 'react-i18next', 'next-intl': 'next-intl', '@lingui/core': 'Lingui',
  '@formatjs/intl': 'FormatJS', 'vue-i18n': 'vue-i18n', '@js-joda/core': 'js-joda',
  'moment-timezone': 'moment-timezone',
  // UI
  'react': 'React', 'vue': 'Vue', 'svelte': 'Svelte', '@angular/core': 'Angular',
  'solid-js': 'Solid', 'preact': 'Preact', 'tailwindcss': 'Tailwind', 'unocss': 'UnoCSS',
  'styled-components': 'styled-components', '@emotion/react': 'Emotion',
  '@vanilla-extract/css': 'vanilla-extract', '@stitches/react': 'Stitches', 'sass': 'Sass',
  '@mui/material': 'MUI', '@chakra-ui/react': 'Chakra UI', 'antd': 'Ant Design',
  '@mantine/core': 'Mantine', '@headlessui/react': 'Headless UI', 'react-aria-components': 'React Aria',
  '@radix-ui': 'Radix', 'next-themes': 'next-themes',
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
  const tailwindConfigs = [];
  const cssFiles = [];
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
      } else if (/^tailwind\.config\.(js|ts|cjs|mjs)$/.test(e.name)) {
        if (tailwindConfigs.length < 6) tailwindConfigs.push(path.join(dir, e.name));
      } else if (e.name.endsWith('.css') && cssFiles.length < 12) {
        cssFiles.push(path.join(dir, e.name));
      }
    }
  };

  try { walk(folderPath, 0); } catch { /* ignore */ }
  return { deps, hasTsconfig, tailwindConfigs, cssFiles };
}

/** Detect the component library (handles Radix's many @radix-ui/* packages). */
function detectComponentLib(depSet) {
  const exact = firstPresent(depSet, COMPONENT_LIBS_EXACT);
  if (exact) return exact;
  for (const d of depSet) if (d.startsWith('@radix-ui/')) return '@radix-ui';
  return null;
}

// ── Design-token extraction (best-effort; the agent can also read the config) ──

/** Return the balanced `{…}` block for `key:` in source, or null. */
function extractObjectBlock(src, key) {
  const m = src.match(new RegExp(key + '\\s*:\\s*\\{'));
  if (!m) return null;
  let i = m.index + m[0].length - 1; // at the opening '{'
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

/** Top-level keys of an object block string (ignores nested keys). */
function topLevelKeys(block) {
  const inner = block.slice(1, -1);
  const keys = [];
  let depth = 0, i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '{' || ch === '[' || ch === '(') { depth++; i++; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { depth--; i++; continue; }
    if (depth === 0) {
      const m = inner.slice(i).match(/^\s*(['"]?)([A-Za-z_$][\w-]*)\1\s*:/);
      if (m) { keys.push(m[2]); i += m[0].length; continue; }
    }
    i++;
  }
  return [...new Set(keys)];
}

function extractDesignTokens({ tailwindConfigs = [], cssFiles = [] }) {
  const t = { hasTailwind: tailwindConfigs.length > 0, configPath: null, darkMode: null, colors: [], fonts: [], screens: [], cssVars: [] };

  for (const cfg of tailwindConfigs.slice(0, 3)) {
    let src; try { src = fs.readFileSync(cfg, 'utf8'); } catch { continue; }
    if (!t.configPath) t.configPath = cfg;
    if (!t.darkMode) {
      const dm = src.match(/darkMode\s*:\s*['"](class|media|selector)['"]/);
      if (dm) t.darkMode = dm[1];
      else if (/darkMode\s*:\s*\[/.test(src)) t.darkMode = 'class';
    }
    const colors = extractObjectBlock(src, 'colors');
    if (colors) t.colors.push(...topLevelKeys(colors));
    const fonts = extractObjectBlock(src, 'fontFamily');
    if (fonts) t.fonts.push(...topLevelKeys(fonts));
    const screens = extractObjectBlock(src, 'screens');
    if (screens) t.screens.push(...topLevelKeys(screens));
  }

  // CSS custom properties — the token vocabulary of CSS-variable / shadcn systems.
  for (const css of cssFiles.slice(0, 8)) {
    let src; try { src = fs.readFileSync(css, 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/--([a-z0-9][\w-]*)\s*:/gi)) t.cssVars.push(m[1]);
  }

  // Drop tailwind's built-in passthroughs and shade-number keys; dedupe + cap.
  const skipColors = new Set(['transparent', 'current', 'inherit', 'white', 'black']);
  t.colors = [...new Set(t.colors)].filter((c) => !/^\d+$/.test(c) && !skipColors.has(c)).slice(0, 14);
  t.fonts = [...new Set(t.fonts)].slice(0, 6);
  t.screens = [...new Set(t.screens)].slice(0, 8);
  t.cssVars = [...new Set(t.cssVars)].slice(0, 20);
  return t;
}

export function detectConventions(folderPath) {
  if (!folderPath) return null;
  const cached = _cache.get(folderPath);
  // Date.now via a monotonic-ish check; acceptable for a soft cache.
  const now = Date.now();
  if (cached && (now - cached.at) < CACHE_TTL_MS) return cached.conventions;

  if (!fs.existsSync(folderPath)) return null;
  const { deps, hasTsconfig, tailwindConfigs, cssFiles } = collectDeps(folderPath);

  const validation = firstPresent(deps, VALIDATION_LIBS);
  const dateLib = firstPresent(deps, DATE_LIBS);
  const orm = firstPresent(deps, ORMS);
  const framework = firstPresent(deps, BACKEND_FRAMEWORKS);
  const i18n = firstPresent(deps, I18N_LIBS);
  const isTs = hasTsconfig || deps.has('typescript');

  // Frontend / UI
  const uiFramework = firstPresent(deps, UI_FRAMEWORKS);
  const cssFramework = firstPresent(deps, CSS_FRAMEWORKS);
  const componentLib = detectComponentLib(deps);
  const themeLib = firstPresent(deps, THEME_LIBS);
  const hasFrontend = !!(uiFramework || cssFramework || tailwindConfigs.length);
  const designTokens = hasFrontend ? extractDesignTokens({ tailwindConfigs, cssFiles }) : null;

  const conventions = {
    isTs,
    validation,
    dateLib,
    orm,
    framework,
    i18n,
    // Backend if it has a server framework or an ORM/query builder.
    hasBackend: !!(orm || framework),
    // Frontend / UI
    uiFramework,
    cssFramework,
    componentLib,
    themeLib,
    hasFrontend,
    designTokens,
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

// ── UI / design lens (grounded in the project's real design tokens) ──

function uiGuidance(c) {
  const d = c.designTokens || {};
  const colorHint = d.colors?.length ? ` (e.g. ${d.colors.slice(0, 8).join(', ')})` : '';
  const fontHint = d.fonts?.length ? ` fonts (${d.fonts.join('/')}),` : '';
  const cfgHint = d.configPath ? ` — read ${path.basename(d.configPath)} for the full set` : '';
  const cssVarHint = (!d.hasTailwind && d.cssVars?.length)
    ? ` Use the CSS custom properties defined in the stylesheets (e.g. --${d.cssVars.slice(0, 6).join(', --')}).` : '';
  const themeNote = (d.darkMode || c.themeLib)
    ? ` Support BOTH light and dark themes — use tokens that resolve per theme (${c.themeLib ? pretty(c.themeLib) : `Tailwind darkMode: ${d.darkMode}`}); never hardcode a color that only works in one theme, and verify both.` : '';
  const screenHint = d.screens?.length ? ` at the project's breakpoints (${d.screens.join(', ')})` : '';
  const libNote = c.componentLib ? ` Prefer ${pretty(c.componentLib)} primitives already in use rather than new bespoke components.` : '';

  return [
    'UI / DESIGN — when you touch components, styles, or markup, work like a designer who respects the existing system:',
    `- Use the project's design tokens, never hardcoded values.${d.hasTailwind ? ` Use Tailwind theme utilities for color${colorHint},${fontHint} spacing, and radius — no raw hex or arbitrary \`[13px]\` values${cfgHint}.` : ''}${cssVarHint}`,
    (themeNote ? `-${themeNote}` : null),
    '- Keep spacing, sizing, and gaps on the project\'s scale; align elements to a consistent grid — don\'t eyeball one-off pixel values.',
    '- Every interactive element needs hover, focus-visible, disabled, and (where relevant) active/loading states, and must be keyboard-navigable.',
    '- Maintain readable contrast (≥ 4.5:1 for body text); label controls; never convey meaning by color alone.',
    `- Design responsive${screenHint}; no horizontal overflow or layout shift.`,
    `- Match existing component patterns — variants, sizes, radius, and shadow tokens — instead of inventing new ones.${libNote}`,
  ].filter(Boolean).join('\n');
}

function uiRubric(c) {
  const d = c.designTokens || {};
  const tokenRef = d.configPath ? ` (allowed tokens in ${path.basename(d.configPath)})` : '';
  const themeCheck = (d.darkMode || c.themeLib) ? ' Any color that breaks in dark OR light theme?' : '';
  return [
    'UI / DESIGN REVIEW — grade the diff against this and FIX every violation. Report each as `file:line — issue → fix`:',
    `- Hardcoded colors / px / arbitrary values instead of design tokens or Tailwind utilities?${tokenRef}`,
    (themeCheck ? `-${themeCheck}` : null),
    '- Off-scale or one-off spacing/sizing; misaligned or inconsistently padded elements?',
    '- Missing hover / focus-visible / disabled states; not keyboard-navigable?',
    '- Insufficient contrast; meaning conveyed by color alone; unlabeled controls?',
    '- Not responsive at the breakpoints; horizontal overflow or layout shift?',
    `- Inconsistent with existing component variants / radius / shadow${c.componentLib ? ` / ${pretty(c.componentLib)} primitives` : ''}?`,
  ].filter(Boolean).join('\n');
}

// Registry — one entry per lens. Future lenses slot in here.
const LENSES = [
  {
    id: 'backend-robustness',
    name: 'Backend Robustness',
    applies: (c) => !!c?.hasBackend,
    guidance: backendGuidance,
    rubric: backendRubric,
  },
  {
    id: 'ui-design',
    name: 'UI Design',
    applies: (c) => !!c?.hasFrontend,
    guidance: uiGuidance,
    rubric: uiRubric,
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
