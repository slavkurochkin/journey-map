import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import db from '../db.js';
import { parseLcov } from '../services/lcov.js';

const router = Router();

// ---- Services ----
router.get('/:id/services', (req, res) => {
  const { stationId } = req.query;
  if (stationId) {
    const rows = db.prepare(
      'SELECT id, name, coverage FROM station_services WHERE session_id = ? AND station_id = ? ORDER BY rowid ASC'
    ).all(req.params.id, stationId);
    return res.json(rows);
  }
  const rows = db.prepare('SELECT name, coverage FROM station_services WHERE session_id = ? ORDER BY rowid ASC').all(req.params.id);
  const rank = { covered: 2, partial: 1, none: 0 };
  const byName = new Map();
  for (const r of rows) {
    const cur = byName.get(r.name);
    if (cur === undefined || (rank[r.coverage] ?? -1) > (rank[cur] ?? -1)) byName.set(r.name, r.coverage || null);
  }
  res.json([...byName.entries()].map(([name, coverage]) => ({ name, coverage })));
});

router.get('/:id/station-services', (req, res) => {
  const rows = db.prepare('SELECT station_id, name, coverage FROM station_services WHERE session_id = ?').all(req.params.id);
  res.json(rows.map((r) => ({ stationId: r.station_id, name: r.name, coverage: r.coverage })));
});

router.put('/:id/service-coverage', (req, res) => {
  const { name, coverage } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  db.prepare('UPDATE station_services SET coverage = ? WHERE session_id = ? AND name = ?').run(coverage || null, req.params.id, name);
  res.json({ ok: true });
});

router.post('/:id/coverage/import', (req, res) => {
  const { lcov } = req.body;
  if (!lcov) return res.status(400).json({ error: 'lcov required' });
  const files = parseLcov(lcov);
  if (!files.length) return res.status(400).json({ error: 'No coverage records found — is this an lcov.info file?' });

  const services = db.prepare('SELECT DISTINCT name FROM station_services WHERE session_id = ?').all(req.params.id).map((r) => r.name);
  const preview = services.map((name) => {
    const base = name.replace(/-service$/, '').toLowerCase();
    const matched = files.filter((f) => {
      const p = f.file.toLowerCase();
      return p.includes(name.toLowerCase()) || (base.length >= 3 && p.includes(base));
    });
    const hit = matched.reduce((a, f) => a + f.hit, 0);
    const found = matched.reduce((a, f) => a + f.found, 0);
    const percent = found ? Math.round((hit / found) * 100) : null;
    const status = percent == null ? null : percent >= 80 ? 'covered' : percent >= 40 ? 'partial' : 'none';
    return { name, percent, status, files: matched.length };
  });
  res.json({ preview, totalFiles: files.length });
});

router.post('/:id/services', (req, res) => {
  const { stationId, name } = req.body;
  if (!stationId || !name?.trim()) return res.status(400).json({ error: 'stationId and name required' });
  const id = randomUUID();
  db.prepare('INSERT INTO station_services (id, session_id, station_id, name) VALUES (?, ?, ?, ?)').run(id, req.params.id, stationId, name.trim());
  res.json({ id, name: name.trim(), coverage: null });
});

router.patch('/:id/services/:serviceId', (req, res) => {
  db.prepare('UPDATE station_services SET coverage = ? WHERE id = ? AND session_id = ?').run(req.body.coverage || null, req.params.serviceId, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id/services/:serviceId', (req, res) => {
  db.prepare('DELETE FROM station_services WHERE id = ? AND session_id = ?').run(req.params.serviceId, req.params.id);
  res.json({ ok: true });
});

// ---- Feature flags ----
router.get('/:id/flags', (req, res) => {
  const { stationId } = req.query;
  if (!stationId) return res.status(400).json({ error: 'stationId required' });
  const rows = db.prepare(
    'SELECT id, name, enabled, rollout, description FROM feature_flags WHERE session_id = ? AND station_id = ? ORDER BY rowid ASC'
  ).all(req.params.id, stationId);
  res.json(rows.map((r) => ({ ...r, enabled: !!r.enabled })));
});

router.post('/:id/flags', (req, res) => {
  const { stationId, name, enabled = true, rollout = null, description = null } = req.body;
  if (!stationId || !name?.trim()) return res.status(400).json({ error: 'stationId and name required' });
  const id = randomUUID();
  const rolloutVal = rollout?.trim() || null;
  const descVal = description?.trim() || null;
  db.prepare('INSERT INTO feature_flags (id, session_id, station_id, name, enabled, rollout, description) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, req.params.id, stationId, name.trim(), enabled ? 1 : 0, rolloutVal, descVal
  );
  res.json({ id, name: name.trim(), enabled: !!enabled, rollout: rolloutVal, description: descVal });
});

router.patch('/:id/flags/:flagId', (req, res) => {
  const { enabled, rollout, description } = req.body;
  const sets = [];
  const vals = [];
  if (enabled !== undefined) { sets.push('enabled = ?'); vals.push(enabled ? 1 : 0); }
  if (rollout !== undefined) { sets.push('rollout = ?'); vals.push(rollout?.trim() || null); }
  if (description !== undefined) { sets.push('description = ?'); vals.push(description?.trim() || null); }
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.params.flagId, req.params.id);
  db.prepare(`UPDATE feature_flags SET ${sets.join(', ')} WHERE id = ? AND session_id = ?`).run(...vals);
  res.json({ ok: true });
});

