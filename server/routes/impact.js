import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import db from '../db.js';
import { aggregateResults, gatherStationContext, buildTestPlanContext, loadStationOverrides } from '../services/stations.js';
import { withLayers, cumulativeConfigs } from '../services/contextLayers.js';
import { endpointKeyFromString } from '../services/endpoints.js';
import { analyzeImpact, chatImpact, generateTestPlan, generateClarifyingQuestions, activeImpactModel, withUsageCapture, impactCacheCount, clearImpactCache } from '../services/llm.js';

const router = Router();

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
  const map = aggregateResults(rows.map((r) => ({ sessionId: r.id, result: JSON.parse(r.result) })), loadStationOverrides());
  enrichMapContext(map.stations);
  res.json(map);
});

// Set a station identity override (merge / rename / color) by canonical key.
// Only the provided fields change; others are preserved.
router.put('/aggregate/overrides', (req, res) => {
  const { canonicalKey, mergedInto, customLabel, color } = req.body;
  if (!canonicalKey) return res.status(400).json({ error: 'canonicalKey required' });

  const cur = db.prepare('SELECT merged_into, custom_label, color, actions FROM station_overrides WHERE canonical_key = ?').get(canonicalKey) || {};
  const next = {
    merged_into: mergedInto !== undefined ? (mergedInto || null) : (cur.merged_into ?? null),
    custom_label: customLabel !== undefined ? (customLabel?.trim() || null) : (cur.custom_label ?? null),
    color: color !== undefined ? (color || null) : (cur.color ?? null),
    actions: cur.actions ?? null, // preserved: never wiped by an identity edit
  };

  if (!next.merged_into && !next.custom_label && !next.color && !next.actions) {
    db.prepare('DELETE FROM station_overrides WHERE canonical_key = ?').run(canonicalKey);
    return res.json({ ok: true, cleared: true });
  }
  db.prepare(
    'INSERT OR REPLACE INTO station_overrides (canonical_key, merged_into, custom_label, color, actions) VALUES (?, ?, ?, ?, ?)'
  ).run(canonicalKey, next.merged_into, next.custom_label, next.color, next.actions);
  res.json({ ok: true });
});

