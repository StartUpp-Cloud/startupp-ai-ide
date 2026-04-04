import express from 'express';
import { getDB } from '../db.js';

const router = express.Router();

// GET /api/profile — Get current profile
router.get('/', (req, res) => {
  const db = getDB();
  res.json(db.data.profile || {});
});

// PUT /api/profile — Update profile
router.put('/', async (req, res) => {
  try {
    const db = getDB();
    const { name, role, tone, preferences, codeStyle, languages } = req.body;

    db.data.profile = {
      ...db.data.profile,
      ...(name !== undefined && { name }),
      ...(role !== undefined && { role }),
      ...(tone !== undefined && { tone }),
      ...(preferences !== undefined && { preferences }),
      ...(codeStyle !== undefined && { codeStyle }),
      ...(languages !== undefined && { languages }),
      setupComplete: true,
    };

    await db.write();
    res.json(db.data.profile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
