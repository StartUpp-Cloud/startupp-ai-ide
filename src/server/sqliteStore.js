import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '../../data');
export const SQLITE_PATH = path.join(DATA_DIR, 'app.sqlite');
const LEGACY_DB_PATH = path.join(DATA_DIR, 'db.json');
const LEGACY_CHAT_DIR = path.join(DATA_DIR, 'chat');
const LEGACY_JOBS_DIR = path.join(DATA_DIR, 'jobs');

const DEFAULT_SAFETY_SETTINGS = {
  maxStepsPerPlan: 50,
  maxExecutionTime: 3600000,
  maxConcurrentExecutions: 1,
  scopeRestriction: 'project',
  autoCommitBeforeRiskyOps: true,
  blockCriticalRisk: true,
  pauseOnHighRisk: true,
  allowedPaths: [],
  blockedCommands: [],
};

export const DEFAULT_DATA = {
  projects: [],
  prompts: [],
  globalRules: [],
  memories: [],
  activities: [],
  taskQueue: [],
  orchestratorExecutions: [],
  schedules: [],
  skills: [],
  sessionHistory: [],
  slackSettings: { enabled: false, botToken: '', appToken: '', channelMap: {}, defaultTool: 'claude' },
  safetySettings: { ...DEFAULT_SAFETY_SETTINGS },
  profile: {
    name: '',
    role: '',
    tone: 'concise',
    preferences: '',
    codeStyle: '',
    languages: '',
    setupComplete: false,
  },
};

const KV_KEYS = [
  'activities',
  'taskQueue',
  'orchestratorExecutions',
  'schedules',
  'skills',
  'sessionHistory',
  'slackSettings',
  'safetySettings',
  'profile',
  'llmSettings',
  'autoResponder',
];

let db = null;

function nowIso() {
  return new Date().toISOString();
}

function jsonStringify(value) {
  return JSON.stringify(value ?? null);
}

function jsonParse(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function boolToInt(value) {
  return value ? 1 : 0;
}

function rowToBool(value) {
  return value === 1 || value === true;
}

function tableHasRows(table) {
  getSqliteStore();
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
  return (row?.count || 0) > 0;
}

function withTransaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function ftsQueryFromText(text) {
  const words = String(text || '')
    .toLowerCase()
    .match(/[a-z0-9_]{3,}/g);
  if (!words?.length) return '';
  return [...new Set(words)]
    .slice(0, 12)
    .map(word => word.replace(/[^a-z0-9_]/g, ''))
    .filter(Boolean)
    .map(word => `"${word.replace(/"/g, '""')}"*`)
    .join(' OR ');
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  } else {
    try { fs.chmodSync(DATA_DIR, 0o700); } catch {}
  }
}

