import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import db from '../db.js';
import { aggregateResults, gatherStationContext, buildTestPlanContext } from '../services/stations.js';
import { endpointKeyFromString } from '../services/endpoints.js';
import { analyzeImpact, chatImpact, generateTestPlan, generateClarifyingQuestions } from '../services/llm.js';

const router = Router();

function loadOverrides() {
  const rows = db.prepare('SELECT canonical_key, merged_into, custom_label, color FROM station_overrides').all();
  const map = {};
  for (const r of rows) map[r.canonical_key] = { mergedInto: r.merged_into, customLabel: r.custom_label, color: r.color };
  return map;
}

const DOC_STALE_MS = 1000 * 60 * 60 * 24 * 180; // ~6 months

// Attach per-station coverage + risk metadata so the map can render overlay lenses.
function enrichMapContext(stations) {
  const covStmt = db.prepare('SELECT type, status FROM test_coverage WHERE session_id = ? AND station_id = ?');
  const svcStmt = db.prepare('SELECT name, coverage FROM station_services WHERE session_id = ? AND station_id = ?');
  const incStmt = db.prepare('SELECT COUNT(*) AS c FROM incidents WHERE session_id = ? AND station_id = ?');
  const docStmt = db.prepare('SELECT updated_at FROM station_docs WHERE session_id = ? AND station_id = ?');
  const flagStmt = db.prepare('SELECT COUNT(*) AS c FROM feature_flags WHERE session_id = ? AND station_id = ?');
  const obsStmt = db.prepare('SELECT COUNT(*) AS c FROM observability WHERE session_id = ? AND station_id = ?');
  const traceDirectStmt = db.prepare('SELECT spans FROM traces WHERE session_id = ? AND station_id = ?');
  const traceByEndpointStmt = db.prepare('SELECT spans FROM traces WHERE endpoint = ?');
  const rank = { covered: 2, partial: 1, none: 0 };

  const addTraceServices = (spansJson, set) => {
    try { for (const sp of JSON.parse(spansJson)) if (sp.service && sp.service !== 'unknown') set.add(sp.service); }
    catch { /* skip malformed */ }
  };

  for (const st of stations) {
    const cov = {};
    const svcStatuses = [];
    const services = new Set(); // backend services this station calls (manual + observed in traces)
    let incidentCount = 0;
    let docCount = 0;
    let hasStaleDocs = false;
    let flagCount = 0;
    let obsCount = 0;

    for (const m of st.sessionMappings || []) {
      for (const c of covStmt.all(m.sessionId, m.stationId)) {
        if (!(c.type in cov) || (rank[c.status] ?? 0) > (rank[cov[c.type]] ?? 0)) cov[c.type] = c.status;
      }
      for (const s of svcStmt.all(m.sessionId, m.stationId)) {
        if (s.name) services.add(s.name);
        if (s.coverage) svcStatuses.push(s.coverage);
      }
      for (const t of traceDirectStmt.all(m.sessionId, m.stationId)) addTraceServices(t.spans, services);
      incidentCount += incStmt.get(m.sessionId, m.stationId).c;
      flagCount += flagStmt.get(m.sessionId, m.stationId).c;
      obsCount += obsStmt.get(m.sessionId, m.stationId).c;
      for (const d of docStmt.all(m.sessionId, m.stationId)) {
        docCount++;
        if (d.updated_at && Date.now() - new Date(d.updated_at).getTime() > DOC_STALE_MS) hasStaleDocs = true;
      }
    }
    for (const api of st.apis || []) {
      for (const t of traceByEndpointStmt.all(endpointKeyFromString(api))) addTraceServices(t.spans, services);
    }

    st.services = [...services];
    st.coverage = cov;

    let su = null;
    if (svcStatuses.length) {
      if (svcStatuses.every((s) => s === 'covered')) su = 'covered';
      else if (svcStatuses.every((s) => s === 'none')) su = 'none';
      else su = 'partial';
    }
    st.serviceUnit = su;
    st.incidentCount = incidentCount;
    st.docCount = docCount;
    st.hasStaleDocs = hasStaleDocs;
    st.flagCount = flagCount;
    st.obsCount = obsCount;
  }
  return stations;
}