// Edit (rename) or delete (hide) an action on an aggregated station, keyed by the
// action's signature (sig from the map response). Persisted as an override — the
// source recordings are never modified, and the edit survives re-aggregation.
router.patch('/aggregate/overrides/:key/actions', (req, res) => {
  const key = req.params.key;
  const { op, sig, label } = req.body || {};
  if (!op || !sig) return res.status(400).json({ error: 'op and sig required' });

  const row = db.prepare('SELECT merged_into, custom_label, color, actions FROM station_overrides WHERE canonical_key = ?').get(key) || {};
  let ao = { hidden: [], renames: {} };
  if (row.actions) { try { ao = { hidden: [], renames: {}, ...JSON.parse(row.actions) }; } catch { /* reset */ } }
  const hidden = new Set(ao.hidden || []);
  const renames = { ...(ao.renames || {}) };

  if (op === 'hide') { hidden.add(sig); delete renames[sig]; }
  else if (op === 'rename') {
    const text = (label || '').trim();
    if (!text) return res.status(400).json({ error: 'label required for rename' });
    renames[sig] = text; hidden.delete(sig);
  } else if (op === 'reset') { hidden.delete(sig); delete renames[sig]; }
  else return res.status(400).json({ error: 'unknown op' });

  const actions = (hidden.size || Object.keys(renames).length)
    ? JSON.stringify({ hidden: [...hidden], renames })
    : null;
  const next = {
    merged_into: row.merged_into ?? null,
    custom_label: row.custom_label ?? null,
    color: row.color ?? null,
    actions,
  };

  if (!next.merged_into && !next.custom_label && !next.color && !next.actions) {
    db.prepare('DELETE FROM station_overrides WHERE canonical_key = ?').run(key);
    return res.json({ ok: true, cleared: true });
  }
  db.prepare(
    'INSERT OR REPLACE INTO station_overrides (canonical_key, merged_into, custom_label, color, actions) VALUES (?, ?, ?, ?, ?)'
  ).run(key, next.merged_into, next.custom_label, next.color, next.actions);
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

// ---- Context-engineering experiment (recall/precision vs context layers) ----
// Runs the whole eval set under the cumulative layer ladder (journey → +apis →
// +services → …), holding the engine path constant (forced one-shot) so only the
// context varies. Returns per-layer mean recall/precision + context size.
// A fatal LLM error won't recover by retrying or continuing (bad key, no credit,
// quota exhausted) — so the experiment should abort immediately, not grind through
// dozens of doomed calls and draw a misleading 0% cliff.
function isFatalLlmError(err) {
  const m = (err?.message || '').toLowerCase();
  if (err?.status === 401 || err?.status === 403) return true;
  return /credit balance|insufficient_quota|\bquota\b|billing|payment required|api key|authentication|invalid x-api-key/.test(m);
}
function friendlyExperimentError(err) {
  const m = err?.message || 'Experiment failed';
  if (/credit balance|billing|payment/i.test(m)) return 'Anthropic credit balance too low — run aborted. Top up at console.anthropic.com → Plans & Billing, then re-run.';
  if (/insufficient_quota|\bquota\b/i.test(m)) return 'Provider quota exceeded — run aborted. Check your plan/billing, then re-run.';
  if (err?.status === 401 || /api key|authentication|invalid x-api-key/i.test(m)) return 'Authentication failed (invalid API key) — run aborted. Fix the key in server/.env and restart.';
  return m;
}

// Streams NDJSON so the client sees per-layer progress (it's dozens of LLM calls):
//   {type:'start', total, caseCount}
//   {type:'layer-start', i, total, label}   (before each layer)
//   {type:'step', step}                      (after each layer completes)
//   {type:'done'} | {type:'error', error}
router.post('/impact/experiment', async (req, res) => {
  // Optional subset: run only the chosen cases (for demo clarity). Empty/absent → all.
  const wanted = Array.isArray(req.body?.caseIds) && req.body.caseIds.length ? new Set(req.body.caseIds) : null;
  const cases = db.prepare('SELECT * FROM eval_cases ORDER BY rowid ASC').all()
    .map((c) => ({ ...c, expectedList: JSON.parse(c.expected || '[]') }))
    .filter((c) => c.expectedList.length && (!wanted || wanted.has(c.id)));
  if (!cases.length) return res.status(400).json({ error: 'Need at least one eval case with expected stations' });

  const fullContext = gatherStationContext();
  if (!fullContext.stations.length) return res.status(400).json({ error: 'No sessions captured to analyze against' });

  // Average over N runs to smooth out a stochastic model.
  const runs = Math.min(5, Math.max(1, Number(req.body?.runs) || 1));
  // Opt-in: reuse the memo cache so a repeat run is an instant $0 cache-hit — for
  // demonstrating caching. Default off (every call is real, so cost/time are real).
  const useCache = req.body?.useCache === true && runs === 1;

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (obj) => res.write(JSON.stringify(obj) + '\n');

  const norm = (s) => (s || '').toLowerCase().trim();
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const configs = cumulativeConfigs();
  const model = activeImpactModel(); // tag the run so it can be compared across models
  const collected = [];
  send({ type: 'start', total: configs.length, caseCount: cases.length, runs, model });

  // Score one case under one context. Resilient: a flaky model response (e.g.
  // Anthropic occasionally emitting non-JSON) is retried once, then scored 0 — a
  // single bad call must never abort a multi-call experiment.
  const scoreOnce = async (c, context) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // By default bypass the memo cache so cost/time/variance are real; with
        // `useCache` on, a repeat run becomes an instant $0 cache-hit (the demo).
        const { value: result, usage } = await withUsageCapture(() =>
          analyzeImpact(c.change_text, context, null, [], undefined, { forcePath: 'oneshot', noCache: !useCache }));
        const flagged = (result.concerns ?? []).map((x) => x.stationLabel);
        const flaggedSet = new Set(flagged.map(norm));
        const matched = c.expectedList.filter((e) => flaggedSet.has(norm(e)));
        return {
          recall: Math.round((matched.length / c.expectedList.length) * 100),
          precision: flagged.length ? Math.round((matched.length / flagged.length) * 100) : 0,
          inTokens: usage.inputTokens, outTokens: usage.outputTokens, costUsd: usage.costUsd,
        };
      } catch (err) {
        if (isFatalLlmError(err)) throw err; // abort the whole experiment — retrying is pointless
        if (attempt === 1) {
          console.warn(`[experiment] "${c.name}" failed after retry: ${err.message}`);
          return { recall: 0, precision: 0, failed: true, inTokens: 0, outTokens: 0, costUsd: 0 };
        }
      }
    }
  };

  try {
    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];
      send({ type: 'layer-start', i: i + 1, total: configs.length, label: cfg.label });
      const context = withLayers(fullContext, cfg.layers);
      const contextChars = JSON.stringify(context).length;
      const t0 = Date.now();
      // Cases run concurrently; the N runs per case are sequential to bound load.
      const perCase = await Promise.all(cases.map(async (c) => {
        const rs = [];
        for (let r = 0; r < runs; r++) rs.push(await scoreOnce(c, context));
        return {
          caseId: c.id, name: c.name,
          recall: avg(rs.map((x) => x.recall)),
          precision: avg(rs.map((x) => x.precision)),
          recallRuns: rs.map((x) => x.recall),
          failed: rs.some((x) => x.failed),
          // Measured usage for this case, averaged per run (so it's comparable regardless of run count).
          inTokens: Math.round(avg(rs.map((x) => x.inTokens || 0))),
          outTokens: Math.round(avg(rs.map((x) => x.outTokens || 0))),
          costUsd: rs.reduce((a, x) => a + (x.costUsd || 0), 0) / rs.length,
        };
      }));
      const recall = avg(perCase.map((x) => x.recall));
      const precision = avg(perCase.map((x) => x.precision));
      const step = {
        layer: cfg.id, label: cfg.label, layers: cfg.layers,
        recall, precision,
        f1: recall + precision ? Math.round((2 * recall * precision) / (recall + precision)) : 0,
        contextChars, approxTokens: Math.round(contextChars / 4),
        // Measured (real) usage summed across this layer's cases — the per-model cost.
        inTokens: perCase.reduce((a, x) => a + x.inTokens, 0),
        outTokens: perCase.reduce((a, x) => a + x.outTokens, 0),
        costUsd: perCase.reduce((a, x) => a + x.costUsd, 0),
        failedCount: perCase.filter((x) => x.failed).length, // calls that errored (scored 0)
        ms: Date.now() - t0, cases: perCase,
      };
      collected.push(step);
      send({ type: 'step', step });
    }
    // Persist the completed run so it can be compared against other models later.
    const id = randomUUID();
    db.prepare('INSERT INTO experiment_runs (id, created_at, provider, model, runs, case_count, case_ids, steps) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, new Date().toISOString(), model.provider, model.model, runs, cases.length, JSON.stringify(cases.map((c) => c.id)), JSON.stringify(collected));
    send({ type: 'done', id, caseCount: cases.length, runs, model });
    res.end();
  } catch (err) {
    console.error('Experiment error:', err);
    send({ type: 'error', error: friendlyExperimentError(err), fatal: isFatalLlmError(err) });
    res.end();
  }
});

