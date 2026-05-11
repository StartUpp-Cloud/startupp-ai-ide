import express from 'express';
import { connectionService } from '../connections/connectionService.js';
import { resolveRuntimeEnvironment } from '../connections/runtimeEnvResolver.js';

const router = express.Router();

function handleError(res, error) {
  const status = error.code === 'validation_failed' || error.code === 'env_conflict' ? 400 : 500;
  res.status(status).json({ error: error.message, code: error.code || 'error', details: error.details });
}

router.get('/providers', (req, res) => {
  res.json({ providers: connectionService.listProviders() });
});

router.get('/', (req, res) => {
  try {
    res.json({ connections: connectionService.list({ projectId: req.query.projectId || null }) });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/', async (req, res) => {
  try {
    const connection = connectionService.create(req.body || {});
    const result = req.body?.validateNow ? await connectionService.validate(connection.id) : connection;
    res.status(201).json({ connection: result });
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/project/:projectId/runtime-env-preview', (req, res) => {
  try {
    const target = req.query.target || 'pty';
    const result = resolveRuntimeEnvironment({ projectId: req.params.projectId, target });
    res.json({ env: result.redactedEnv, warnings: result.warnings });
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/:id', (req, res) => {
  try {
    const connection = connectionService.get(req.params.id);
    if (!connection) return res.status(404).json({ error: 'Connection not found' });
    res.json({ connection });
  } catch (error) {
    handleError(res, error);
  }
});

router.patch('/:id', (req, res) => {
  try {
    const connection = connectionService.update(req.params.id, req.body || {});
    if (!connection) return res.status(404).json({ error: 'Connection not found' });
    res.json({ connection });
  } catch (error) {
    handleError(res, error);
  }
});

router.delete('/:id', (req, res) => {
  try {
    const deleted = connectionService.delete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Connection not found' });
    res.json({ deleted: true });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/:id/validate', async (req, res) => {
  try {
    const connection = await connectionService.validate(req.params.id);
    if (!connection) return res.status(404).json({ error: 'Connection not found' });
    res.json({ connection });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/:id/rotate', (req, res) => {
  try {
    const connection = connectionService.rotate(req.params.id, req.body?.fields || {});
    if (!connection) return res.status(404).json({ error: 'Connection not found' });
    res.json({ connection });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/:id/disconnect', (req, res) => {
  try {
    const connection = connectionService.disconnect(req.params.id);
    if (!connection) return res.status(404).json({ error: 'Connection not found' });
    res.json({ connection });
  } catch (error) {
    handleError(res, error);
  }
});

export default router;
