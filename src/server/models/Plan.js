/**
 * Plan Model
 * Stores extracted plans and todos from AI conversations
 */

import { getDB } from '../db.js';
import { v4 as uuidv4 } from 'uuid';

// Ensure plans collection exists
export async function initPlansCollection() {
  const db = getDB();
  if (!db.data.plans) {
    db.data.plans = [];
    await db.write();
  }
}

/**
 * Create a new plan
 */
export async function createPlan(data) {
  const db = getDB();
  await initPlansCollection();

  const plan = {
    id: uuidv4(),
    projectId: data.projectId || null,
    sessionId: data.sessionId || null,
    title: data.title || 'Untitled Plan',
    description: data.description || '',
    items: data.items || [],
    status: 'active', // active | completed | archived
    extractedFrom: data.extractedFrom || null, // Reference to conversation that generated it
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.data.plans.push(plan);
  await db.write();

  return plan;
}

/**
 * Add item to a plan
 */
export async function addPlanItem(planId, item) {
  const db = getDB();
  await initPlansCollection();

  const plan = db.data.plans.find(p => p.id === planId);
  if (!plan) return null;

  const planItem = {
    id: uuidv4(),
    description: item.description,
    status: item.status || 'pending', // pending | in_progress | completed | skipped
    priority: item.priority || 'normal', // low | normal | high | critical
    notes: item.notes || '',
    createdAt: new Date().toISOString(),
    completedAt: null,
  };

  plan.items.push(planItem);
  plan.updatedAt = new Date().toISOString();

  await db.write();

  return planItem;
}

/**
 * Update plan item status
 */
export async function updatePlanItem(planId, itemId, updates) {
  const db = getDB();
  await initPlansCollection();

  const plan = db.data.plans.find(p => p.id === planId);
  if (!plan) return null;

  const item = plan.items.find(i => i.id === itemId);
  if (!item) return null;

  Object.assign(item, updates);

  if (updates.status === 'completed') {
    item.completedAt = new Date().toISOString();
  }

  plan.updatedAt = new Date().toISOString();

  // Check if all items are completed
  const allCompleted = plan.items.every(i =>
    i.status === 'completed' || i.status === 'skipped'
  );
  if (allCompleted && plan.items.length > 0) {
    plan.status = 'completed';
  }

  await db.write();

  return item;
}

/**
 * Get plan by ID
 */
export function getPlanById(planId) {
  const db = getDB();
  if (!db.data.plans) return null;

  return db.data.plans.find(p => p.id === planId);
}

/**
 * Get plans for a project
 */
export function getPlansByProject(projectId) {
  const db = getDB();
  if (!db.data.plans) return [];

  return db.data.plans
    .filter(p => p.projectId === projectId)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

/**
 * Get plans for a session
 */
export function getPlansBySession(sessionId) {
  const db = getDB();
  if (!db.data.plans) return [];

  return db.data.plans
    .filter(p => p.sessionId === sessionId)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

/**
 * Get all active plans
 */
export function getActivePlans() {
  const db = getDB();
  if (!db.data.plans) return [];

  return db.data.plans
    .filter(p => p.status === 'active')
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

/**
 * Update plan
 */
export async function updatePlan(planId, updates) {
  const db = getDB();
  await initPlansCollection();

  const plan = db.data.plans.find(p => p.id === planId);
  if (!plan) return null;

  Object.assign(plan, updates, { updatedAt: new Date().toISOString() });

  await db.write();

  return plan;
}

/**
 * Delete plan
 */
export async function deletePlan(planId) {
  const db = getDB();
  if (!db.data.plans) return false;

  const index = db.data.plans.findIndex(p => p.id === planId);
  if (index === -1) return false;

  db.data.plans.splice(index, 1);
  await db.write();

  return true;
}

/**
 * Extract plans from text (AI response)
 * Looks for common patterns like:
 * - Numbered lists (1. 2. 3.)
 * - Bullet points (- * •)
 * - TODO markers
 * - Step markers (Step 1, Phase 1)
 */
export function extractPlansFromText(text, options = {}) {
  const { projectId, sessionId } = options;
  const plans = [];

  // Pattern for detecting plan-like structures
  const patterns = [
    // Numbered lists
    /(?:(?:^|\n)(?:Step|Phase|Task)?\s*\d+[\.\)]\s*(.+))+/gim,
    // TODO items
    /(?:TODO|FIXME|TASK):\s*(.+)/gi,
    // Checkbox items (from markdown)
    /(?:\[[ x]\])\s*(.+)/gi,
    // Bullet points with action verbs
    /(?:^|\n)[•\-\*]\s*((?:Create|Build|Add|Update|Fix|Implement|Write|Test|Deploy|Configure|Setup|Install|Remove|Delete|Refactor).+)/gim,
  ];

  // Extract items from each pattern
  const extractedItems = [];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const item = match[1]?.trim();
      if (item && item.length > 5 && item.length < 500) {
        extractedItems.push(item);
      }
    }
  }

  // Deduplicate
  const uniqueItems = [...new Set(extractedItems)];

  if (uniqueItems.length > 0) {
    // Try to detect plan title from context
    const titleMatch = text.match(/(?:Plan|Steps|Tasks|TODO|Implementation)[\s:]+(.+?)(?:\n|$)/i);
    const title = titleMatch?.[1]?.trim() || 'Extracted Plan';

    plans.push({
      projectId,
      sessionId,
      title,
      items: uniqueItems.map(description => ({
        description,
        status: 'pending',
        priority: 'normal',
      })),
      extractedFrom: 'conversation',
    });
  }

  return plans;
}

export default {
  createPlan,
  addPlanItem,
  updatePlanItem,
  getPlanById,
  getPlansByProject,
  getPlansBySession,
  getActivePlans,
  updatePlan,
  deletePlan,
  extractPlansFromText,
};