function createSchema() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      container_name TEXT,
      folder_path TEXT,
      created_at TEXT,
      updated_at TEXT,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_projects_container ON projects(container_name);

    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      text TEXT,
      prompt_type TEXT,
      created_at TEXT,
      updated_at TEXT,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prompts_project ON prompts(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS global_rules (
      id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      usage_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      related_files TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_memories_project_score ON memories(project_id, confidence DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memories_project_category ON memories(project_id, category, type);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      memory_id UNINDEXED,
      project_id UNINDEXED,
      content,
      tags,
      related_files
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      manual_name INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      has_unread INTEGER NOT NULL DEFAULT 0,
      unread_since TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_project ON chat_sessions(project_id, archived, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_unread ON chat_sessions(project_id, has_unread);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created ON chat_messages(project_id, session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_project_created ON chat_messages(project_id, created_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS chat_messages_fts USING fts5(
      message_id UNINDEXED,
      project_id UNINDEXED,
      session_id UNINDEXED,
      content
    );

    CREATE TABLE IF NOT EXISTS chat_chunks (
      message_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(message_id, chunk_index)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_chunks_project_message ON chat_chunks(project_id, message_id, chunk_index);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      session_id TEXT,
      message_id TEXT,
      tool TEXT,
      prompt TEXT,
      status TEXT,
      created_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      last_activity_at TEXT,
      cli_session_id TEXT,
      shell_session_id TEXT,
      output_bytes INTEGER DEFAULT 0,
      result TEXT,
      error TEXT,
      progress TEXT,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_session ON jobs(project_id, session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS orchestrator_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      parent_message_id TEXT,
      status TEXT NOT NULL,
      phase TEXT,
      goal TEXT NOT NULL,
      tool TEXT,
      model TEXT,
      effort TEXT,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      final_response TEXT,
      error TEXT,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orchestrator_runs_session ON orchestrator_runs(project_id, session_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_runs_status ON orchestrator_runs(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS orchestrator_tasks (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      agent_session_id TEXT,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      task_type TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      started_at TEXT,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      result TEXT,
      error TEXT,
      retryable INTEGER NOT NULL DEFAULT 1,
      data TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES orchestrator_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_orchestrator_tasks_run ON orchestrator_tasks(run_id, updated_at ASC);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_tasks_status ON orchestrator_tasks(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS orchestrator_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      task_id TEXT,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES orchestrator_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_orchestrator_events_run ON orchestrator_events(run_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('workspace', 'project')),
      project_id TEXT,
      kind TEXT NOT NULL CHECK(kind IN ('application', 'project-runtime', 'cli-managed', 'local')),
      status TEXT NOT NULL,
      encrypted_fields TEXT NOT NULL DEFAULT '{}',
      non_secret_config TEXT NOT NULL DEFAULT '{}',
      environment TEXT NOT NULL DEFAULT '{}',
      validation TEXT NOT NULL DEFAULT '{}',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      user_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_connections_provider ON connections(provider_id);
    CREATE INDEX IF NOT EXISTS idx_connections_scope_project ON connections(scope, project_id);
    CREATE INDEX IF NOT EXISTS idx_connections_kind ON connections(kind);
    CREATE INDEX IF NOT EXISTS idx_connections_status ON connections(status);
  `);
}

function upsertJsonTable(table, row) {
  getSqliteStore();
  if (!row?.id) return;
  const createdAt = row.createdAt || row.created_at || nowIso();
  const updatedAt = row.updatedAt || row.updated_at || createdAt;

  if (table === 'projects') {
    db.prepare(`INSERT OR REPLACE INTO projects (id, name, description, container_name, folder_path, created_at, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      row.id,
      row.name || '',
      row.description || '',
      row.containerName || null,
      row.folderPath || null,
      createdAt,
      updatedAt,
      jsonStringify(row),
    );
    return;
  }

  if (table === 'prompts') {
    db.prepare(`INSERT OR REPLACE INTO prompts (id, project_id, text, prompt_type, created_at, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      row.id,
      row.projectId || null,
      row.text || '',
      row.promptType || row.prompt_type || null,
      createdAt,
      updatedAt,
      jsonStringify(row),
    );
    return;
  }

  if (table === 'global_rules') {
    db.prepare(`INSERT OR REPLACE INTO global_rules (id, enabled, created_at, updated_at, data)
      VALUES (?, ?, ?, ?, ?)`).run(
      row.id,
      row.enabled === false ? 0 : 1,
      createdAt,
      updatedAt,
      jsonStringify(row),
    );
  }
}

function loadJsonTable(table) {
  return db.prepare(`SELECT data FROM ${table}`).all().map(row => jsonParse(row.data, null)).filter(Boolean);
}

function setKv(key, value) {
  getSqliteStore();
  db.prepare(`INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)`).run(
    key,
    jsonStringify(value),
    nowIso(),
  );
}

function getKv(key, fallback = null) {
  getSqliteStore();
  const row = db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key);
  return row ? jsonParse(row.value, fallback) : fallback;
}

function normalizeMemory(memory) {
  const createdAt = memory.createdAt || memory.created_at || nowIso();
  return {
    id: memory.id || uuidv4(),
    projectId: memory.projectId || memory.project_id,
    type: memory.type || 'pattern',
    category: memory.category || 'architecture',
    content: String(memory.content || '').trim(),
    source: memory.source || 'auto-detected',
    confidence: Number.isFinite(memory.confidence) ? memory.confidence : 0.5,
    usageCount: Number.isFinite(memory.usageCount) ? memory.usageCount : (memory.usage_count || 0),
    lastUsedAt: memory.lastUsedAt || memory.last_used_at || null,
    createdAt,
    updatedAt: memory.updatedAt || memory.updated_at || createdAt,
    tags: Array.isArray(memory.tags) ? memory.tags : [],
    relatedFiles: Array.isArray(memory.relatedFiles) ? memory.relatedFiles : [],
  };
}

export function saveMemory(memory) {
  getSqliteStore();
  const m = normalizeMemory(memory);
  if (!m.projectId || !m.content) return null;

  db.prepare(`INSERT OR REPLACE INTO memories (
    id, project_id, type, category, content, source, confidence, usage_count, last_used_at,
    created_at, updated_at, tags, related_files
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    m.id,
    m.projectId,
    m.type,
    m.category,
    m.content,
    m.source,
    m.confidence,
    m.usageCount,
    m.lastUsedAt,
    m.createdAt,
    m.updatedAt,
    jsonStringify(m.tags),
    jsonStringify(m.relatedFiles),
  );

  db.prepare('DELETE FROM memories_fts WHERE memory_id = ?').run(m.id);
  db.prepare('INSERT INTO memories_fts (memory_id, project_id, content, tags, related_files) VALUES (?, ?, ?, ?, ?)').run(
    m.id,
    m.projectId,
    m.content,
    m.tags.join(' '),
    m.relatedFiles.join(' '),
  );
  return m;
}

function rowToMemory(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    category: row.category,
    content: row.content,
    source: row.source,
    confidence: row.confidence,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tags: jsonParse(row.tags, []),
    relatedFiles: jsonParse(row.related_files, []),
  };
}

function normalizeSession(session, projectId, archived = false) {
  const createdAt = session.createdAt || session.created_at || nowIso();
  const hasArchived = Object.prototype.hasOwnProperty.call(session, 'archived');
  const toolSessions = session.toolSessions
    || (session.cliSessionId && session.tool
      ? { [session.tool]: { cliSessionId: session.cliSessionId, updatedAt: session.updatedAt || createdAt } }
      : undefined);
  return {
    ...session,
    id: session.id || uuidv4(),
    projectId: session.projectId || session.project_id || projectId,
    name: session.name || `Chat ${new Date(createdAt).toLocaleDateString()}`,
    createdAt,
    updatedAt: session.updatedAt || session.updated_at || createdAt,
    messageCount: Number.isFinite(session.messageCount) ? session.messageCount : (session.message_count || 0),
    manualName: !!(session.manualName || session.manual_name),
    pinned: !!session.pinned,
    hasUnread: !!(session.hasUnread || session.has_unread),
    unreadSince: session.unreadSince || session.unread_since || null,
    archived: hasArchived ? !!session.archived : !!archived,
    ...(toolSessions ? { toolSessions, cliSessionTool: session.cliSessionTool || session.tool } : {}),
  };
}

export function saveChatSession(session, projectId, { archived = false } = {}) {
  getSqliteStore();
  const s = normalizeSession(session, projectId, archived);
  if (!s.projectId) return null;
  db.prepare(`INSERT INTO chat_sessions (
    id, project_id, name, created_at, updated_at, message_count, manual_name,
    pinned, has_unread, unread_since, archived, data
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    project_id = excluded.project_id,
    name = excluded.name,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    message_count = excluded.message_count,
    manual_name = excluded.manual_name,
    pinned = excluded.pinned,
    has_unread = excluded.has_unread,
    unread_since = excluded.unread_since,
    archived = excluded.archived,
    data = excluded.data`).run(
    s.id,
    s.projectId,
    s.name,
    s.createdAt,
    s.updatedAt,
    s.messageCount || 0,
    boolToInt(s.manualName),
    boolToInt(s.pinned),
    boolToInt(s.hasUnread),
    s.unreadSince || null,
    boolToInt(s.archived),
    jsonStringify(s),
  );
  return s;
}

export function rowToSession(row) {
  if (!row) return null;
  const data = jsonParse(row.data, {});
  const session = {
    ...data,
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
    manualName: rowToBool(row.manual_name),
    pinned: rowToBool(row.pinned),
    hasUnread: rowToBool(row.has_unread),
    unreadSince: row.unread_since || undefined,
    archived: rowToBool(row.archived),
  };
  if (session.cliSessionId && session.tool && !session.toolSessions) {
    session.toolSessions = {
      [session.tool]: { cliSessionId: session.cliSessionId, updatedAt: session.updatedAt || session.createdAt },
    };
    session.cliSessionTool = session.cliSessionTool || session.tool;
  }
  return session;
}

export function saveChatMessage(message) {
  getSqliteStore();
  if (!message?.id || !message.projectId || !message.sessionId) return null;
  db.prepare(`INSERT OR REPLACE INTO chat_messages (id, project_id, session_id, role, content, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    message.id,
    message.projectId,
    message.sessionId,
    message.role,
    String(message.content || ''),
    message.metadata == null ? null : jsonStringify(message.metadata),
    message.createdAt || nowIso(),
  );
  db.prepare('DELETE FROM chat_messages_fts WHERE message_id = ?').run(message.id);
  if (message.content) {
    db.prepare('INSERT INTO chat_messages_fts (message_id, project_id, session_id, content) VALUES (?, ?, ?, ?)').run(
      message.id,
      message.projectId,
      message.sessionId,
      String(message.content),
    );
  }
  return message;
}

export function rowToMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    metadata: jsonParse(row.metadata, null),
    createdAt: row.created_at,
  };
}

function normalizeJob(job) {
  const createdAt = job.createdAt || job.created_at || nowIso();
  return {
    ...job,
    id: job.id || uuidv4(),
    projectId: job.projectId || job.project_id || null,
    sessionId: job.sessionId || job.session_id || null,
    messageId: job.messageId || job.message_id || null,
    createdAt,
    startedAt: job.startedAt || job.started_at || null,
    completedAt: job.completedAt || job.completed_at || null,
    lastActivityAt: job.lastActivityAt || job.last_activity_at || null,
    cliSessionId: job.cliSessionId || job.cli_session_id || null,
    shellSessionId: job.shellSessionId || job.shell_session_id || null,
    outputBytes: Number.isFinite(job.outputBytes) ? job.outputBytes : (job.output_bytes || 0),
  };
}

export function saveJob(job) {
  getSqliteStore();
  const j = normalizeJob(job);
  db.prepare(`INSERT OR REPLACE INTO jobs (
    id, project_id, session_id, message_id, tool, prompt, status, created_at, started_at,
    completed_at, last_activity_at, cli_session_id, shell_session_id, output_bytes,
    result, error, progress, data
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    j.id,
    j.projectId,
    j.sessionId,
    j.messageId,
    j.tool || null,
    j.prompt || null,
    j.status || 'pending',
    j.createdAt,
    j.startedAt,
    j.completedAt,
    j.lastActivityAt,
    j.cliSessionId,
    j.shellSessionId,
    j.outputBytes || 0,
    j.result || null,
    j.error || null,
    j.progress == null ? null : jsonStringify(j.progress),
    jsonStringify(j),
  );
  return j;
}

export function rowToJob(row) {
  if (!row) return null;
  const data = jsonParse(row.data, {});
  return {
    ...data,
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    messageId: row.message_id,
    tool: row.tool,
    prompt: row.prompt,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    lastActivityAt: row.last_activity_at,
    cliSessionId: row.cli_session_id,
    shellSessionId: row.shell_session_id,
    outputBytes: row.output_bytes,
    result: row.result,
    error: row.error,
    progress: jsonParse(row.progress, null),
  };
}

function normalizeConnection(connection) {
  const now = nowIso();
  const createdAt = connection.createdAt || connection.created_at || connection.metadata?.createdAt || now;
  const updatedAt = connection.updatedAt || connection.updated_at || connection.metadata?.updatedAt || createdAt;
  return {
    id: connection.id || uuidv4(),
    providerId: connection.providerId || connection.provider_id,
    displayName: connection.displayName || connection.display_name || connection.providerId || connection.provider_id,
    scope: connection.scope === 'project' ? 'project' : 'workspace',
    projectId: connection.projectId || connection.project_id || null,
    kind: connection.kind || 'project-runtime',
    status: connection.status || 'unknown',
    encryptedFields: connection.encryptedFields || connection.encrypted_fields || {},
    nonSecretConfig: connection.nonSecretConfig || connection.non_secret_config || {},
    environment: connection.environment || {},
    validation: connection.validation || {},
    metadata: {
      ...(connection.metadata || {}),
      createdAt,
      updatedAt,
    },
    createdBy: connection.createdBy || connection.created_by || null,
    updatedBy: connection.updatedBy || connection.updated_by || null,
    userId: connection.userId || connection.user_id || null,
    createdAt,
    updatedAt,
  };
}

export function rowToConnection(row) {
  if (!row) return null;
  const metadata = jsonParse(row.metadata, {});
  return {
    id: row.id,
    providerId: row.provider_id,
    displayName: row.display_name,
    scope: row.scope,
    projectId: row.project_id,
    kind: row.kind,
    status: row.status,
    encryptedFields: jsonParse(row.encrypted_fields, {}),
    nonSecretConfig: jsonParse(row.non_secret_config, {}),
    environment: jsonParse(row.environment, {}),
    validation: jsonParse(row.validation, {}),
    metadata,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function saveConnection(connection) {
  getSqliteStore();
  const c = normalizeConnection(connection);
  db.prepare(`INSERT INTO connections (
    id, provider_id, display_name, scope, project_id, kind, status,
    encrypted_fields, non_secret_config, environment, validation, metadata,
    created_at, updated_at, created_by, updated_by, user_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    provider_id = excluded.provider_id,
    display_name = excluded.display_name,
    scope = excluded.scope,
    project_id = excluded.project_id,
    kind = excluded.kind,
    status = excluded.status,
    encrypted_fields = excluded.encrypted_fields,
    non_secret_config = excluded.non_secret_config,
    environment = excluded.environment,
    validation = excluded.validation,
    metadata = excluded.metadata,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by,
    user_id = excluded.user_id`).run(
    c.id,
    c.providerId,
    c.displayName,
    c.scope,
    c.projectId,
    c.kind,
    c.status,
    jsonStringify(c.encryptedFields),
    jsonStringify(c.nonSecretConfig),
    jsonStringify(c.environment),
    jsonStringify(c.validation),
    jsonStringify(c.metadata),
    c.createdAt,
    c.updatedAt,
    c.createdBy,
    c.updatedBy,
    c.userId,
  );
  return c;
}

export function getConnection(id) {
  getSqliteStore();
  return rowToConnection(db.prepare('SELECT * FROM connections WHERE id = ?').get(id));
}

export function listConnections({ projectId = null, includeDisconnected = true } = {}) {
  getSqliteStore();
  const rows = projectId
    ? db.prepare('SELECT * FROM connections WHERE scope = ? OR project_id = ? ORDER BY updated_at DESC').all('workspace', projectId)
    : db.prepare('SELECT * FROM connections ORDER BY updated_at DESC').all();
  return rows
    .map(rowToConnection)
    .filter(Boolean)
    .filter(connection => includeDisconnected || connection.status !== 'disconnected');
}

export function deleteConnection(id) {
  getSqliteStore();
  const result = db.prepare('DELETE FROM connections WHERE id = ?').run(id);
  return result.changes > 0;
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return fallback; }
}

function migrateLegacyDbJson() {
  const legacy = readJsonFile(LEGACY_DB_PATH, null);
  if (!legacy) return;

  withTransaction(() => {
    for (const project of legacy.projects || []) upsertJsonTable('projects', project);
    for (const prompt of legacy.prompts || []) upsertJsonTable('prompts', prompt);
    for (const rule of legacy.globalRules || []) upsertJsonTable('global_rules', rule);
    for (const memory of legacy.memories || []) saveMemory(memory);

    for (const key of KV_KEYS) {
      if (legacy[key] !== undefined) setKv(key, legacy[key]);
      else if (DEFAULT_DATA[key] !== undefined && getKv(key, undefined) === undefined) setKv(key, DEFAULT_DATA[key]);
    }
  });
}

function migrateLegacyChat() {
  if (!fs.existsSync(LEGACY_CHAT_DIR)) return;

  withTransaction(() => {
    const entries = fs.readdirSync(LEGACY_CHAT_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const projectId = entry.name;
        const projectDir = path.join(LEGACY_CHAT_DIR, projectId);
        const activeSessions = readJsonFile(path.join(projectDir, '_sessions.json'), []);
        const archivedSessions = readJsonFile(path.join(projectDir, '_sessions_archive.json'), []);

        for (const session of activeSessions) saveChatSession(session, projectId, { archived: false });
        for (const session of archivedSessions) saveChatSession(session, projectId, { archived: true });

        const files = fs.readdirSync(projectDir, { withFileTypes: true });
        for (const file of files) {
          if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
          const sessionId = path.basename(file.name, '.jsonl');
          if (!db.prepare('SELECT id FROM chat_sessions WHERE id = ?').get(sessionId)) {
            saveChatSession({ id: sessionId, name: 'Migrated Chat' }, projectId);
          }
          const lines = fs.readFileSync(path.join(projectDir, file.name), 'utf-8').split('\n');
          let count = 0;
          for (const line of lines) {
            if (!line.trim()) continue;
            const msg = jsonParse(line, null);
            if (!msg?.id) continue;
            msg.projectId = msg.projectId || projectId;
            msg.sessionId = msg.sessionId || sessionId;
            saveChatMessage(msg);
            count++;
          }
          db.prepare('UPDATE chat_sessions SET message_count = MAX(message_count, ?), updated_at = ? WHERE id = ?').run(count, nowIso(), sessionId);
        }

        const chunksDir = path.join(projectDir, '_chunks');
        if (fs.existsSync(chunksDir)) {
          for (const chunkFile of fs.readdirSync(chunksDir)) {
            if (!chunkFile.endsWith('.chunks')) continue;
            const messageId = path.basename(chunkFile, '.chunks');
            const lines = fs.readFileSync(path.join(chunksDir, chunkFile), 'utf-8').split('\n');
            for (const line of lines) {
              const chunk = jsonParse(line, null);
              if (!chunk) continue;
              db.prepare(`INSERT OR REPLACE INTO chat_chunks (message_id, project_id, chunk_index, content, created_at)
                VALUES (?, ?, ?, ?, ?)`).run(messageId, projectId, chunk.index || 0, chunk.content || '', chunk.timestamp || nowIso());
            }
          }
        }
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const projectId = path.basename(entry.name, '.jsonl');
        const session = saveChatSession({ name: 'Migrated Chat' }, projectId);
        const lines = fs.readFileSync(path.join(LEGACY_CHAT_DIR, entry.name), 'utf-8').split('\n');
        let count = 0;
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = jsonParse(line, null);
          if (!msg?.id) continue;
          msg.projectId = msg.projectId || projectId;
          msg.sessionId = msg.sessionId || session.id;
          saveChatMessage(msg);
          count++;
        }
        db.prepare('UPDATE chat_sessions SET message_count = ? WHERE id = ?').run(count, session.id);
      }
    }
  });
}

function migrateLegacyJobs() {
  if (!fs.existsSync(LEGACY_JOBS_DIR)) return;
  withTransaction(() => {
    for (const file of fs.readdirSync(LEGACY_JOBS_DIR)) {
      if (!file.endsWith('.json')) continue;
      const job = readJsonFile(path.join(LEGACY_JOBS_DIR, file), null);
      if (job?.id) saveJob(job);
    }
  });
}

export function initSqliteStore() {
  if (db) return db;
  ensureDataDir();
  db = new DatabaseSync(SQLITE_PATH);
  createSchema();

  const migrationComplete = getKv('migration.legacyComplete', false);
  if (!migrationComplete) {
    console.log('[sqlite] Migrating legacy JSON/chat/job data into SQLite...');
    migrateLegacyDbJson();
    migrateLegacyChat();
    migrateLegacyJobs();
    setKv('migration.legacyComplete', true);
    setKv('migration.legacyCompletedAt', nowIso());
    console.log(`[sqlite] Migration complete: ${SQLITE_PATH}`);
  }

  return db;
}

export function getSqliteStore() {
  if (!db) return initSqliteStore();
  return db;
}

export function loadCompatibilityData() {
  getSqliteStore();
  const data = JSON.parse(JSON.stringify(DEFAULT_DATA));
  data.projects = loadJsonTable('projects').sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  data.prompts = loadJsonTable('prompts');
  data.globalRules = loadJsonTable('global_rules');
  data.memories = db.prepare('SELECT * FROM memories').all().map(rowToMemory);

  for (const key of KV_KEYS) {
    const fallback = data[key] ?? (Array.isArray(DEFAULT_DATA[key]) ? [] : {});
    data[key] = getKv(key, fallback);
  }

  return data;
}

export function persistCompatibilityData(data) {
  getSqliteStore();
  withTransaction(() => {
    db.prepare('DELETE FROM projects').run();
    db.prepare('DELETE FROM prompts').run();
    db.prepare('DELETE FROM global_rules').run();
    for (const project of data.projects || []) upsertJsonTable('projects', project);
    for (const prompt of data.prompts || []) upsertJsonTable('prompts', prompt);
    for (const rule of data.globalRules || []) upsertJsonTable('global_rules', rule);
    for (const key of KV_KEYS) {
      if (data[key] !== undefined) setKv(key, data[key]);
    }
  });
}

export function putProject(project) { upsertJsonTable('projects', project); }
export function putPrompt(prompt) { upsertJsonTable('prompts', prompt); }
export function putGlobalRule(rule) { upsertJsonTable('global_rules', rule); }
export function getKvValue(key, fallback = null) { return getKv(key, fallback); }
export function setKvValue(key, value) { return setKv(key, value); }

export const sqliteStore = {
  init: initSqliteStore,
  get db() { return getSqliteStore(); },
  loadCompatibilityData,
  persistCompatibilityData,
  saveMemory,
  rowToMemory,
  saveChatSession,
  rowToSession,
  saveChatMessage,
  rowToMessage,
  saveJob,
  rowToJob,
  saveConnection,
  rowToConnection,
  getConnection,
  listConnections,
  deleteConnection,
  ftsQueryFromText,
  withTransaction,
  getKv: getKvValue,
  setKv: setKvValue,
  tableHasRows,
};

export default sqliteStore;
