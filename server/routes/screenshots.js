import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import db from '../db.js';
import { dataUrlToBuffer } from '../services/screenshots.js';

const router = Router();

router.get('/:id/screenshots', (req, res) => {
  const { stationId } = req.query;
  const rows = stationId
    ? db.prepare('SELECT id, source FROM screenshots WHERE session_id = ? AND station_id = ?').all(req.params.id, stationId)
    : db.prepare('SELECT id, station_id, source FROM screenshots WHERE session_id = ?').all(req.params.id);
  res.json(rows);
});

router.get('/:id/screenshots/:screenshotId', (req, res) => {
  const row = db.prepare('SELECT data FROM screenshots WHERE id = ? AND session_id = ?').get(req.params.screenshotId, req.params.id);
  if (!row) return res.status(404).end();
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(row.data));
});

router.patch('/:id/screenshots/:screenshotId', (req, res) => {
  const { stationId } = req.body;
  if (!stationId) return res.status(400).json({ error: 'stationId required' });
  db.prepare('UPDATE screenshots SET station_id = ? WHERE id = ? AND session_id = ?')
    .run(stationId, req.params.screenshotId, req.params.id);
  res.json({ ok: true });
});

router.post('/:id/screenshots', (req, res) => {
  const { stationId, dataUrl } = req.body;
  if (!stationId || !dataUrl) return res.status(400).json({ error: 'stationId and dataUrl required' });
  const screenshotId = randomUUID();
  db.prepare('INSERT INTO screenshots (id, session_id, station_id, data, source) VALUES (?, ?, ?, ?, ?)').run(
    screenshotId, req.params.id, stationId, dataUrlToBuffer(dataUrl), 'manual'
  );
  res.json({ id: screenshotId });
});

export default router;
