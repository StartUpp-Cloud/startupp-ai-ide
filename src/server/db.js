import {
  DEFAULT_DATA,
  SQLITE_PATH,
  initSqliteStore,
  loadCompatibilityData,
  persistCompatibilityData,
} from './sqliteStore.js';

const db = {
  data: ensureDefaults(loadCompatibilityData()),
  async read() {
    this.data = loadCompatibilityData();
  },
  async write() {
    if (!this.data) this.data = loadCompatibilityData();
    persistCompatibilityData(this.data);
  },
};

function ensureDefaults(data) {
  for (const [key, value] of Object.entries(DEFAULT_DATA)) {
    if (data[key] === undefined || data[key] === null) {
      data[key] = Array.isArray(value) ? [] : { ...value };
    }
  }
  if (!data.slackSettings.defaultTool) data.slackSettings.defaultTool = 'claude';
  return data;
}

export async function initDB() {
  initSqliteStore();
  db.data = ensureDefaults(loadCompatibilityData());
  await db.write();
  console.log('SQLite database initialized at:', SQLITE_PATH);
}

export function getDB() {
  if (!db.data) db.data = ensureDefaults(loadCompatibilityData());
  return db;
}

export default db;
