import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import db from '../db.js';

const router = Router();

// ---- Journey-level docs (global library) — literal path, before /:id ----
router.get('/journey-docs', (req, res) => {
  const rows = db.prepare('SELECT id, type, title, url, added_at, updated_at FROM journey_docs ORDER BY rowid ASC').all();
  res.json(rows.map((r) => ({ id: r.id, type: r.type, title: r.title, url: r.url, addedAt: r.added_at, updatedAt: r.updated_at })));
});

router.post('/journey-docs', (req, res) => {
  const { type, title, url = null } = req.body;
  if (!type || !title?.trim()) return res.status(400).json({ error: 'type and title required' });
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO journey_docs (id, type, title, url, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, type, title.trim(), url?.trim() || null, now, now
  );
  res.json({ id, type, title: title.trim(), url: url?.trim() || null, addedAt: now, updatedAt: now });
});

router.patch('/journey-docs/:docId', (req, res) => {
  const { type, title, url } = req.body;
  const sets = ['updated_at = ?'];
  const vals = [new Date().toISOString()];
  if (type !== undefined) { sets.push('type = ?'); vals.push(type); }
  if (title !== undefined) { sets.push('title = ?'); vals.push(title.trim()); }
  if (url !== undefined) { sets.push('url = ?'); vals.push(url?.trim() || null); }
  vals.push(req.params.docId);
  db.prepare(`UPDATE journey_docs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

router.delete('/journey-docs/:docId', (req, res) => {
  db.prepare('DELETE FROM journey_docs WHERE id = ?').run(req.params.docId);
  res.json({ ok: true });
});

// ---- Station-level doc/design links ----
router.get('/:id/station-docs', (req, res) => {
  const { stationId } = req.query;
  if (!stationId) return res.status(400).json({ error: 'stationId required' });
  const rows = db.prepare(
    'SELECT id, type, title, url, added_at, updated_at FROM station_docs WHERE session_id = ? AND station_id = ? ORDER BY rowid ASC'
  ).all(req.params.id, stationId);
  res.json(rows.map((r) => ({ id: r.id, type: r.type, title: r.title, url: r.url, addedAt: r.added_at, updatedAt: r.updated_at })));
});

router.post('/:id/station-docs', (req, res) => {
  const { stationId, type, title, url = null } = req.body;
  if (!stationId || !type || !title?.trim()) return res.status(400).json({ error: 'stationId, type and title required' });
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO station_docs (id, session_id, station_id, type, title, url, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, req.params.id, stationId, type, title.trim(), url?.trim() || null, now, now
  );
  res.json({ id, type, title: title.trim(), url: url?.trim() || null, addedAt: now, updatedAt: now });
});

router.patch('/:id/station-docs/:docId', (req, res) => {
  const { type, title, url } = req.body;
  const sets = ['updated_at = ?'];
  const vals = [new Date().toISOString()];
  if (type !== undefined) { sets.push('type = ?'); vals.push(type); }
  if (title !== undefined) { sets.push('title = ?'); vals.push(title.trim()); }
  if (url !== undefined) { sets.push('url = ?'); vals.push(url?.trim() || null); }
  vals.push(req.params.docId, req.params.id);
  db.prepare(`UPDATE station_docs SET ${sets.join(', ')} WHERE id = ? AND session_id = ?`).run(...vals);
  res.json({ ok: true });
});

router.delete('/:id/station-docs/:docId', (req, res) => {
  db.prepare('DELETE FROM station_docs WHERE id = ? AND session_id = ?').run(req.params.docId, req.params.id);
  res.json({ ok: true });
});

export default router;