router.get('/aggregate/map', (req, res) => {
  const rows = db.prepare('SELECT id, result FROM sessions').all();
  if (!rows.length) return res.json(null);
  const map = aggregateResults(rows.map((r) => ({ sessionId: r.id, result: JSON.parse(r.result) })), loadOverrides());
  enrichMapContext(map.stations);
  res.json(map);
});

// Set a station identity override (merge / rename / color) by canonical key.
// Only the provided fields change; others are preserved.
router.put('/aggregate/overrides', (req, res) => {
  const { canonicalKey, mergedInto, customLabel, color } = req.body;
  if (!canonicalKey) return res.status(400).json({ error: 'canonicalKey required' });

  const cur = db.prepare('SELECT merged_into, custom_label, color FROM station_overrides WHERE canonical_key = ?').get(canonicalKey) || {};
  const next = {
    merged_into: mergedInto !== undefined ? (mergedInto || null) : (cur.merged_into ?? null),
    custom_label: customLabel !== undefined ? (customLabel?.trim() || null) : (cur.custom_label ?? null),
    color: color !== undefined ? (color || null) : (cur.color ?? null),
  };

  if (!next.merged_into && !next.custom_label && !next.color) {
    db.prepare('DELETE FROM station_overrides WHERE canonical_key = ?').run(canonicalKey);
    return res.json({ ok: true, cleared: true });
  }
  db.prepare(
    'INSERT OR REPLACE INTO station_overrides (canonical_key, merged_into, custom_label, color) VALUES (?, ?, ?, ?)'
  ).run(canonicalKey, next.merged_into, next.custom_label, next.color);
  res.json({ ok: true });
});

router.delete('/aggregate/overrides/:key', (req, res) => {
  db.prepare('DELETE FROM station_overrides WHERE canonical_key = ?').run(req.params.key);
  res.json({ ok: true });
});

// Streams NDJSON: {type:'tool',...} per tool call, {type:'critic'}, then
// {type:'result', result}. Lets the client show a live investigation trail.
router.post('/impact', async (req, res) => {
  const { query, facts, extraFacts } = req.body;
  if (!query?.trim()) return res.status(400).json({ error: 'query required' });
  const context = gatherStationContext();

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (obj) => res.write(JSON.stringify(obj) + '\n');

  try {
    if (!context.stations.length) {
      send({ type: 'result', result: { summary: 'No sessions captured yet — record and save some journeys first.', concerns: [] } });
      return res.end();
    }
    const result = await analyzeImpact(query, context, facts, Array.isArray(extraFacts) ? extraFacts : [], send);
    send({ type: 'result', result });
    res.end();
  } catch (err) {
    console.error('Impact analysis error:', err);
    send({ type: 'error', error: err.message || 'Impact analysis failed' });
    res.end();
  }
});

// Model-proposed clarifying questions tailored to THIS change (slice-2 of Sharpen).
router.post('/impact/questions', async (req, res) => {
  const { query } = req.body;
  if (!query?.trim()) return res.status(400).json({ error: 'query required' });
  const ctx = gatherStationContext();
  if (!ctx.stations.length) return res.json({ questions: [] });
  const services = [...new Set(ctx.stations.flatMap((s) => (s.services || []).map((x) => x.name)))].slice(0, 30);
  const endpoints = [...new Set(ctx.stations.flatMap((s) => s.apis || []))].slice(0, 40);
  const steps = ctx.stations.map((s) => s.label).slice(0, 40);
  const summary = `Journey steps: ${steps.join(', ')}\nServices: ${services.join(', ') || '(none)'}\nEndpoints: ${endpoints.join(', ') || '(none)'}`;
  try {
    res.json({ questions: await generateClarifyingQuestions(query, summary) });
  } catch (err) {
    console.error('Clarifying questions error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate questions' });
  }
});

