// Demo seed for the context-engineering experiment.
//
// Populates the otherwise-empty layers (feature flags, incidents, observability /
// design docs) with data attached to stations that have NO other signal — so each
// layer becomes the *sole* clue for one paired eval case. Run the experiment over
// the full set and every rung (APIs → Services → Flags → Incidents → Traces → Docs)
// should add recall, instead of the empty layers being flat no-ops.
//
// Everything is marked with a `seed-` id prefix (flags also `source='seed'`) so it
// is fully reversible:  node scripts/seedLayers.js --clear
//
//   node scripts/seedLayers.js          # seed (idempotent: clears its own rows first)
//   node scripts/seedLayers.js --clear  # remove everything this script added

import { randomUUID } from 'node:crypto';
import db from '../db.js';

const NOW = new Date().toISOString();

// Resolve a station label → every (session_id, station_id) it maps to, by reading
// the stored session results. Enrichment on any one mapping shows up on the
// aggregated station, so we attach to the first match.
function mappingsByLabel() {
  const rows = db.prepare('SELECT id, result FROM sessions').all();
  const map = new Map(); // label → [{ sessionId, stationId }]
  for (const r of rows) {
    let result;
    try { result = JSON.parse(r.result); } catch { continue; }
    for (const st of result.stations || []) {
      if (!map.has(st.label)) map.set(st.label, []);
      map.get(st.label).push({ sessionId: r.id, stationId: st.id });
    }
  }
  return map;
}

function firstMapping(map, label) {
  const m = map.get(label);
  if (!m || !m.length) { console.warn(`  ⚠ station not found, skipping: "${label}"`); return null; }
  return m[0];
}

// ---- what to seed: each entry targets a station with no other signal ----
// (verified against the current data dump: these stations have no apis / services /
//  traces, so the named layer is the only way to reach them)
// NOTE on discrimination: the change text in each paired case references an OPAQUE
// token (flag key / incident id / RFC number) that appears ONLY in that layer's
// data and in NO station label. So the bare-journey baseline can't shortcut from
// the label — the layer is the only bridge from change → station.
const FLAGS = [
  { label: 'Open Comment Modal', name: 'exp-rce-1142', enabled: 1, provider: 'LaunchDarkly',
    value: '"on"', rollout: '100%', description: 'Gated experiment exp-rce-1142' },
];
const INCIDENTS = [
  { label: 'Open Post Edit/Action Menu', severity: 'high', occurred_at: '2026-03-14',
    description: 'INC-2314: race condition in the action dispatch caused duplicate delete requests (2026-03-14 outage)' },
];
const OBSERVABILITY = [
  { label: 'Load Stories Feed', type: 'dashboard', label_text: 'Feed latency (Grafana)', url: 'https://grafana.internal/d/feed-latency' },
];
const STATION_DOCS = [
  { label: 'Open User Dropdown Menu', type: 'rfc', title: 'RFC-204: keyboard navigation & focus-trap a11y', url: 'https://docs.internal/rfc-204' },
];
const JOURNEY_DOCS = [
  { type: 'prd', title: 'Instaverse Journey PRD v3', url: 'https://docs.internal/prd-v3' },
];

// Paired eval cases — each solvable ONLY once its layer is present, because the
// change names an opaque token (exp-rce-1142 / INC-2314 / RFC-204) that lives only
// in the layer data, never in a station label.
const EVAL_CASES = [
  { id: 'seed-eval-flags', name: '[seed] flag sunset · exp-rce-1142 (flags)',
    change: 'Sunset feature flag exp-rce-1142 and delete the code path it gates.',
    expected: ['Open Comment Modal'] },
  { id: 'seed-eval-incidents', name: '[seed] ship fix for INC-2314 (incidents)',
    change: 'Ship the root-cause fix for incident INC-2314.',
    expected: ['Open Post Edit/Action Menu'] },
  { id: 'seed-eval-docs', name: '[seed] implement RFC-204 (docs)',
    change: 'Implement the changes specified in RFC-204.',
    expected: ['Open User Dropdown Menu'] },
];

function clear() {
  const tables = ['feature_flags', 'incidents', 'observability', 'station_docs', 'journey_docs'];
  let n = 0;
  for (const t of tables) n += db.prepare(`DELETE FROM ${t} WHERE id LIKE 'seed-%'`).run().changes;
  for (const c of EVAL_CASES) {
    db.prepare('DELETE FROM eval_runs WHERE case_id = ?').run(c.id);
    n += db.prepare('DELETE FROM eval_cases WHERE id = ?').run(c.id).changes;
  }
  console.log(`Cleared ${n} seeded row(s).`);
}

function seed() {
  clear(); // idempotent
  const map = mappingsByLabel();
  const sid = () => `seed-${randomUUID()}`;
  let n = 0;

  for (const f of FLAGS) {
    const m = firstMapping(map, f.label); if (!m) continue;
    db.prepare(`INSERT INTO feature_flags (id, session_id, station_id, name, enabled, rollout, description, source, scope, provider, value)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'seed', 'station', ?, ?)`)
      .run(sid(), m.sessionId, m.stationId, f.name, f.enabled, f.rollout, f.description, f.provider, f.value);
    n++;
  }
  for (const i of INCIDENTS) {
    const m = firstMapping(map, i.label); if (!m) continue;
    db.prepare('INSERT INTO incidents (id, session_id, station_id, description, occurred_at, severity) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sid(), m.sessionId, m.stationId, i.description, i.occurred_at, i.severity);
    n++;
  }
  for (const o of OBSERVABILITY) {
    const m = firstMapping(map, o.label); if (!m) continue;
    db.prepare('INSERT INTO observability (id, session_id, station_id, type, label, url) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sid(), m.sessionId, m.stationId, o.type, o.label_text, o.url);
    n++;
  }
  for (const d of STATION_DOCS) {
    const m = firstMapping(map, d.label); if (!m) continue;
    db.prepare('INSERT INTO station_docs (id, session_id, station_id, type, title, url, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(sid(), m.sessionId, m.stationId, d.type, d.title, d.url, NOW, NOW);
    n++;
  }
  for (const j of JOURNEY_DOCS) {
    db.prepare('INSERT INTO journey_docs (id, type, title, url, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sid(), j.type, j.title, j.url, NOW, NOW);
    n++;
  }
  for (const c of EVAL_CASES) {
    db.prepare('INSERT INTO eval_cases (id, name, change_text, expected, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(c.id, c.name, c.change, JSON.stringify(c.expected), NOW);
    n++;
  }
  console.log(`Seeded ${n} row(s): ${FLAGS.length} flag · ${INCIDENTS.length} incident · ${OBSERVABILITY.length} observability · ${STATION_DOCS.length} doc · ${JOURNEY_DOCS.length} journey-doc · ${EVAL_CASES.length} eval cases.`);
}

if (process.argv.includes('--clear')) clear();
else seed();
