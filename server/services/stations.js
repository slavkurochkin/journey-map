import db from '../db.js';
import { endpointKeyFromString } from './endpoints.js';
import { canonicalKey, safeId, applyActionOverrides } from './aggregate.js';

// Pure aggregation helpers live in aggregate.js; re-export for existing importers.
export { canonicalKey, safeId, aggregateResults } from './aggregate.js';

// Recorded flag values are stored as JSON ("streamlined", false, true …); the
// impact context reads better with the native value than a quoted string.
function safeParseValue(s) { try { return JSON.parse(s); } catch { return s; } }

// User corrections to the aggregate map (merge / rename / color / action edits),
// keyed by canonical key. The single source the map and impact analysis both read.
export function loadStationOverrides() {
  const rows = db.prepare('SELECT canonical_key, merged_into, custom_label, color, actions FROM station_overrides').all();
  const map = {};
  for (const r of rows) {
    let actions = null;
    if (r.actions) { try { actions = JSON.parse(r.actions); } catch { /* ignore malformed */ } }
    map[r.canonical_key] = { mergedInto: r.merged_into, customLabel: r.custom_label, color: r.color, actions };
  }
  return map;
}

// ---- DB-backed context for impact analysis ----

// Merge all sessions into distinct stations, each enriched with services/flags/
// observability/incidents/coverage/docs — the context for impact analysis.
export function gatherStationContext() {
  const sessions = db.prepare('SELECT id, result FROM sessions').all()
    .map((r) => ({ sessionId: r.id, result: JSON.parse(r.result) }));

  const stationMap = new Map();
  const idToKey = new Map();
  const edgeSet = new Set();
  const overrides = loadStationOverrides(); // so impact analysis honors map-level action edits

  sessions.forEach(({ sessionId, result }, idx) => {
    for (const st of result.stations) {
      const ck = canonicalKey(st);
      const sid = safeId(ck);
      idToKey.set(`${idx}:${st.id}`, sid);
      if (!stationMap.has(sid)) {
        stationMap.set(sid, {
          id: sid, canonicalKey: ck, label: st.label, domain: st.domain,
          actions: st.actions || [], apis: st.apis || [], _mappings: [],
        });
      }
      stationMap.get(sid)._mappings.push({ sessionId, stationId: st.id });
    }
    for (const e of result.edges) {
      const s = idToKey.get(`${idx}:${e.source}`);
      const t = idToKey.get(`${idx}:${e.target}`);
      if (s && t && s !== t) edgeSet.add(`${s}→${t}`);
    }
  });

  const svcStmt = db.prepare('SELECT name, coverage FROM station_services WHERE session_id = ? AND station_id = ?');
  // Per-station flags plus any session-scoped flags (active across the whole journey).
  const flagStmt = db.prepare("SELECT name, enabled, rollout, description, scope, provider, value FROM feature_flags WHERE session_id = ? AND (station_id = ? OR scope = 'session')");
  const obsStmt = db.prepare('SELECT type, label, url FROM observability WHERE session_id = ? AND station_id = ?');
  const incStmt = db.prepare('SELECT description, occurred_at, severity FROM incidents WHERE session_id = ? AND station_id = ?');
  const covStmt = db.prepare('SELECT type, status FROM test_coverage WHERE session_id = ? AND station_id = ?');
  const docStmt = db.prepare('SELECT type, title, updated_at FROM station_docs WHERE session_id = ? AND station_id = ?');
  const traceDirectStmt = db.prepare('SELECT id, duration_ms, status, spans FROM traces WHERE session_id = ? AND station_id = ?');
  const traceByEndpointStmt = db.prepare('SELECT id, duration_ms, status, spans FROM traces WHERE endpoint = ?');

  // Ground-truth facts from uploaded distributed traces: the services actually
  // touched, concrete downstream calls, p95 latency, and error rate. These turn
  // impact reasoning from "the model guessed" into "the trace proves it."
  function traceFactsFor(st) {
    const rows = new Map(); // dedupe by trace row id (direct + endpoint matches)
    for (const m of st._mappings) for (const r of traceDirectStmt.all(m.sessionId, m.stationId)) rows.set(r.id, r);
    for (const api of st.apis || []) for (const r of traceByEndpointStmt.all(endpointKeyFromString(api))) rows.set(r.id, r);
    const list = [...rows.values()];
    if (!list.length) return null;

    const services = new Set();
    const downstream = new Map(); // "service: operation" → count
    for (const r of list) {
      let spans;
      try { spans = JSON.parse(r.spans); } catch { continue; }
      for (const sp of spans) {
        if (sp.service) services.add(sp.service);
        const isDownstream = sp.kind === 'client' || sp.kind === 'producer' || /\b(db|sql|query|select|insert|update|fetch|http|grpc|rpc|call|publish|consume)\b/i.test(sp.name || '');
        if (isDownstream && sp.name) downstream.set(`${sp.service}: ${sp.name}`, (downstream.get(`${sp.service}: ${sp.name}`) || 0) + 1);
      }
    }
    const durs = list.map((r) => r.duration_ms).filter((v) => v != null).sort((a, b) => a - b);
    const errors = list.filter((r) => r.status === 'error').length;
    const p95 = durs.length ? durs[Math.min(durs.length - 1, Math.floor(0.95 * durs.length))] : null;
    return {
      traceCount: list.length,
      servicesObserved: [...services].slice(0, 12),
      downstreamCalls: [...downstream.keys()].slice(0, 6),
      p95Ms: p95 != null ? Math.round(p95) : null,
      errorRate: list.length ? Math.round((errors / list.length) * 100) : null,
    };
  }

  const stations = [...stationMap.values()].map((st) => {
    const serviceCov = new Map();
    const flags = [];
    const observability = [];
    const incidents = [];
    const docs = [];
    const coverage = new Map();
    const seenFlags = new Set();
    const rank = { covered: 2, partial: 1, none: 0 };
    for (const m of st._mappings) {
      for (const s of svcStmt.all(m.sessionId, m.stationId)) {
        const cur = serviceCov.get(s.name);
        if (cur === undefined || (rank[s.coverage] ?? -1) > (rank[cur] ?? -1)) serviceCov.set(s.name, s.coverage || null);
      }
      for (const f of flagStmt.all(m.sessionId, m.stationId)) {
        if (seenFlags.has(f.name.toLowerCase())) continue;
        seenFlags.add(f.name.toLowerCase());
        flags.push({ ...f, enabled: !!f.enabled, value: f.value != null ? safeParseValue(f.value) : undefined });
      }
      for (const o of obsStmt.all(m.sessionId, m.stationId)) observability.push(o);
      for (const inc of incStmt.all(m.sessionId, m.stationId)) {
        incidents.push({ description: inc.description, occurredAt: inc.occurred_at, severity: inc.severity });
      }
      for (const c of covStmt.all(m.sessionId, m.stationId)) {
        const cur = coverage.get(c.type);
        if (!cur || (rank[c.status] ?? 0) > (rank[cur] ?? 0)) coverage.set(c.type, c.status);
      }
      for (const d of docStmt.all(m.sessionId, m.stationId)) {
        docs.push({ type: d.type, title: d.title, updatedAt: d.updated_at });
      }
    }
    const traces = traceFactsFor(st);
    const { actions } = applyActionOverrides(st.actions, overrides[st.canonicalKey]?.actions);
    return {
      id: st.id, label: st.label, domain: st.domain, actions, apis: st.apis,
      services: [...serviceCov.entries()].map(([name, unitTestCoverage]) => ({ name, unitTestCoverage })),
      featureFlags: flags,
      observability,
      pastIncidents: incidents,
      testCoverage: Object.fromEntries(coverage),
      designDocs: docs,
      ...(traces ? { traces } : {}),
    };
  });

  const edges = [...edgeSet].map((k) => {
    const [source, target] = k.split('→');
    return { source, target };
  });

  const journeyDocs = db.prepare('SELECT type, title, updated_at FROM journey_docs ORDER BY rowid ASC').all()
    .map((d) => ({ type: d.type, title: d.title, updatedAt: d.updated_at }));

  return { stations, edges, journeyDocs };
}

