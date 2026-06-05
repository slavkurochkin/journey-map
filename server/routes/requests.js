import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import db from '../db.js';
import { endpointKey, endpointKeyFromString } from '../services/endpoints.js';

const router = Router();

// Collapse functionally-identical requests, keeping the first.
function dedupeRequests(list) {
  const seen = new Set();
  return list.filter((r) => {
    const key = `${r.method} ${r.url} ${r.status} ${r.responseBody ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Match by endpoint signature across ALL sessions (literal path — before /:id)
router.get('/requests/by-endpoints', (req, res) => {
  const raw = req.query.endpoints;
  if (!raw) return res.json([]);
  const wanted = new Set(raw.split(',').map((e) => endpointKeyFromString(decodeURIComponent(e.trim()))));
  const rows = db.prepare('SELECT id, session_id, endpoint, data, source FROM api_requests ORDER BY rowid ASC').all();
  const matched = rows
    .filter((r) => r.endpoint && wanted.has(r.endpoint))
    .map((r) => ({ id: r.id, sessionId: r.session_id, source: r.source, ...JSON.parse(r.data) }));
  res.json(dedupeRequests(matched));
});

// Requests uploaded directly to a session+station
router.get('/:id/requests', (req, res) => {
  const { stationId } = req.query;
  if (!stationId) return res.status(400).json({ error: 'stationId required' });
  const rows = db.prepare(
    'SELECT id, data, source FROM api_requests WHERE session_id = ? AND station_id = ? ORDER BY rowid ASC'
  ).all(req.params.id, stationId);
  res.json(dedupeRequests(rows.map((r) => ({ id: r.id, sessionId: req.params.id, source: r.source, ...JSON.parse(r.data) }))));
});

router.post('/:id/requests', (req, res) => {
  const { stationId, data } = req.body;
  if (!stationId || !data) return res.status(400).json({ error: 'stationId and data required' });
  const id = randomUUID();
  db.prepare('INSERT INTO api_requests (id, session_id, station_id, data, endpoint) VALUES (?, ?, ?, ?, ?)').run(
    id, req.params.id, stationId, JSON.stringify(data), endpointKey(data.method, data.url)
  );
  res.json({ id });
});

router.delete('/:id/requests/:requestId', (req, res) => {
  db.prepare('DELETE FROM api_requests WHERE id = ? AND session_id = ?').run(req.params.requestId, req.params.id);
  res.json({ ok: true });
});

export default router;