router.post('/impact/chat', async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'messages required' });
  const context = gatherStationContext();
  try {
    const reply = await chatImpact(messages, context);
    res.json({ reply });
  } catch (err) {
    console.error('Impact chat error:', err);
    res.status(500).json({ error: err.message || 'Impact chat failed' });
  }
});

// ---- Concern feedback (precision) ----
router.post('/impact/feedback', (req, res) => {
  const { change, stationLabel, level, confidence, vote } = req.body;
  if (vote !== 'up' && vote !== 'down') return res.status(400).json({ error: 'vote must be up or down' });
  db.prepare('INSERT INTO concern_feedback (id, change_text, station_label, level, confidence, vote, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), change || null, stationLabel || null, level || null, confidence || null, vote, new Date().toISOString());
  res.json({ ok: true });
});

router.get('/impact/feedback/stats', (req, res) => {
  const rows = db.prepare('SELECT vote, confidence FROM concern_feedback').all();
  const up = rows.filter((r) => r.vote === 'up').length;
  const down = rows.filter((r) => r.vote === 'down').length;
  const total = up + down;
  const byConfidence = {};
  for (const conf of ['high', 'medium', 'low']) {
    const subset = rows.filter((r) => r.confidence === conf);
    const u = subset.filter((r) => r.vote === 'up').length;
    if (subset.length) byConfidence[conf] = { total: subset.length, precision: Math.round((u / subset.length) * 100) };
  }
  res.json({ total, up, down, precision: total ? Math.round((up / total) * 100) : null, byConfidence });
});

// ---- Eval cases (recall) ----
router.get('/impact/evals', (req, res) => {
  const rows = db.prepare('SELECT * FROM eval_cases ORDER BY rowid ASC').all();
  res.json(rows.map((r) => ({
    id: r.id, name: r.name, change: r.change_text, expected: JSON.parse(r.expected),
    lastRecall: r.last_recall, lastPrecision: r.last_precision, lastRunAt: r.last_run_at,
  })));
});

router.post('/impact/evals', (req, res) => {
  const { name, change, expected } = req.body;
  if (!name?.trim() || !change?.trim() || !Array.isArray(expected) || !expected.length) {
    return res.status(400).json({ error: 'name, change and a non-empty expected[] are required' });
  }
  const id = randomUUID();
  db.prepare('INSERT INTO eval_cases (id, name, change_text, expected, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, name.trim(), change.trim(), JSON.stringify(expected), new Date().toISOString());
  res.json({ id });
});

router.put('/impact/evals/:id', (req, res) => {
  const { name, change, expected } = req.body;
  if (!name?.trim() || !change?.trim() || !Array.isArray(expected) || !expected.length) {
    return res.status(400).json({ error: 'name, change and a non-empty expected[] are required' });
  }
  const r = db.prepare('UPDATE eval_cases SET name = ?, change_text = ?, expected = ? WHERE id = ?')
    .run(name.trim(), change.trim(), JSON.stringify(expected), req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Eval case not found' });
  res.json({ ok: true });
});

router.delete('/impact/evals/:id', (req, res) => {
  db.prepare('DELETE FROM eval_cases WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM eval_runs WHERE case_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Run history (one row per case per run) for the drift chart.
router.get('/impact/evals/history', (req, res) => {
  const rows = db.prepare('SELECT case_id, batch_id, recall, precision, created_at FROM eval_runs ORDER BY created_at ASC').all();
  res.json(rows.map((r) => ({ caseId: r.case_id, batchId: r.batch_id, recall: r.recall, precision: r.precision, createdAt: r.created_at })));
});

router.post('/impact/evals/:id/run', async (req, res) => {
  const row = db.prepare('SELECT * FROM eval_cases WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Eval case not found' });
  const context = gatherStationContext();
  if (!context.stations.length) return res.status(400).json({ error: 'No sessions captured to analyze against' });
  try {
    const result = await analyzeImpact(row.change_text, context);
    const norm = (s) => (s || '').toLowerCase().trim();
    const expected = JSON.parse(row.expected);
    const flagged = (result.concerns ?? []).map((c) => c.stationLabel);
    const flaggedSet = new Set(flagged.map(norm));
    const expectedSet = new Set(expected.map(norm));
    const matched = expected.filter((e) => flaggedSet.has(norm(e)));
    const missed = expected.filter((e) => !flaggedSet.has(norm(e)));
    const extra = flagged.filter((f) => !expectedSet.has(norm(f)));
    const recall = Math.round((matched.length / expected.length) * 100);
    const precision = flagged.length ? Math.round((matched.length / flagged.length) * 100) : 0;
    const now = new Date().toISOString();
    db.prepare('UPDATE eval_cases SET last_recall = ?, last_precision = ?, last_run_at = ? WHERE id = ?')
      .run(recall, precision, now, row.id);
    db.prepare('INSERT INTO eval_runs (id, case_id, batch_id, recall, precision, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), row.id, req.body?.batchId || randomUUID(), recall, precision, now);
    res.json({ recall, precision, matched, missed, extra, flagged, expected });
  } catch (err) {
    console.error('Eval run error:', err);
    res.status(500).json({ error: err.message || 'Eval run failed' });
  }
});

// ---- Saved / shareable impact reports ----
router.post('/impact/reports', (req, res) => {
  const { change, result, testPlan, title, thread, facts, dynamicQA } = req.body;
  if (!change?.trim() || !result) return res.status(400).json({ error: 'change and result required' });
  const id = randomUUID();
  const derived = (title?.trim()) || change.trim().split('\n')[0].slice(0, 80);
  const factsJson = facts && typeof facts === 'object' && Object.keys(facts).length ? JSON.stringify(facts) : null;
  const dynJson = Array.isArray(dynamicQA) && dynamicQA.length ? JSON.stringify(dynamicQA) : null;
  db.prepare('INSERT INTO impact_reports (id, title, change_text, result, test_plan, thread, facts, dynamic_qa, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, derived, change.trim(), JSON.stringify(result), testPlan ? JSON.stringify(testPlan) : null,
         Array.isArray(thread) && thread.length ? JSON.stringify(thread) : null, factsJson, dynJson, new Date().toISOString());
  res.json({ id });
});

router.get('/impact/reports', (req, res) => {
  const rows = db.prepare('SELECT id, title, change_text, result, created_at FROM impact_reports ORDER BY created_at DESC').all();
  res.json(rows.map((r) => {
    let concernCount = 0, summary = '';
    try { const parsed = JSON.parse(r.result); concernCount = parsed.concerns?.length ?? 0; summary = parsed.summary ?? ''; } catch { /* ignore */ }
    return { id: r.id, title: r.title, change: r.change_text, summary, concernCount, createdAt: r.created_at };
  }));
});

router.get('/impact/reports/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM impact_reports WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Report not found' });
  res.json({
    id: row.id, title: row.title, change: row.change_text,
    result: JSON.parse(row.result), testPlan: row.test_plan ? JSON.parse(row.test_plan) : null,
    thread: row.thread ? JSON.parse(row.thread) : [],
    facts: row.facts ? JSON.parse(row.facts) : {},
    dynamicQA: row.dynamic_qa ? JSON.parse(row.dynamic_qa) : [],
    createdAt: row.created_at,
  });
});

router.delete('/impact/reports/:id', (req, res) => {
  db.prepare('DELETE FROM impact_reports WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Focused, data-rich test plan ----
router.post('/impact/test-plan', async (req, res) => {
  const { change, stations } = req.body;
  if (!change?.trim()) return res.status(400).json({ error: 'change required' });
  const context = buildTestPlanContext(Array.isArray(stations) ? stations : []);
  if (!context.length) return res.json({ tests: [] });
  try {
    res.json(await generateTestPlan(change, context));
  } catch (err) {
    console.error('Test plan error:', err);
    res.status(500).json({ error: err.message || 'Test plan failed' });
  }
});

export default router;
