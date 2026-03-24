/**
 * History Model
 * Stores conversation history separately from CLI tool's internal context
 * This persists even when the CLI compacts its context
 */

import { getDB } from '../db.js';
import { v4 as uuidv4 } from 'uuid';

// Ensure history collection exists
export async function initHistoryCollection() {
  const db = getDB();
  if (!db.data.histories) {
    db.data.histories = [];
    await db.write();
  }
}

/**
 * Create a new history record for a session
 */
export async function createHistory(sessionId, projectId) {
  const db = getDB();
  await initHistoryCollection();

  const history = {
    id: uuidv4(),
    sessionId,
    projectId,
    entries: [],
    metadata: {
      cliTool: null,
      startedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      totalTokensEstimate: 0,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.data.histories.push(history);
  await db.write();

  return history;
}

/**
 * Add an entry to history
 */
export async function addHistoryEntry(sessionId, entry) {
  const db = getDB();
  await initHistoryCollection();

  const history = db.data.histories.find(h => h.sessionId === sessionId);
  if (!history) {
    // Create history if it doesn't exist
    const newHistory = await createHistory(sessionId, entry.projectId || null);
    return addHistoryEntry(sessionId, entry);
  }

  const historyEntry = {
    id: uuidv4(),
    role: entry.role, // 'user' | 'assistant' | 'system' | 'tool'
    content: entry.content,
    timestamp: new Date().toISOString(),
    metadata: entry.metadata || {},
  };

  history.entries.push(historyEntry);
  history.metadata.lastActivity = new Date().toISOString();
  history.metadata.totalTokensEstimate += Math.ceil(entry.content.length / 4); // Rough estimate
  history.updatedAt = new Date().toISOString();

  // Keep last 500 entries per session
  if (history.entries.length > 500) {
    history.entries = history.entries.slice(-500);
  }

  await db.write();

  return historyEntry;
}

/**
 * Get history for a session
 */
export function getHistoryBySession(sessionId) {
  const db = getDB();
  if (!db.data.histories) return null;

  return db.data.histories.find(h => h.sessionId === sessionId);
}

/**
 * Get all histories for a project
 */
export function getHistoriesByProject(projectId) {
  const db = getDB();
  if (!db.data.histories) return [];

  return db.data.histories
    .filter(h => h.projectId === projectId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Get all histories
 */
export function getAllHistories() {
  const db = getDB();
  if (!db.data.histories) return [];

  return db.data.histories
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

/**
 * Search history entries
 */
export function searchHistory(query, projectId = null) {
  const db = getDB();
  if (!db.data.histories) return [];

  const lowerQuery = query.toLowerCase();
  const results = [];

  for (const history of db.data.histories) {
    if (projectId && history.projectId !== projectId) continue;

    for (const entry of history.entries) {
      if (entry.content.toLowerCase().includes(lowerQuery)) {
        results.push({
          historyId: history.id,
          sessionId: history.sessionId,
          projectId: history.projectId,
          entry,
        });
      }
    }
  }

  return results.slice(0, 50); // Limit results
}

/**
 * Update history metadata
 */
export async function updateHistoryMetadata(sessionId, metadata) {
  const db = getDB();
  await initHistoryCollection();

  const history = db.data.histories.find(h => h.sessionId === sessionId);
  if (!history) return null;

  history.metadata = { ...history.metadata, ...metadata };
  history.updatedAt = new Date().toISOString();

  await db.write();

  return history;
}

/**
 * Delete history for a session
 */
export async function deleteHistory(sessionId) {
  const db = getDB();
  if (!db.data.histories) return false;

  const index = db.data.histories.findIndex(h => h.sessionId === sessionId);
  if (index === -1) return false;

  db.data.histories.splice(index, 1);
  await db.write();

  return true;
}

/**
 * Get history summary (for display in sidebar)
 */
export function getHistorySummary(sessionId) {
  const history = getHistoryBySession(sessionId);
  if (!history) return null;

  const userMessages = history.entries.filter(e => e.role === 'user');
  const assistantMessages = history.entries.filter(e => e.role === 'assistant');

  return {
    id: history.id,
    sessionId: history.sessionId,
    projectId: history.projectId,
    messageCount: history.entries.length,
    userMessageCount: userMessages.length,
    assistantMessageCount: assistantMessages.length,
    firstMessage: history.entries[0]?.content?.substring(0, 100) || null,
    lastMessage: history.entries[history.entries.length - 1]?.content?.substring(0, 100) || null,
    startedAt: history.metadata.startedAt,
    lastActivity: history.metadata.lastActivity,
    totalTokensEstimate: history.metadata.totalTokensEstimate,
  };
}

export default {
  createHistory,
  addHistoryEntry,
  getHistoryBySession,
  getHistoriesByProject,
  getAllHistories,
  searchHistory,
  updateHistoryMetadata,
  deleteHistory,
  getHistorySummary,
};
