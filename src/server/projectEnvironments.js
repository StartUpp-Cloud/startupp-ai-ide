/**
 * projectEnvironments — per-project dev/staging/prod targets + test users.
 *
 * Lets the harness/agent log in as a known test user, exercise the running app
 * (CRUD, navigation), and assert behavior end-to-end — including cross-tenant
 * isolation probes. Test-user secrets are encrypted at rest (fieldEncryption)
 * and NEVER placed in prompts; the agent only ever sees a non-secret summary
 * plus the env-var NAMES under which secrets are injected at runtime.
 *
 * Safety: each environment declares `writesAllowed`. Production defaults to
 * read-only; the safetySystem blocks destructive ops against read-only targets.
 */

import { v4 as uuidv4 } from 'uuid';
import { encrypt, decrypt, isEncrypted } from './fieldEncryption.js';
import { getDB } from './db.js';

// Sentinel the client echoes back for an unchanged secret (so we preserve the
// stored ciphertext instead of overwriting it with the mask).
export const SECRET_MASK = '••••••••';

function slug(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Env-var name a test user's secret is injected under at runtime. */
export function testUserEnvVar(envName, userLabel, kind = 'PASSWORD') {
  return `TESTUSER_${slug(envName)}_${slug(userLabel)}_${slug(kind)}`;
}

function normalizeTestUser(user, prior = null) {
  const label = String(user?.label || user?.username || 'user').trim();
  const id = user?.id || prior?.id || uuidv4();
  // Secret handling: a fresh non-empty, non-mask password is encrypted; the mask
  // (or empty when a prior secret exists) preserves the stored ciphertext.
  let secretEnc = prior?.secretEnc || null;
  const incoming = user?.password;
  if (typeof incoming === 'string' && incoming && incoming !== SECRET_MASK) {
    secretEnc = isEncrypted(incoming) ? incoming : encrypt(incoming);
  } else if (incoming === '' && !user?.keepSecret) {
    secretEnc = null; // explicit clear
  }
  return {
    id,
    label,
    username: String(user?.username || '').trim(),
    tenantId: user?.tenantId ? String(user.tenantId).trim() : null,
    role: user?.role ? String(user.role).trim() : null,
    secretEnc,
  };
}

/**
 * Normalize+secure an environments array for storage. `existing` is the
 * project's currently-stored environments, used to preserve encrypted secrets
 * when the client sends back masked values.
 */
export function normalizeEnvironments(input, existing = []) {
  if (!Array.isArray(input)) return Array.isArray(existing) ? existing : [];
  const priorById = new Map();
  for (const env of existing || []) {
    for (const u of env.testUsers || []) priorById.set(u.id, u);
  }
  return input
    .filter((env) => env && (env.name || env.label))
    .map((env) => {
      const name = String(env.name || env.label).trim();
      return {
        id: env.id || uuidv4(),
        name,
        label: String(env.label || name).trim(),
        baseUrl: env.baseUrl ? String(env.baseUrl).trim().replace(/\/+$/, '') : null,
        // Production is read-only unless explicitly enabled.
        writesAllowed: typeof env.writesAllowed === 'boolean'
          ? env.writesAllowed
          : !/prod/i.test(name),
        testUsers: Array.isArray(env.testUsers)
          ? env.testUsers.map((u) => normalizeTestUser(u, priorById.get(u?.id) || null))
          : [],
      };
    });
}

/** Strip ciphertext before sending to the client (replace with a presence flag). */
export function maskEnvironmentsForClient(environments = []) {
  return (environments || []).map((env) => ({
    id: env.id,
    name: env.name,
    label: env.label,
    baseUrl: env.baseUrl,
    writesAllowed: env.writesAllowed,
    testUsers: (env.testUsers || []).map((u) => ({
      id: u.id,
      label: u.label,
      username: u.username,
      tenantId: u.tenantId,
      role: u.role,
      hasSecret: !!u.secretEnc,
      password: u.secretEnc ? SECRET_MASK : '',
    })),
  }));
}

export function getProjectEnvironments(projectId) {
  try {
    const db = getDB();
    const project = (db.data.projects || []).find((p) => p.id === projectId);
    return Array.isArray(project?.environments) ? project.environments : [];
  } catch {
    return [];
  }
}

export function findEnvironment(projectId, environmentName) {
  if (!environmentName) return null;
  return getProjectEnvironments(projectId)
    .find((e) => e.name.toLowerCase() === String(environmentName).toLowerCase()) || null;
}

export function isWriteAllowed(projectId, environmentName) {
  const env = findEnvironment(projectId, environmentName);
  return env ? !!env.writesAllowed : true; // unknown env → don't block
}

/**
 * Non-secret block injected into the agent's context so it knows it can log in
 * and assert against the running app, which targets allow writes, and the
 * env-var names holding each test user's secret.
 */
export function buildEnvironmentsSummary(projectId) {
  const envs = getProjectEnvironments(projectId);
  if (!envs.length) return '';
  const lines = ['<available_environments>'];
  lines.push(
    'TEST ACCESS — the user has configured real, working test logins below. When the user asks you to verify, validate, test, log in, reproduce, or check behavior against any of these environments (including production), you ARE EXPECTED AND ENCOURAGED to actually do it — do not say you lack access or credentials, and do not merely describe what you would do. Concretely:',
  );
  lines.push('- Use the environment\'s baseUrl and log in as the named test user. The password is NOT shown here; it is injected into your shell as the named environment variable — read it at runtime (e.g. `printenv VAR` in bash, or `process.env.VAR` in Node). Never print or echo a secret value.');
  lines.push('- READ-ONLY environments: you MAY still log in and READ/verify/assert — read access is encouraged. Only creating/updating/deleting data is disallowed there.');
  lines.push('- Prefer curl/HTTP or the app\'s API for login + assertions; drive a browser only if needed. Report exactly what you logged in as, what you checked, and the observed result.');
  lines.push('- If a password environment variable is empty/unset, this terminal session was started BEFORE these credentials were configured — tell the user to open a NEW session (or restart the project container) and retry; do NOT silently give up.');
  for (const env of envs) {
    lines.push(`\n- ${env.label} (name: "${env.name}") — ${env.writesAllowed ? 'WRITES ALLOWED (you may create/update/delete here)' : 'READ-ONLY (log in & read/verify OK; do NOT create/update/delete)'}`);
    if (env.baseUrl) lines.push(`  baseUrl: ${env.baseUrl} (also in $TESTENV_${slug(env.name)}_BASEURL)`);
    if (!(env.testUsers || []).length) lines.push('  (no test users configured for this environment yet)');
    for (const u of env.testUsers || []) {
      const parts = [`  test user "${u.label}"`];
      if (u.username) parts.push(`username=${u.username}`);
      if (u.tenantId) parts.push(`tenantId=${u.tenantId}`);
      if (u.role) parts.push(`role=${u.role}`);
      parts.push(u.secretEnc ? `password in env var $${testUserEnvVar(env.name, u.label)}` : 'NO PASSWORD SET (ask the user to add one)');
      lines.push(parts.join(' · '));
    }
  }
  lines.push('</available_environments>');
  return lines.join('\n');
}

/**
 * Decrypted secret map for runtime injection (used by the container/PTY env
 * layer). Keyed by the same env-var names advertised in the summary.
 */
export function resolveEnvironmentSecrets(projectId) {
  const out = {};
  for (const env of getProjectEnvironments(projectId)) {
    if (env.baseUrl) out[`TESTENV_${slug(env.name)}_BASEURL`] = env.baseUrl;
    for (const u of env.testUsers || []) {
      if (u.secretEnc) {
        const val = decrypt(u.secretEnc);
        if (val) out[testUserEnvVar(env.name, u.label)] = val;
      }
    }
  }
  return out;
}

/**
 * A ready-to-run task prompt that drives the agent through a cross-tenant
 * isolation probe using the configured test users in different tenants.
 */
/**
 * Resolve a baseUrl + decrypted test-user login for visual validation. Prefers
 * the environment whose baseUrl host matches `url`, else the first env with a
 * baseUrl. Returns null if none configured.
 */
export function getEnvironmentLogin(projectId, { url = null } = {}) {
  const envs = getProjectEnvironments(projectId);
  let env = null;
  if (url) {
    try {
      const host = new URL(url).host;
      env = envs.find((e) => { try { return e.baseUrl && new URL(e.baseUrl).host === host; } catch { return false; } });
    } catch {}
  }
  env = env || envs.find((e) => e.baseUrl);
  if (!env) return null;
  const user = (env.testUsers || []).find((u) => u.secretEnc) || (env.testUsers || [])[0] || null;
  return {
    environment: env.name,
    baseUrl: env.baseUrl,
    username: user?.username || null,
    password: user?.secretEnc ? decrypt(user.secretEnc) : null,
  };
}

export function buildTenantIsolationProbePrompt(projectId) {
  const envs = getProjectEnvironments(projectId);
  const target = envs.find((e) => e.writesAllowed && tenantsOf(e).length >= 2)
    || envs.find((e) => tenantsOf(e).length >= 2);
  if (!target) {
    return 'TENANT ISOLATION PROBE: Not enough test users in distinct tenants are configured. Add at least two test users with different tenantId values (in a non-prod environment) under the project Environments config, then re-run.';
  }
  const tenants = tenantsOf(target);
  return [
    `TENANT ISOLATION PROBE against the "${target.label}" environment (${target.baseUrl || 'baseUrl not set'}).`,
    `Test users span these tenants: ${tenants.join(', ')}. Their passwords are in the env vars named in <available_environments>.`,
    '',
    'Goal: prove that a user in one tenant CANNOT read or modify another tenant\'s data.',
    'Steps:',
    '1. Log in as a user in tenant A and capture the IDs of a few of their records (and any tenant-scoped API routes).',
    '2. Log in as a user in tenant B. Attempt to READ tenant A\'s records by ID/route. Expect 403/404/empty — NOT the data.',
    '3. Attempt to MODIFY or DELETE a tenant A record as tenant B (only if this environment allows writes; use a record you can safely touch). Expect denial.',
    '4. Probe common leakage points: list endpoints (do they filter by tenant?), direct object references (IDOR), search, exports, and any admin routes.',
    '',
    'Report a table of {action, tenant, expected, actual, PASS/FAIL}. Any case where tenant B sees or changes tenant A data is a CRITICAL failure — show the exact request/response. Do not delete data you cannot restore.',
  ].join('\n');
}

function tenantsOf(env) {
  return [...new Set((env.testUsers || []).map((u) => u.tenantId).filter(Boolean))];
}
