import express from 'express';
import { jobManager } from '../jobManager.js';

const router = express.Router();

// GET /api/jobs — List active jobs
router.get('/', (req, res) => {
  const activeJobs = jobManager.getActiveJobs();
  res.json({ jobs: activeJobs });
});

// GET /api/jobs/:jobId — Get job details
router.get('/:jobId', (req, res) => {
  const job = jobManager.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

// GET /api/jobs/:jobId/output — Get job output (tail)
router.get('/:jobId/output', (req, res) => {
  const { tail = 50000 } = req.query;
  const output = jobManager.getJobOutput(req.params.jobId, parseInt(tail, 10));
  res.type('text/plain').send(output);
});

// POST /api/jobs/:jobId/cancel — Cancel a running job
router.post('/:jobId/cancel', (req, res) => {
  const job = jobManager.cancelJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found or not running' });
  }
  res.json({ cancelled: true, job });
});

// GET /api/projects/:projectId/jobs — List jobs for a project/session
router.get('/project/:projectId', (req, res) => {
  const { sessionId, limit = 20 } = req.query;
  const jobs = jobManager.getSessionJobs(req.params.projectId, sessionId, parseInt(limit, 10));
  res.json({ jobs });
});

// POST /api/jobs/cleanup — Clean up old jobs
router.post('/cleanup', async (req, res) => {
  const { daysToKeep = 7 } = req.body;
  const cleaned = await jobManager.cleanup(parseInt(daysToKeep, 10));
  res.json({ cleaned });
});

export default router;
