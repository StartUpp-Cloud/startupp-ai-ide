import { v4 as uuidv4 } from "uuid";
import db from "../db.js";

export function getAllGlobalRules() {
  return (db.data.globalRules || []).sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
  );
}

export function findGlobalRuleById(id) {
  return (db.data.globalRules || []).find((r) => r.id === id);
}

export async function createGlobalRule({ text, enabled = true }) {
  const now = new Date().toISOString();
  const rule = {
    id: uuidv4(),
    text: text.trim(),
    enabled,
    createdAt: now,
    updatedAt: now,
  };
  if (!db.data.globalRules) db.data.globalRules = [];
  db.data.globalRules.push(rule);
  await db.write();
  return rule;
}

export async function updateGlobalRule(id, updates) {
  const index = (db.data.globalRules || []).findIndex((r) => r.id === id);
  if (index === -1) return null;
  const rule = db.data.globalRules[index];
  const updated = { ...rule, ...updates, updatedAt: new Date().toISOString() };
  db.data.globalRules[index] = updated;
  await db.write();
  return updated;
}

export async function deleteGlobalRule(id) {
  const index = (db.data.globalRules || []).findIndex((r) => r.id === id);
  if (index === -1) return false;
  db.data.globalRules.splice(index, 1);
  await db.write();
  return true;
}

export default {
  getAll: getAllGlobalRules,
  findById: findGlobalRuleById,
  create: createGlobalRule,
  update: updateGlobalRule,
  delete: deleteGlobalRule,
};
