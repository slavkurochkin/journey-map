// Parse an uploaded trace export into normalized traces (a trace = its spans).
// Tolerant of three shapes:
//   1. OTLP/JSON   — { resourceSpans: [ { resource, scopeSpans: [ { spans: [...] } ] } ] }
//   2. Jaeger JSON — { data: [ { spans: [...], processes: {...} } ] }  (Jaeger UI export)
//   3. Plain JSON  — an array of spans, or { spans: [...] } with friendly fields
// so a hand-written sample, a real OTel export, or a Jaeger download all work.
import { endpointKey } from './endpoints.js';

// --- OTLP attribute helpers ---
function attrValue(v) {
  if (v == null) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('intValue' in v) return Number(v.intValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('boolValue' in v) return v.boolValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(attrValue);
  return undefined;
}
function attrsToMap(attributes = []) {
  const m = {};
  for (const a of attributes) m[a.key] = attrValue(a.value);
  return m;
}

// Jaeger tags are already plain {key, type, value}.
function tagsToMap(tags = []) {
  const m = {};
  for (const t of tags) m[t.key] = t.value;
  return m;
}

const KIND = {
  0: 'unspecified', 1: 'internal', 2: 'server', 3: 'client', 4: 'producer', 5: 'consumer',
  SPAN_KIND_INTERNAL: 'internal', SPAN_KIND_SERVER: 'server', SPAN_KIND_CLIENT: 'client',
  SPAN_KIND_PRODUCER: 'producer', SPAN_KIND_CONSUMER: 'consumer',
};
function normalizeKind(k) { return KIND[k] ?? (typeof k === 'string' ? k.toLowerCase() : 'internal'); }

const nanoToMs = (n) => (n == null ? null : Number(n) / 1e6);

// Accept epoch ms (number), ISO string, or nanostring.
function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (/^\d+$/.test(String(v))) return Number(v); // numeric string = epoch ms
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function isErrorStatus(code) {
  return code === 2 || code === 'STATUS_CODE_ERROR' || code === 'ERROR';
}

function normalizeOtlpSpans(data) {
  const out = [];
  const resourceSpans = data.resourceSpans || data.resource_spans || [];
  for (const rs of resourceSpans) {
    const resService = attrsToMap(rs.resource?.attributes)['service.name'];
    const scopeSpans = rs.scopeSpans || rs.scope_spans || rs.instrumentationLibrarySpans || [];
    for (const ss of scopeSpans) {
      for (const sp of ss.spans || []) {
        const a = attrsToMap(sp.attributes);
        const startMs = nanoToMs(sp.startTimeUnixNano ?? sp.start_time_unix_nano);
        const endMs = nanoToMs(sp.endTimeUnixNano ?? sp.end_time_unix_nano);
        out.push({
          traceId: sp.traceId ?? sp.trace_id ?? 'trace',
          spanId: sp.spanId ?? sp.span_id,
          parentSpanId: sp.parentSpanId ?? sp.parent_span_id ?? null,
          name: sp.name,
          service: a['service.name'] || resService || 'unknown',
          kind: normalizeKind(sp.kind),
          startMs,
          durationMs: startMs != null && endMs != null ? Math.max(0, endMs - startMs) : null,
          status: isErrorStatus(sp.status?.code) ? 'error' : 'ok',
          attributes: a,
        });
      }
    }
  }
  return out;
}

function normalizeSimpleSpans(arr) {
  return arr.map((sp) => {
    const startMs = toMs(sp.startMs ?? sp.start ?? sp.startTime ?? sp.timestamp);
    const dur = sp.durationMs ?? sp.duration ?? (sp.end != null && startMs != null ? toMs(sp.end) - startMs : null);
    return {
      traceId: sp.traceId ?? sp.trace_id ?? 'trace',
      spanId: sp.spanId ?? sp.id,
      parentSpanId: sp.parentSpanId ?? sp.parentId ?? sp.parent_span_id ?? null,
      name: sp.name,
      service: sp.service ?? sp.serviceName ?? sp.attributes?.['service.name'] ?? 'unknown',
      kind: normalizeKind(sp.kind ?? 'internal'),
      startMs,
      durationMs: dur != null ? Math.max(0, dur) : null,
      status: sp.status === 'error' || sp.error ? 'error' : 'ok',
      attributes: sp.attributes ?? {},
    };
  });
}

// Jaeger UI export: data[].spans[] with processes[] for service names, microsecond
// timestamps, and parent links in references[refType=CHILD_OF].
function normalizeJaegerSpans(payload) {
  const out = [];
  for (const tr of payload.data || []) {
    const procs = tr.processes || {};
    for (const sp of tr.spans || []) {
      const tags = tagsToMap(sp.tags);
      const proc = procs[sp.processID] || {};
      const parentRef = (sp.references || []).find((r) => r.refType === 'CHILD_OF' || r.refType === 'FOLLOWS_FROM');
      const statusCode = tags['otel.status_code'] || tags['status.code'];
      const httpStatus = Number(tags['http.status_code'] || tags['http.response.status_code']);
      const isError = tags.error === true || tags.error === 'true' || statusCode === 'ERROR' || (httpStatus >= 500);
      out.push({
        traceId: sp.traceID,
        spanId: sp.spanID,
        parentSpanId: parentRef?.spanID ?? null,
        name: sp.operationName,
        service: proc.serviceName || tags['service.name'] || 'unknown',
        kind: normalizeKind(tags['span.kind'] || 'internal'),
        startMs: sp.startTime != null ? sp.startTime / 1000 : null, // micros → ms
        durationMs: sp.duration != null ? sp.duration / 1000 : null, // micros → ms
        status: isError ? 'error' : 'ok',
        attributes: tags,
      });
    }
  }
  return out;
}

// Derive a "METHOD /path" endpoint signature from a span's HTTP attributes.
function endpointOfSpan(s) {
  const a = s?.attributes || {};
  const method = a['http.method'] || a['http.request.method'];
  const route = a['http.route'] || a['url.path'] || a['http.target'] || a['http.url'];
  return method && route ? endpointKey(method, route) : null;
}

function groupTraces(spans) {
  const byTrace = new Map();
  for (const s of spans) {
    if (!byTrace.has(s.traceId)) byTrace.set(s.traceId, []);
    byTrace.get(s.traceId).push(s);
  }

  const traces = [];
  for (const [traceId, ss] of byTrace) {
    const ids = new Set(ss.map((s) => s.spanId));
    const root =
      ss.find((s) => !s.parentSpanId || !ids.has(s.parentSpanId)) ||
      [...ss].sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0))[0];

    const starts = ss.map((s) => s.startMs).filter((v) => v != null);
    const ends = ss.map((s) => (s.startMs ?? 0) + (s.durationMs ?? 0)).filter((v) => v != null);
    const startMs = starts.length ? Math.min(...starts) : null;
    const endMs = ends.length ? Math.max(...ends) : null;
    const durationMs = root.durationMs != null ? root.durationMs : startMs != null && endMs != null ? endMs - startMs : null;

    // endpoint: prefer the root, then any server span, then any span with HTTP attrs
    const endpoint =
      endpointOfSpan(root) ||
      endpointOfSpan(ss.find((s) => s.kind === 'server')) ||
      ss.map(endpointOfSpan).find(Boolean) ||
      null;

    traces.push({
      traceId,
      rootName: root.name || '(root)',
      service: root.service,
      startMs,
      durationMs,
      status: ss.some((s) => s.status === 'error') ? 'error' : 'ok',
      spanCount: ss.length,
      endpoint,
      spans: ss,
    });
  }
  // newest-ish first by start time
  return traces.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
}

export function parseTraces(data) {
  let spans;
  if (data && Array.isArray(data.data) && data.data.some((t) => Array.isArray(t.spans))) spans = normalizeJaegerSpans(data);
  else if (data && (data.resourceSpans || data.resource_spans)) spans = normalizeOtlpSpans(data);
  else if (Array.isArray(data)) spans = normalizeSimpleSpans(data);
  else if (Array.isArray(data?.spans)) spans = normalizeSimpleSpans(data.spans);
  else throw new Error('Unrecognized trace format — expected OTLP JSON (resourceSpans), Jaeger JSON (data[].spans), or an array of spans');

  spans = spans.filter((s) => s.spanId && s.name);
  if (!spans.length) throw new Error('No spans found in trace data');
  return groupTraces(spans);
}
