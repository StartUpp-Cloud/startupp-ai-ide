import { SQLITE_PATH, initSqliteStore, loadCompatibilityData } from '../src/server/sqliteStore.js';

initSqliteStore();
const data = loadCompatibilityData();

console.log(`SQLite database ready at ${SQLITE_PATH}`);
console.log(`Projects: ${data.projects.length}`);
console.log(`Prompts: ${data.prompts.length}`);
console.log(`Global rules: ${data.globalRules.length}`);
console.log(`Memories: ${data.memories.length}`);
