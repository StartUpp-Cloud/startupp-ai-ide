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

// Default data structure
const defaultData = {
  projects: [],
  prompts: [],
  globalRules: [],
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
  await db.write();
  console.log("Database initialized at:", dbPath);
}

// Get database instance
export function getDB() {
  return db;
}

export default db;
