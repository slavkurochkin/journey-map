import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import db from '../db.js';
import { endpointKeyFromString } from '../services/endpoints.js';
import { parseTraces } from '../services/traces.js';

const router = Router();

function rowToTrace(r) {
  return {
    id: r.id,
    sessionId: r.session_id,
    traceId: r.trace_id,
    rootName: r.root_name,
    endpoint: r.endpoint,
    durationMs: r.duration_ms,
    startMs: r.start_time,
    status: r.status,
    spanCount: r.span_count,
    source: r.source,
    spans: JSON.parse(r.spans),
  };
}

// Match traces by endpoint signature across ALL sessions (same model as requests),
// so a trace shows on every station that calls the same endpoint.
router.get('/traces/by-endpoints', (req, res) => {
  const raw = req.query.endpoints;
  if (!raw) return res.json([]);
  const wanted = new Set(raw.split(',').map((e) => endpointKeyFromString(decodeURIComponent(e.trim()))));
  const rows = db.prepare('SELECT * FROM traces ORDER BY start_time ASC').all();
  res.json(rows.filter((r) => r.endpoint && wanted.has(r.endpoint)).map(rowToTrace));
});

// Distinct backend services observed in a station's traces (direct + by endpoint),
// used to propose services the user may have missed in their manual list.
router.get('/trace-services', (req, res) => {
  const { sessionId, stationId, endpoints } = req.query;
  const rows = new Map();
  if (sessionId && stationId) {
    for (const r of db.prepare('SELECT id, spans FROM traces WHERE session_id = ? AND station_id = ?').all(sessionId, stationId)) rows.set(r.id, r);
  }
  if (endpoints) {
    const wanted = new Set(endpoints.split(',').map((e) => endpointKeyFromString(decodeURIComponent(e.trim()))));
    for (const r of db.prepare('SELECT id, endpoint, spans FROM traces').all()) {
      if (r.endpoint && wanted.has(r.endpoint)) rows.set(r.id, r);
    }
  }
  const services = new Set();
  for (const r of rows.values()) {
    try {
      for (const sp of JSON.parse(r.spans)) if (sp.service && sp.service !== 'unknown') services.add(sp.service);
    } catch { /* skip malformed */ }
  }
  res.json([...services]);
});

// Traces uploaded directly to this session+station
router.get('/:id/traces', (req, res) => {
  const { stationId } = req.query;
  if (!stationId) return res.status(400).json({ error: 'stationId required' });
  const rows = db
    .prepare('SELECT * FROM traces WHERE session_id = ? AND station_id = ? ORDER BY start_time ASC')
    .all(req.params.id, stationId);
  res.json(rows.map(rowToTrace));
});

// Upload an OTLP/JSON export; every parsed trace is attached to this station and
// tagged with its derived endpoint signature for cross-session matching.
router.post('/:id/traces', (req, res) => {
  const { stationId, data } = req.body;
  if (!stationId || !data) return res.status(400).json({ error: 'stationId and data required' });

  let traces;
  try {
    traces = parseTraces(data);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const insert = db.prepare(
    `INSERT INTO traces (id, session_id, station_id, trace_id, root_name, endpoint, duration_ms, start_time, status, span_count, spans, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const ids = [];
  for (const t of traces) {
    const id = randomUUID();
    insert.run(
      id, req.params.id, stationId, t.traceId ?? null, t.rootName ?? null, t.endpoint ?? null,
      t.durationMs ?? null, t.startMs ?? null, t.status ?? null, t.spanCount ?? null,
      JSON.stringify(t.spans), 'upload'
    );
    ids.push(id);
  }
  res.json({ inserted: ids.length, ids });
});

router.delete('/:id/traces/:traceRowId', (req, res) => {
  db.prepare('DELETE FROM traces WHERE id = ? AND session_id = ?').run(req.params.traceRowId, req.params.id);
  res.json({ ok: true });
});

export default router;