// Rich per-station context for the test plan: APIs, services+coverage, real
// request/response samples (from auto-imported api_requests), incidents.
export function buildTestPlanContext(stationLabels) {
  const full = gatherStationContext().stations;
  const wanted = new Set(stationLabels.map((l) => l.toLowerCase().trim()));
  const chosen = wanted.size ? full.filter((s) => wanted.has(s.label.toLowerCase().trim())) : full;

  const trim = (b) => (typeof b === 'string' && b.length > 1500 ? b.slice(0, 1500) + '…' : b);

  return chosen.map((s) => {
    const samples = [];
    for (const api of s.apis || []) {
      const key = endpointKeyFromString(api);
      const rows = db.prepare('SELECT data FROM api_requests WHERE endpoint = ? LIMIT 2').all(key);
      for (const r of rows) {
        try {
          const d = JSON.parse(r.data);
          samples.push({
            endpoint: `${d.method} ${api.replace(/^\S+\s/, '')}`,
            status: d.status,
            requestBody: trim(d.requestBody),
            responseBody: trim(d.responseBody),
          });
        } catch { /* skip */ }
      }
    }
    return {
      station: s.label,
      apis: s.apis,
      services: s.services,
      testCoverage: s.testCoverage,
      pastIncidents: s.pastIncidents,
      sampleRequests: samples,
      ...(s.featureFlags?.length ? { featureFlags: s.featureFlags } : {}),
      ...(s.traces ? { traces: s.traces } : {}),
    };
  });
}