// Saved experiment runs — for comparing the same cases/layers across models.
router.get('/impact/experiments', (req, res) => {
  const rows = db.prepare('SELECT id, created_at, provider, model, runs, case_count, steps FROM experiment_runs ORDER BY created_at DESC').all();
  res.json(rows.map((r) => {
    const steps = JSON.parse(r.steps);
    const last = steps[steps.length - 1] || {};
    return {
      id: r.id, createdAt: r.created_at, provider: r.provider, model: r.model,
      runs: r.runs, caseCount: r.case_count, steps,
      finalRecall: last.recall ?? null, finalPrecision: last.precision ?? null,
      // Measured totals across all layers (the real cost of the whole run).
      totalInTokens: steps.reduce((a, s) => a + (s.inTokens || 0), 0),
      totalOutTokens: steps.reduce((a, s) => a + (s.outTokens || 0), 0),
      totalCostUsd: steps.reduce((a, s) => a + (s.costUsd || 0), 0),
      totalMs: steps.reduce((a, s) => a + (s.ms || 0), 0),
      peakRecall: steps.reduce((m, s) => Math.max(m, s.recall ?? 0), 0),
    };
  }));
});

router.delete('/impact/experiments/:id', (req, res) => {
  db.prepare('DELETE FROM experiment_runs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Memoization cache — inspect + clear, to demo cache-hit ($0/instant) vs miss.
router.get('/impact/cache', (req, res) => res.json({ count: impactCacheCount() }));
router.delete('/impact/cache', (req, res) => res.json({ cleared: clearImpactCache(), count: 0 }));

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
