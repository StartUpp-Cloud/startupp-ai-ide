import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data directory at project root
const dataDir = path.join(__dirname, "../../data");

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "db.json");

// Default safety settings
const defaultSafetySettings = {
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

// Default data structure
const defaultData = {
  projects: [],
  prompts: [],
  globalRules: [],
  memories: [],
  activities: [],
  taskQueue: [],
  orchestratorExecutions: [],
  safetySettings: { ...defaultSafetySettings },
};

// Initialize LowDB with JSON file adapter
const adapter = new JSONFile(dbPath);
const db = new Low(adapter, defaultData);

// Initialize database
export async function initDB() {
  await db.read();
  // If file was empty or didn't exist, set defaults
  if (!db.data) {
    db.data = defaultData;
    await db.write();
  }
  // Ensure all collections exist
  if (!db.data.projects) db.data.projects = [];
  if (!db.data.prompts) db.data.prompts = [];
  if (!db.data.globalRules) db.data.globalRules = [];
  if (!db.data.memories) db.data.memories = [];
  if (!db.data.activities) db.data.activities = [];
  if (!db.data.taskQueue) db.data.taskQueue = [];
  if (!db.data.orchestratorExecutions) db.data.orchestratorExecutions = [];
  if (!db.data.safetySettings) db.data.safetySettings = { ...defaultSafetySettings };
  await db.write();
  console.log("Database initialized at:", dbPath);
}

// Get database instance
export function getDB() {
  return db;
}

export default db;
