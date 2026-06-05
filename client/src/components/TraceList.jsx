import { useState, useEffect, useRef } from 'react';

// Stable-ish color per service name (waterfall bars).
const PALETTE = ['#6366F1', '#10B981', '#F59E0B', '#3B82F6', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];
function serviceColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function fmtMs(ms) {
  if (ms == null) return '—';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[idx];
}

// Order spans depth-first by start time and tag each with a depth for indentation.
function layoutSpans(spans) {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const children = new Map();
  const roots = [];
  for (const s of spans) {
    const parent = s.parentSpanId && byId.has(s.parentSpanId) ? s.parentSpanId : null;
    if (parent) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(s);
    } else {
      roots.push(s);
    }
  }
  const byStart = (a, b) => (a.startMs ?? 0) - (b.startMs ?? 0);
  const ordered = [];
  const walk = (s, depth) => {
    ordered.push({ span: s, depth });
    (children.get(s.spanId) || []).sort(byStart).forEach((c) => walk(c, depth + 1));
  };
  roots.sort(byStart).forEach((r) => walk(r, 0));
  // include any orphans not reached
  for (const s of spans) if (!ordered.find((o) => o.span.spanId === s.spanId)) ordered.push({ span: s, depth: 0 });
  return ordered;
}

function Waterfall({ trace }) {
  const spans = trace.spans || [];
  const starts = spans.map((s) => s.startMs).filter((v) => v != null);
  const t0 = starts.length ? Math.min(...starts) : 0;
  const total = trace.durationMs || Math.max(1, ...spans.map((s) => (s.startMs ?? 0) + (s.durationMs ?? 0) - t0));
  const rows = layoutSpans(spans);

  return (
    <div className="space-y-1">
      {rows.map(({ span, depth }, i) => {
        const left = total ? ((((span.startMs ?? t0) - t0)) / total) * 100 : 0;
        const width = total ? Math.max(0.75, ((span.durationMs ?? 0) / total) * 100) : 0;
        const color = span.status === 'error' ? '#EF4444' : serviceColor(span.service);
        return (
          <div key={span.spanId ?? i} className="flex items-center gap-2 text-xs">
            <div className="w-40 shrink-0 truncate text-gray-600 dark:text-gray-400" style={{ paddingLeft: depth * 10 }} title={`${span.name} · ${span.service}`}>
              <span className="text-gray-300 dark:text-gray-600 mr-1">{depth > 0 ? '└' : ''}</span>{span.name}
            </div>
            <div className="relative flex-1 h-3.5 rounded bg-gray-100 dark:bg-gray-800">
              <div
                className="absolute top-0 h-3.5 rounded"
                style={{ left: `${Math.min(left, 99)}%`, width: `${Math.min(width, 100 - Math.min(left, 99))}%`, background: color }}
                title={`${span.service} · ${span.name}${span.status === 'error' ? ' · ERROR' : ''}`}
              />
            </div>
            <div className="w-14 shrink-0 text-right tabular-nums text-gray-400 dark:text-gray-500">{fmtMs(span.durationMs)}</div>
          </div>
        );
      })}
    </div>
  );
}

function TraceRow({ trace, onDelete }) {
  const [open, setOpen] = useState(false);
  const services = [...new Set((trace.spans || []).map((s) => s.service))];
  return (
    <div className={`border rounded-lg overflow-hidden ${trace.status === 'error' ? 'border-red-200 dark:border-red-500/30' : 'border-gray-100 dark:border-gray-800'}`}>
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" onClick={() => setOpen((v) => !v)}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${trace.status === 'error' ? 'bg-red-500' : 'bg-emerald-500'}`} />
        <span className="text-xs text-gray-700 dark:text-gray-300 font-mono truncate flex-1" title={trace.rootName}>{trace.rootName}</span>
        <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 hidden sm:inline">{trace.spanCount} span{trace.spanCount !== 1 ? 's' : ''} · {services.length} svc</span>
        <span className="text-xs font-semibold tabular-nums shrink-0 text-gray-600 dark:text-gray-300">{fmtMs(trace.durationMs)}</span>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-gray-300 hover:text-red-400 text-sm leading-none shrink-0 transition-colors" title="Remove">×</button>
        <span className="text-gray-300 text-xs">{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div className="border-t border-gray-100 dark:border-gray-800 px-3 py-3 bg-gray-50/50 dark:bg-gray-800/40">
          <Waterfall trace={trace} />
        </div>
      )}
    </div>
  );
}

