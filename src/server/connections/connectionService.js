import { v4 as uuidv4 } from 'uuid';
import sqliteStore, { getConnection, listConnections, saveConnection, deleteConnection } from '../sqliteStore.js';
import { encrypt, decryptWithResult } from '../fieldEncryption.js';
import { getProvider, listProviders, DANGEROUS_ENV_NAMES, ENV_NAME_RE, RISKY_ENV_NAMES } from './providers.js';
import { validateConnection as runProviderValidation } from './validators.js';
import { redactSecrets } from './redaction.js';

const VALID_STATUSES = new Set([
  'unknown', 'pending', 'validating', 'connected', 'invalid', 'expired',
  'requires_action', 'disconnected', 'validation_failed', 'partially_configured', 'unsupported',
]);

function nowIso() {
  return new Date().toISOString();
}

function maskSecret(value) {
  if (!value) return '';
  const text = String(value);
  if (text.length <= 8) return '••••';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function decryptFields(connection) {
  const fields = {};
  for (const [key, encrypted] of Object.entries(connection.encryptedFields || {})) {
    const result = decryptWithResult(encrypted);
    if (!result.ok) {
      throw Object.assign(new Error('Connection secret could not be decrypted'), { code: 'decrypt_failed' });
    }
    fields[key] = result.value;
  }
  return fields;
}

function safeConnection(connection, { includeFieldDefinitions = false } = {}) {
  const provider = getProvider(connection.providerId);
  const fields = {};
  const fieldDefs = provider?.fields || [];
  const keys = new Set([...fieldDefs.map(field => field.name), ...Object.keys(connection.encryptedFields || {})]);
  for (const key of keys) {
    const result = decryptWithResult(connection.encryptedFields?.[key]);
    fields[key] = {
      present: !!connection.encryptedFields?.[key],
      masked: result.ok && result.value ? maskSecret(result.value) : '',
      ...(includeFieldDefinitions ? { definition: fieldDefs.find(field => field.name === key) || null } : {}),
    };
  }
  return {
    id: connection.id,
    providerId: connection.providerId,
    displayName: connection.displayName,
    scope: connection.scope,
    projectId: connection.projectId,
    kind: connection.kind,
    status: connection.status,
    fields,
    nonSecretConfig: connection.nonSecretConfig || {},
    environment: connection.environment || {},
    validation: connection.validation || {},
    metadata: connection.metadata || {},
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

function normalizeEnvironment(provider, kind, nonSecretConfig, environment = {}) {
  if (provider.id === 'custom_env') {
    const name = String(nonSecretConfig.name || '').trim();
    return { variables: name ? [name] : [], applyTo: environment.applyTo || ['pty', 'shell-proxy', 'agent', 'scheduler'] };
  }
  const variables = (provider.defaultEnvironment?.variables || []).map(variable => variable.name);
  const defaultTargets = [...new Set((provider.defaultEnvironment?.variables || []).flatMap(variable => variable.targets || []))]
    .filter(target => target !== 'container-create');
  return {
    variables,
    applyTo: kind === 'application' ? [] : (environment.applyTo || defaultTargets),
  };
}

function validateInput(provider, payload, existing = null) {
  const errors = [];
  const kind = payload.kind || existing?.kind || provider.kind;
  const scope = payload.scope || existing?.scope || 'workspace';
  const projectId = payload.projectId || existing?.projectId || null;
  const nonSecretConfig = { ...(existing?.nonSecretConfig || {}), ...(payload.nonSecretConfig || {}) };

  if (!provider.supportedKinds.includes(kind)) errors.push(`${provider.name} does not support kind "${kind}"`);
  if (!provider.supportedScopes.includes(scope)) errors.push(`${provider.name} does not support scope "${scope}"`);
  if (scope === 'project' && !projectId) errors.push('projectId is required for project-scoped connections');

  for (const field of provider.fields || []) {
    const hasExisting = !!existing?.encryptedFields?.[field.name];
    const hasIncoming = payload.fields?.[field.name] !== undefined && payload.fields[field.name] !== '';
    if (field.required && !hasExisting && !hasIncoming) errors.push(`${field.label || field.name} is required`);
  }

  if (provider.id === 'custom_env') {
    const name = String(nonSecretConfig.name || '').trim();
    if (!ENV_NAME_RE.test(name)) errors.push('Custom environment variable names must match /^[A-Z_][A-Z0-9_]{1,100}$/');
    if (DANGEROUS_ENV_NAMES.has(name)) errors.push(`${name} is blocked because it can alter shell or container behavior`);
  }

  return { errors, kind, scope, projectId, nonSecretConfig };
}

function connectionEnvVars(connection) {
  if (connection.status === 'disconnected') return [];
  return connection.environment?.variables || [];
}

function assertNoEnvConflicts(candidate) {
  if (candidate.kind !== 'project-runtime') return;
  const candidateVars = connectionEnvVars(candidate);
  if (!candidateVars.length) return;
  const existing = listConnections({ includeDisconnected: false })
    .filter(connection => connection.id !== candidate.id && connection.kind === 'project-runtime');
  for (const connection of existing) {
    const sameEffectiveScope = candidate.scope === connection.scope
      && (candidate.scope !== 'project' || candidate.projectId === connection.projectId);
    if (!sameEffectiveScope) continue;
    const conflict = connectionEnvVars(connection).find(name => candidateVars.includes(name));
    if (conflict) {
      throw Object.assign(new Error(`Environment variable ${conflict} is already provided by ${connection.displayName}`), { code: 'env_conflict' });
    }
  }
}

export const connectionService = {
  listProviders,

  list(filters = {}) {
    return listConnections(filters).map(connection => safeConnection(connection));
  },

  get(id) {
    const connection = getConnection(id);
    return connection ? safeConnection(connection, { includeFieldDefinitions: true }) : null;
  },

  create(payload) {
    const provider = getProvider(payload.providerId);
    if (!provider) throw Object.assign(new Error('Unsupported provider'), { code: 'unsupported_provider' });
    const { errors, kind, scope, projectId, nonSecretConfig } = validateInput(provider, payload);
    if (errors.length) throw Object.assign(new Error(errors.join('; ')), { code: 'validation_failed', details: errors });

    const encryptedFields = {};
    for (const field of provider.fields || []) {
      const value = payload.fields?.[field.name];
      if (value) encryptedFields[field.name] = encrypt(String(value));
    }

    const timestamp = nowIso();
    const connection = {
      id: uuidv4(),
      providerId: provider.id,
      displayName: payload.displayName?.trim() || provider.name,
      scope,
      projectId: scope === 'project' ? projectId : null,
      kind,
      status: payload.validateNow ? 'pending' : 'unknown',
      encryptedFields,
      nonSecretConfig,
      environment: normalizeEnvironment(provider, kind, nonSecretConfig, payload.environment),
      validation: {},
      metadata: { createdAt: timestamp, updatedAt: timestamp, warnings: [] },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const risky = connection.environment.variables.filter(name => RISKY_ENV_NAMES.has(name));
    if (risky.length) connection.metadata.warnings.push(`Review proxy/certificate-related variables: ${risky.join(', ')}`);
    assertNoEnvConflicts(connection);
    const saved = sqliteStore.withTransaction(() => saveConnection(connection));
    return safeConnection(saved);
  },

  update(id, payload) {
    const current = getConnection(id);
    if (!current) return null;
    const provider = getProvider(current.providerId);
    if (!provider) throw Object.assign(new Error('Unsupported provider'), { code: 'unsupported_provider' });
    const { errors, kind, scope, projectId, nonSecretConfig } = validateInput(provider, payload, current);
    if (errors.length) throw Object.assign(new Error(errors.join('; ')), { code: 'validation_failed', details: errors });

    const encryptedFields = { ...(current.encryptedFields || {}) };
    for (const field of provider.fields || []) {
      const value = payload.fields?.[field.name];
      if (value) encryptedFields[field.name] = encrypt(String(value));
    }

    const timestamp = nowIso();
    const next = {
      ...current,
      displayName: payload.displayName?.trim() || current.displayName,
      scope,
      projectId: scope === 'project' ? projectId : null,
      kind,
      status: VALID_STATUSES.has(payload.status) ? payload.status : current.status,
      encryptedFields,
      nonSecretConfig,
      environment: normalizeEnvironment(provider, kind, nonSecretConfig, payload.environment || current.environment),
      metadata: { ...(current.metadata || {}), updatedAt: timestamp },
      updatedAt: timestamp,
    };
    assertNoEnvConflicts(next);
    const saved = sqliteStore.withTransaction(() => saveConnection(next));
    return safeConnection(saved);
  },

  async validate(id) {
    const connection = getConnection(id);
    if (!connection) return null;
    const timestamp = nowIso();
    saveConnection({ ...connection, status: 'validating', updatedAt: timestamp, metadata: { ...(connection.metadata || {}), updatedAt: timestamp } });
    try {
      const fields = decryptFields(connection);
      const result = await runProviderValidation(connection.providerId, fields, connection.nonSecretConfig || {});
      const status = result.ok ? 'connected' : (result.code === 'unsupported' ? 'unsupported' : 'validation_failed');
      const saved = saveConnection({
        ...connection,
        status,
        validation: {
          ...(connection.validation || {}),
          lastValidatedAt: nowIso(),
          ...(result.ok ? { lastSucceededAt: nowIso(), lastErrorCode: null, lastErrorMessage: null } : {
            lastFailedAt: nowIso(),
            lastErrorCode: result.code,
            lastErrorMessage: redactSecrets(result.message || 'Validation failed'),
          }),
        },
        metadata: { ...(connection.metadata || {}), updatedAt: nowIso() },
        updatedAt: nowIso(),
      });
      return safeConnection(saved);
    } catch (error) {
      const saved = saveConnection({
        ...connection,
        status: error.code === 'decrypt_failed' ? 'requires_action' : 'validation_failed',
        validation: {
          ...(connection.validation || {}),
          lastValidatedAt: nowIso(),
          lastFailedAt: nowIso(),
          lastErrorCode: error.code || 'validation_failed',
          lastErrorMessage: redactSecrets(error.message),
        },
        metadata: { ...(connection.metadata || {}), updatedAt: nowIso() },
        updatedAt: nowIso(),
      });
      return safeConnection(saved);
    }
  },

  rotate(id, fields) {
    return this.update(id, { fields, status: 'unknown' });
  },

  disconnect(id) {
    const connection = getConnection(id);
    if (!connection) return null;
    const timestamp = nowIso();
    const saved = saveConnection({
      ...connection,
      status: 'disconnected',
      metadata: { ...(connection.metadata || {}), updatedAt: timestamp, disconnectedAt: timestamp },
      updatedAt: timestamp,
    });
    return safeConnection(saved);
  },

  delete(id) {
    return deleteConnection(id);
  },

  decryptFields,
  safeConnection,
};

export default connectionService;
