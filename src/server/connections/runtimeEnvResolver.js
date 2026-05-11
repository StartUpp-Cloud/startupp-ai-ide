import { listConnections, saveConnection } from '../sqliteStore.js';
import { getProvider } from './providers.js';
import { connectionService } from './connectionService.js';

const TARGET_ALIASES = {
  agent: 'agent',
  pty: 'pty',
  'shell-proxy': 'shell-proxy',
  scheduler: 'scheduler',
  'container-create': 'container-create',
};

function nowIso() {
  return new Date().toISOString();
}

function appliesTo(connection, target) {
  const applyTo = connection.environment?.applyTo || [];
  return applyTo.includes(target) || (target === 'agent' && applyTo.includes('pty'));
}

function sourceMappings(provider, connection) {
  if (provider.id === 'custom_env') {
    const name = String(connection.nonSecretConfig?.name || '').trim();
    return name ? [{ name, sourceField: 'value' }] : [];
  }
  return provider.defaultEnvironment?.variables || [];
}

function precedence(connection) {
  return connection.scope === 'project' ? 2 : 1;
}

export function resolveRuntimeEnvironment({ projectId = null, target = 'pty' } = {}) {
  const normalizedTarget = TARGET_ALIASES[target] || target;
  const candidates = listConnections({ projectId, includeDisconnected: false })
    .filter(connection => connection.kind === 'project-runtime')
    .filter(connection => ['connected', 'unknown'].includes(connection.status))
    .filter(connection => connection.scope === 'workspace' || connection.projectId === projectId)
    .filter(connection => appliesTo(connection, normalizedTarget));

  const resolved = new Map();
  const usedConnections = new Map();
  const warnings = [];

  for (const connection of candidates) {
    const provider = getProvider(connection.providerId);
    if (!provider) continue;
    let fields;
    try {
      fields = connectionService.decryptFields(connection);
    } catch {
      warnings.push(`Connection ${connection.displayName} requires action before credentials can be used.`);
      continue;
    }
    for (const mapping of sourceMappings(provider, connection)) {
      if (!mapping.name || !fields[mapping.sourceField]) continue;
      const current = resolved.get(mapping.name);
      if (!current || precedence(connection) >= precedence(current.connection)) {
        resolved.set(mapping.name, { value: fields[mapping.sourceField], connection });
        usedConnections.set(connection.id, connection);
      }
    }
  }

  const env = {};
  const redactedEnv = {};
  for (const [key, entry] of resolved) {
    env[key] = entry.value;
    redactedEnv[key] = '[REDACTED]';
  }

  const timestamp = nowIso();
  for (const connection of usedConnections.values()) {
    try {
      saveConnection({
        ...connection,
        metadata: { ...(connection.metadata || {}), lastUsedAt: timestamp, updatedAt: connection.updatedAt },
      });
    } catch {}
  }

  return { env, redactedEnv, warnings };
}

export function dockerEnvFlags(env, quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`) {
  return Object.entries(env || {})
    .filter(([key, value]) => key && value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `-e ${quote(`${key}=${value}`)}`)
    .join(' ');
}