export default function TraceList({ sessionId, stationId, apis = [], sessionMappings }) {
  // Aggregate / impact views span sessions (sessionMappings, no single sessionId);
  // single-session view has sessionId+stationId. Upload only when a single session.
  const isAggregate = !!sessionMappings;
  const effectiveMappings = sessionMappings ?? (sessionId && stationId ? [{ sessionId, stationId }] : null);
  const canUpload = !isAggregate && !!sessionId;

  const [traces, setTraces] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  useEffect(() => { fetchTraces(); }, [apis.join(','), sessionId, stationId, sessionMappings]);

  async function fetchTraces() {
    const calls = [];
    // Cross-session match by endpoint signature
    if (apis.length) {
      const query = apis.map((a) => encodeURIComponent(a)).join(',');
      calls.push(fetch(`/api/sessions/traces/by-endpoints?endpoints=${query}`).then((r) => (r.ok ? r.json() : [])));
    }
    // Direct: traces uploaded to this station in each mapped session (covers
    // traces whose endpoint signature doesn't line up with the station's APIs)
    for (const m of effectiveMappings ?? []) {
      calls.push(fetch(`/api/sessions/${m.sessionId}/traces?stationId=${m.stationId}`).then((r) => (r.ok ? r.json() : [])));
    }
    if (!calls.length) { setTraces([]); return; }
    const results = (await Promise.all(calls)).flat();
    const seen = new Set();
    setTraces(results.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true))));
  }

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      const data = JSON.parse(await file.text());
      const res = await fetch(`/api/sessions/${sessionId}/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationId, data }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
      await fetchTraces();
    } catch (err) {
      setError(err.message === 'Upload failed' ? err.message : `Invalid trace file — ${err.message}`);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleDelete(trace) {
    await fetch(`/api/sessions/${trace.sessionId}/traces/${trace.id}`, { method: 'DELETE' });
    setTraces((prev) => prev.filter((t) => t.id !== trace.id));
  }

  if (!effectiveMappings?.length && !apis.length) return null;

  // Per-station performance metrics from the matched traces.
  const durs = traces.map((t) => t.durationMs).filter((v) => v != null).sort((a, b) => a - b);
  const errors = traces.filter((t) => t.status === 'error').length;
  const metrics = durs.length
    ? { p50: percentile(durs, 50), p95: percentile(durs, 95), errRate: Math.round((errors / traces.length) * 100) }
    : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
          Traces {traces.length > 0 && `(${traces.length})`}
        </p>
        {canUpload && (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="text-xs text-emerald-500 hover:text-emerald-700 font-medium disabled:opacity-40 transition-colors"
          >
            {uploading ? 'Uploading…' : '+ Add trace'}
          </button>
        )}
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={handleUpload} />
      </div>

      {metrics && (
        <div className="flex items-center gap-4 mb-2.5 text-xs">
          <Metric label="p50" value={fmtMs(metrics.p50)} />
          <Metric label="p95" value={fmtMs(metrics.p95)} />
          <Metric label="errors" value={`${metrics.errRate}%`} danger={metrics.errRate > 0} />
          <span className="text-gray-300 dark:text-gray-600 tabular-nums">n={traces.length}</span>
        </div>
      )}

      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

      {traces.length === 0 ? (
        <p className="text-xs text-gray-300 italic">
          No traces for this station.{canUpload ? ' Upload an OTLP or Jaeger JSON export to see the distributed trace.' : ''}
        </p>
      ) : (
        <div className="space-y-1.5">
          {traces.map((t) => <TraceRow key={t.id} trace={t} onDelete={() => handleDelete(t)} />)}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, danger }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-gray-400 dark:text-gray-500">{label}</span>
      <span className={`font-semibold tabular-nums ${danger ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}`}>{value}</span>
    </span>
  );
}