router.delete('/:id/flags/:flagId', (req, res) => {
  db.prepare('DELETE FROM feature_flags WHERE id = ? AND session_id = ?').run(req.params.flagId, req.params.id);
  res.json({ ok: true });
});

// ---- Observability ----
router.get('/:id/observability', (req, res) => {
  const { stationId } = req.query;
  if (!stationId) return res.status(400).json({ error: 'stationId required' });
  const rows = db.prepare(
    'SELECT id, type, label, url FROM observability WHERE session_id = ? AND station_id = ? ORDER BY rowid ASC'
  ).all(req.params.id, stationId);
  res.json(rows);
});

router.post('/:id/observability', (req, res) => {
  const { stationId, type, label, url = null } = req.body;
  if (!stationId || !type || !label?.trim()) return res.status(400).json({ error: 'stationId, type and label required' });
  const id = randomUUID();
  const urlVal = url?.trim() || null;
  db.prepare('INSERT INTO observability (id, session_id, station_id, type, label, url) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, req.params.id, stationId, type, label.trim(), urlVal
  );
  res.json({ id, type, label: label.trim(), url: urlVal });
});

router.delete('/:id/observability/:obsId', (req, res) => {
  db.prepare('DELETE FROM observability WHERE id = ? AND session_id = ?').run(req.params.obsId, req.params.id);
  res.json({ ok: true });
});

// ---- Incidents ----
router.get('/:id/incidents', (req, res) => {
  const { stationId } = req.query;
  if (!stationId) return res.status(400).json({ error: 'stationId required' });
  const rows = db.prepare(
    'SELECT id, description, url, occurred_at, severity FROM incidents WHERE session_id = ? AND station_id = ? ORDER BY occurred_at DESC, rowid DESC'
  ).all(req.params.id, stationId);
  res.json(rows.map((r) => ({ id: r.id, description: r.description, url: r.url, occurredAt: r.occurred_at, severity: r.severity })));
});

router.post('/:id/incidents', (req, res) => {
  const { stationId, description, url = null, occurredAt = null, severity = null } = req.body;
  if (!stationId || !description?.trim()) return res.status(400).json({ error: 'stationId and description required' });
  const id = randomUUID();
  db.prepare('INSERT INTO incidents (id, session_id, station_id, description, url, occurred_at, severity) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, req.params.id, stationId, description.trim(), url?.trim() || null, occurredAt || null, severity || null
  );
  res.json({ id });
});

router.delete('/:id/incidents/:incidentId', (req, res) => {
  db.prepare('DELETE FROM incidents WHERE id = ? AND session_id = ?').run(req.params.incidentId, req.params.id);
  res.json({ ok: true });
});

// ---- Test coverage matrix ----
router.get('/:id/coverage', (req, res) => {
  const { stationId } = req.query;
  const rows = stationId
    ? db.prepare('SELECT id, station_id, type, status, url FROM test_coverage WHERE session_id = ? AND station_id = ? ORDER BY rowid ASC').all(req.params.id, stationId)
    : db.prepare('SELECT id, station_id, type, status, url FROM test_coverage WHERE session_id = ? ORDER BY rowid ASC').all(req.params.id);
  res.json(rows.map((r) => ({ id: r.id, stationId: r.station_id, type: r.type, status: r.status, url: r.url })));
});

router.put('/:id/coverage', (req, res) => {
  const { stationId, type, status, url } = req.body;
  if (!stationId || !type) return res.status(400).json({ error: 'stationId and type required' });
  const rowId = `${stationId}::${type}`;
  if (!status) {
    db.prepare('DELETE FROM test_coverage WHERE id = ? AND session_id = ?').run(rowId, req.params.id);
    return res.json({ ok: true, cleared: true });
  }
  db.prepare('INSERT OR REPLACE INTO test_coverage (id, session_id, station_id, type, status, url) VALUES (?, ?, ?, ?, ?, ?)')
    .run(rowId, req.params.id, stationId, type, status, url?.trim() || null);
  res.json({ id: rowId, stationId, type, status });
});

export default router;
