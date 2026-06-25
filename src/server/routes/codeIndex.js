import express from 'express';
import { findProjectById } from '../models/Project.js';
import { getIndexMeta } from '../sqliteStore.js';
import { indexProject } from '../codeIndex.js';
import { llmProvider } from '../llmProvider.js';

const router = express.Router();

// GET /api/projects/:projectId/code-index — status (also lazily kicks on-open indexing when stale)
router.get('/:projectId/code-index', (req, res) => {
  const projectId = req.params.projectId;
  const meta = getIndexMeta(projectId);
  const project = findProjectById(projectId);
  if (project?.containerName) {
    const stale = !meta || meta.status === 'none' || meta.embedModel !== llmProvider.embeddingModelId();
    if (stale && meta?.status !== 'indexing') {
      // fire-and-forget on-open / stale rebuild; status is observable via this endpoint
      indexProject(project).catch(err => console.warn('[code-index] on-open index failed:', err.message));
    }
  }
  res.json(meta || { status: 'none' });
});

// POST /api/projects/:projectId/code-index/reindex — force full rebuild
router.post('/:projectId/code-index/reindex', (req, res) => {
  const project = findProjectById(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'project not found' });
  indexProject(project, { full: true }).catch(err => console.warn('[code-index] reindex failed:', err.message));
  res.json({ started: true });
});

export default router;
