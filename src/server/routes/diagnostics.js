import express from 'express';
import os from 'os';
import { agentOrchestrator } from '../agentOrchestrator.js';
import { activityFeed } from '../activityFeed.js';
import { chatStore } from '../chatStore.js';
import Project from '../models/Project.js';
import { isDockerAvailable } from '../dockerRoute.js';
import { buildDiagnostics } from '../runDiagnostics.js';

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const load = os.loadavg();
    const cores = os.cpus().length || 1;
    const projects = Project.getAll();
    const sessions = projects.flatMap(project => chatStore.getSessions(project.id, { includeArchived: false }));
    const dockerAvailable = isDockerAvailable();
    const diagnostics = buildDiagnostics({
      health: {
        memory: { percent: Math.round(((totalMem - freeMem) / totalMem) * 100) },
        cpu: { percent: Math.min(100, Math.round((load[0] / cores) * 100)), cores },
        node: { heapMB: Math.round(process.memoryUsage().heapUsed / 1048576), rssMB: Math.round(process.memoryUsage().rss / 1048576) },
        uptime: Math.round(process.uptime()),
      },
      docker: { dockerAvailable, dockerRoute: dockerAvailable ? 'socket' : null },
      runs: agentOrchestrator.getRecentRuns(100),
      sessions,
      activities: activityFeed.getRecent(100),
    });
    res.json(diagnostics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to build diagnostics', message: error.message });
  }
});

export default router;

