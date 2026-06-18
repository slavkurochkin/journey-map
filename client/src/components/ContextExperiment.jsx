import { useState, useEffect, Fragment } from 'react';

// Context-engineering experiment: run the eval set under a growing context stack
// (journey → +apis → +services → …) and show how recall/precision move as layers
// are added — alongside the context size each layer costs. Slice 1: results table.
function pct(v) { return v == null ? '—' : `${v}%`; }
function usd(v) { return v == null ? '—' : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`; }
function tok(v) { return (v || 0).toLocaleString(); }
// "Useful context" proxy: F1 quality per 1k context tokens. Falls as bloat is added —
// the measurable stand-in for the doc's Useful Context Rate.
function effOf(s) { return s.approxTokens ? Math.round((s.f1 * 1000 / s.approxTokens) * 10) / 10 : 0; }
function dur(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}
function deltaColor(d) {
  if (d > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (d < 0) return 'text-red-500 dark:text-red-400';
  return 'text-gray-400 dark:text-gray-500';
}
function Delta({ value }) {
  if (value == null) return null;
  const s = value > 0 ? `+${value}` : `${value}`;
  return <span className={`ml-1 text-[11px] tabular-nums ${deltaColor(value)}`}>{value === 0 ? '·' : s}</span>;
}

export default function ContextExperiment({ cases = [] }) {
  // Only cases with an expected set can be scored.
  const runnable = cases.filter((c) => (c.expected?.length ?? 0) > 0);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState([]);
  const [progress, setProgress] = useState(null); // { i, total, label }
  const [meta, setMeta] = useState(null);          // { caseCount }
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [showPicker, setShowPicker] = useState(false);
  const [runs, setRuns] = useState(1);
  const [mode, setMode] = useState('cumulative'); // 'cumulative' | 'ablation' (leave-one-out)
  const [expanded, setExpanded] = useState(null); // layer id whose per-case rows are open
  const [saved, setSaved] = useState([]);          // persisted runs (for cross-model compare)
  const [compareSel, setCompareSel] = useState(() => new Set());
  const [useCache, setUseCache] = useState(false); // demo: reuse memo cache (instant $0 on repeat)
  const [cacheCount, setCacheCount] = useState(null);

  async function fetchSaved() {
    try {
      const res = await fetch('/api/sessions/impact/experiments');
      if (res.ok) setSaved(await res.json());
    } catch { /* ignore */ }
  }
  async function fetchCache() {
    try {
      const res = await fetch('/api/sessions/impact/cache');
      if (res.ok) setCacheCount((await res.json()).count);
    } catch { /* ignore */ }
  }
  async function clearCache() {
    await fetch('/api/sessions/impact/cache', { method: 'DELETE' });
    fetchCache();
  }
  useEffect(() => { fetchSaved(); fetchCache(); }, []);

  async function deleteSaved(id) {
    await fetch(`/api/sessions/impact/experiments/${id}`, { method: 'DELETE' });
    setCompareSel((p) => { const n = new Set(p); n.delete(id); return n; });
    fetchSaved();
  }
  const toggleCompare = (id) => setCompareSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const compareRuns = saved.filter((r) => compareSel.has(r.id));

  // Default selection = all runnable cases; keep it in sync as cases load/change.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size) return new Set([...prev].filter((id) => runnable.some((c) => c.id === id)));
      return new Set(runnable.map((c) => c.id));
    });
  }, [cases]); // eslint-disable-line react-hooks/exhaustive-deps

  const allSelected = runnable.length > 0 && selected.size === runnable.length;
  const toggle = (id) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(runnable.map((c) => c.id)));

  async function run() {
    setRunning(true); setError(null); setSteps([]); setProgress(null);
    try {
      // Send the chosen subset; if all are selected, send none → server runs all.
      const caseIds = allSelected ? [] : [...selected];
      const res = await fetch('/api/sessions/impact/experiment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseIds, runs, useCache: useCache && runs === 1, mode }),
      });
      if (!res.ok && !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Experiment failed (${res.status})`);
      }
      // Stream NDJSON: one line per event, surfaced as it arrives.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line);
          if (evt.type === 'start') setMeta({ caseCount: evt.caseCount, runs: evt.runs, model: evt.model, mode: evt.mode });
          else if (evt.type === 'layer-start') setProgress({ i: evt.i, total: evt.total, label: evt.label });
          else if (evt.type === 'step') setSteps((prev) => [...prev, evt.step]);
          else if (evt.type === 'done') { fetchSaved(); fetchCache(); }
          else if (evt.type === 'error') setError(evt.error);
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Context experiment</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 max-w-xl">
            More context isn't better — you're hunting the signal-to-noise <em>sweet spot</em>: enough
            to answer well, not so much it buries the signal. This runs every eval case under a growing
            context stack (bare journey → one layer at a time) to find where added context stops helping
            and just costs tokens. Engine held constant (one-shot).{' '}
            <a
              href="https://github.com/slavkurochkin/journey-map/blob/main/docs/context-engineering.md"
              target="_blank" rel="noreferrer"
              className="text-emerald-600 dark:text-emerald-400 hover:underline"
            >Why →</a>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {runnable.length > 0 && (
            <button
              onClick={() => setShowPicker((v) => !v)}
              disabled={running}
              className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-40"
            >
              Cases {selected.size}/{runnable.length}
            </button>
          )}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            disabled={running}
            title="Cumulative: does adding context help? · Leave-one-out: which layers does the model actually rely on?"
            className="text-xs font-medium text-gray-500 dark:text-gray-400 bg-transparent border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 disabled:opacity-40"
          >
            <option value="cumulative">Cumulative</option>
            <option value="ablation">Leave-one-out</option>
            <option value="saturation">Saturation</option>
          </select>
          <select
            value={runs}
            onChange={(e) => setRuns(Number(e.target.value))}
            disabled={running}
            title="Average over N runs to smooth out model variance"
            className="text-xs font-medium text-gray-500 dark:text-gray-400 bg-transparent border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 disabled:opacity-40"
          >
            <option value={1}>1 run</option>
            <option value={3}>avg 3</option>
            <option value={5}>avg 5</option>
          </select>
          <button onClick={run} disabled={running || !selected.size} className="btn-primary py-1.5">
            {running ? 'Running…' : 'Run experiment'}
          </button>
        </div>
      </div>

      {/* Cache controls — demo memoization: hit ($0/instant) vs miss (real call) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-500 dark:text-gray-400">
        <label className={`flex items-center gap-1.5 cursor-pointer ${runs !== 1 ? 'opacity-40' : ''}`} title="Reuse cached results so a repeat run is an instant $0 cache-hit. Disabled when averaging (avg N forces real calls).">
          <input type="checkbox" checked={useCache && runs === 1} disabled={running || runs !== 1}
            onChange={(e) => setUseCache(e.target.checked)}
            className="rounded border-gray-300 dark:border-gray-600 text-emerald-600 focus:ring-emerald-500" />
          Use cache
        </label>
        <button onClick={clearCache} disabled={running || !cacheCount}
          className="text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-40 transition-colors">
          Clear cache{cacheCount != null ? ` (${cacheCount})` : ''}
        </button>
        <span className="text-gray-400 dark:text-gray-500">
          {useCache && runs === 1
            ? 'Repeat runs hit the cache — instant, $0, no variance.'
            : 'Every call is real — measured cost/time/variance.'}
        </span>
      </div>

      {!runnable.length && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 italic">Add at least one eval case with expected stations to run the experiment.</p>
      )}

      {showPicker && runnable.length > 0 && (
        <div className="mt-3 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Run over</p>
            <button onClick={toggleAll} className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 transition-colors">
              {allSelected ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {runnable.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                  className="rounded border-gray-300 dark:border-gray-600 text-emerald-600 focus:ring-emerald-500"
                />
                <span className="truncate">{c.name}</span>
                <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0">{c.expected.length} expected</span>
              </label>
            ))}
          </div>
        </div>
      )}
      {running && progress && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
            <span>Layer {progress.i}/{progress.total}: <span className="font-medium text-gray-700 dark:text-gray-300">{progress.label}</span> — {meta?.caseCount ?? selected.size} case{(meta?.caseCount ?? selected.size) !== 1 ? 's' : ''}…</span>
            <span className="tabular-nums">{steps.length}/{progress.total} done</span>
          </div>
          <div className="h-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${(steps.length / progress.total) * 100}%` }} />
          </div>
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-lg border border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          <span className="font-semibold">Run aborted:</span> {error}
        </div>
      )}

      {steps.some((s) => s.failedCount > 0) && (
        <div className="mt-3 rounded-lg border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <span className="font-semibold">⚠ Some calls failed and were scored 0</span> — a 0% on these layers is an API/infra failure, not model performance. Affected: {steps.filter((s) => s.failedCount > 0).map((s) => s.label.replace(/^\+ /, '')).join(', ')}.
        </div>
      )}

      {steps.length > 1 && meta?.mode === 'ablation' && <Attribution steps={steps} />}
      {steps.length > 1 && meta?.mode === 'saturation' && <SaturationCurve steps={steps} />}
      {steps.length > 1 && (!meta?.mode || meta.mode === 'cumulative') && <LayerCurve steps={steps} />}
      {steps.length > 1 && (!meta?.mode || meta.mode === 'cumulative') && <ContextSufficiency steps={steps} />}
      {steps.length > 1 && (!meta?.mode || meta.mode === 'cumulative') && <MarginalValue steps={steps} />}

      {steps.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 text-left">
                <th className="py-1.5 pr-4 font-semibold">Context</th>
                <th className="py-1.5 px-3 font-semibold text-right">Recall</th>
                <th className="py-1.5 px-3 font-semibold text-right">Precision</th>
                <th className="py-1.5 px-3 font-semibold text-right">F1</th>
                <th className="py-1.5 px-3 font-semibold text-right" title="F1 per 1k context tokens — quality per unit of context (a 'useful context' proxy). Falls as you over-context.">F1/1k</th>
                <th className="py-1.5 pl-3 font-semibold text-right">~Tokens</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {steps.map((s, i) => {
                const prev = i > 0 ? steps[i - 1] : null;
                const open = expanded === s.layer;
                return (
                  <Fragment key={s.layer}>
                    <tr
                      className="text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40"
                      onClick={() => setExpanded(open ? null : s.layer)}
                    >
                      <td className="py-1.5 pr-4 font-medium whitespace-nowrap">
                        <span className="text-gray-300 dark:text-gray-600 mr-1.5 inline-block w-2">{open ? '▾' : '▸'}</span>
                        {s.label}
                        {s.failedCount > 0 && <span className="ml-1.5 text-amber-500" title={`${s.failedCount} call(s) failed and were scored 0`}>⚠</span>}
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums">
                        {pct(s.recall)}<Delta value={prev ? s.recall - prev.recall : null} />
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums">
                        {pct(s.precision)}<Delta value={prev ? s.precision - prev.precision : null} />
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{pct(s.f1)}{s.f1Std > 0 && <span className="text-gray-400 dark:text-gray-500" title="run-to-run std-dev (lower = more consistent)"> ±{s.f1Std}</span>}</td>
                      <td className={`py-1.5 px-3 text-right tabular-nums ${effOf(s) === Math.max(...steps.map(effOf)) ? 'text-emerald-600 dark:text-emerald-400 font-medium' : ''}`} title="F1 per 1k context tokens">
                        {effOf(s)}
                      </td>
                      <td className="py-1.5 pl-3 text-right tabular-nums text-gray-400 dark:text-gray-500">
                        {s.approxTokens.toLocaleString()}
                      </td>
                    </tr>
                    {open && (s.cases || []).map((c) => {
                      const prevCase = prev?.cases?.find((x) => x.caseId === c.caseId);
                      return (
                        <tr key={c.caseId} className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50/60 dark:bg-gray-800/20">
                          <td className="py-1 pr-4 pl-6 truncate max-w-xs">
                            {c.name}
                            {c.failed && <span className="ml-1.5 text-amber-500" title="A model call failed to return valid JSON and was scored 0">⚠</span>}
                          </td>
                          <td className="py-1 px-3 text-right tabular-nums">
                            {pct(c.recall)}<Delta value={prevCase ? c.recall - prevCase.recall : null} />
                          </td>
                          <td className="py-1 px-3 text-right tabular-nums">{pct(c.precision)}</td>
                          <td className="py-1 px-3" />
                          <td className="py-1 px-3" />
                          <td className="py-1 pl-3" />
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-3">
            {meta?.model && <>Model <span className="font-medium text-gray-500 dark:text-gray-400">{meta.model.model}</span> ({meta.model.provider}). </>}
            Mean over {meta?.caseCount ?? steps[0]?.cases?.length} case{(meta?.caseCount ?? 1) !== 1 ? 's' : ''}
            {meta?.runs > 1 ? `, averaged over ${meta.runs} runs` : ''}.
            {' '}Measured cost <span className="font-medium text-gray-500 dark:text-gray-400">{usd(steps.reduce((a, s) => a + (s.costUsd || 0), 0))}</span> (out {tok(steps.reduce((a, s) => a + (s.outTokens || 0), 0))} tok)
            {' '}in <span className="font-medium text-gray-500 dark:text-gray-400">{dur(steps.reduce((a, s) => a + (s.ms || 0), 0))}</span>.
            {' '}Δ vs the previous layer. Click a row for the per-case breakdown.
            {' '}<span className="text-emerald-600 dark:text-emerald-400 font-medium">F1/1k</span> = F1 per 1k context tokens (quality per unit of context); it usually peaks <em>before</em> raw F1 — that's the over-context tax.
            Recall/precision score flagged station labels against each case's expected set — a proxy for reasoning quality.
          </p>
        </div>
      )}

      {/* Saved runs — compare across models */}
      {saved.length > 0 && (
        <div className="mt-5 border-t border-gray-100 dark:border-gray-800 pt-4">
          <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
            Saved runs <span className="normal-case font-normal">— tick 2+ to compare models</span>
          </p>
          <div className="space-y-1">
            {saved.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                <input type="checkbox" checked={compareSel.has(r.id)} onChange={() => toggleCompare(r.id)}
                  className="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500" />
                <span className="font-medium text-gray-700 dark:text-gray-200 truncate max-w-[14rem]">{r.model || 'unknown model'}</span>
                <span className="text-gray-400 dark:text-gray-500">{r.provider}</span>
                <span className="text-gray-400 dark:text-gray-500 tabular-nums">· {r.caseCount}c{r.runs > 1 ? `·avg${r.runs}` : ''}</span>
                <span className="text-gray-400 dark:text-gray-500 tabular-nums">· R{pct(r.finalRecall)}/P{pct(r.finalPrecision)}</span>
                <span className="text-gray-400 dark:text-gray-500 tabular-nums" title="measured total cost across all layers (input + output)">· {usd(r.totalCostUsd)}</span>
                <span className="text-gray-300 dark:text-gray-600 ml-auto">{new Date(r.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                <button onClick={() => deleteSaved(r.id)} className="text-gray-300 hover:text-red-400 transition-colors" title="Delete run">×</button>
              </div>
            ))}
          </div>
          {compareRuns.length >= 2 && <CompareView runs={compareRuns} />}
        </div>
      )}
    </div>
  );
}

// Side-by-side comparison of saved runs: overlaid recall curves + a per-layer table.
function CompareView({ runs }) {
  const COLORS = ['#10b981', '#6366f1', '#f59e0b', '#ec4899', '#06b6d4'];
  const labels = runs[0].steps.map((s) => s.label);
  const W = 1000, H = 190, padL = 36, padR = 18, padT = 16, padB = 32;
  const n = labels.length;
  const x = (i) => padL + (n === 1 ? 0 : (i * (W - padL - padR)) / (n - 1));
  const y = (v) => padT + (1 - v / 100) * (H - padT - padB);
  const path = (steps) => steps.map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(s.recall).toFixed(1)}`).join(' ');

  return (
    <div className="mt-4">
      <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Recall by layer — model comparison</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-1">
        {runs.map((r, i) => (
          <span key={r.id} className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
            <span className="inline-block w-3 h-0.5 rounded" style={{ background: COLORS[i % COLORS.length] }} />{r.model}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={padL} y1={y(g)} x2={W - padR} y2={y(g)} stroke="currentColor" className="text-gray-200 dark:text-gray-700" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <text x={padL - 6} y={y(g) + 3} textAnchor="end" className="fill-gray-400 dark:fill-gray-500" fontSize="10">{g}</text>
          </g>
        ))}
        {runs.map((r, ri) => (
          <g key={r.id}>
            <path d={path(r.steps)} fill="none" stroke={COLORS[ri % COLORS.length]} strokeWidth="1.75" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            {r.steps.map((s, i) => (
              <g key={i}>
                <circle cx={x(i)} cy={y(s.recall)} r="3.5" fill={COLORS[ri % COLORS.length]} />
                <circle cx={x(i)} cy={y(s.recall)} r="10" fill="transparent">
                  <title>{`${r.model} · ${shortLayer(s)}: recall ${s.recall}% / precision ${s.precision}% · out ${tok(s.outTokens)} tok · ${usd(s.costUsd)}`}</title>
                </circle>
              </g>
            ))}
          </g>
        ))}
        {runs[0].steps.map((st, i) => (
          <text key={i} x={x(i)} y={H - 10} textAnchor={i === 0 ? 'start' : i === runs[0].steps.length - 1 ? 'end' : 'middle'} className="fill-gray-400 dark:fill-gray-500" fontSize="11">
            {shortLayer(st)}
          </text>
        ))}
      </svg>

      <CompareSummary runs={runs} colors={COLORS} />

      <div className="overflow-x-auto mt-3">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 text-left">
              <th className="py-1 pr-3 font-semibold">Layer</th>
              <th className="py-1 px-2 font-semibold text-right">~Tokens</th>
              {runs.map((r, i) => (
                <th key={r.id} className="py-1 px-2 font-semibold text-right" style={{ color: COLORS[i % COLORS.length] }}>
                  {r.model?.split('-').slice(-2).join('-') || `run ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-gray-600 dark:text-gray-300">
            {labels.map((lab, i) => (
              <tr key={lab}>
                <td className="py-1 pr-3 whitespace-nowrap">{lab}</td>
                <td className="py-1 px-2 text-right tabular-nums text-gray-400 dark:text-gray-500">{(runs[0].steps[i]?.approxTokens || 0).toLocaleString()}</td>
                {runs.map((r) => (
                  <td key={r.id} className="py-1 px-2 text-right tabular-nums">{pct(r.steps[i]?.recall)}<span className="text-gray-300 dark:text-gray-600">/{pct(r.steps[i]?.precision)}</span></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">Each model cell: recall/precision at that layer. ~Tokens is the context size that layer adds — shared across models (same context, only the model differs).</p>
      </div>
    </div>
  );
}

// Headline + per-model summary: the bottom line of a comparison — who's most
// accurate, cheapest, fastest — across recall, measured cost, and wall-time.
function CompareSummary({ runs, colors }) {
  if (!runs.length) return null;
  const best = runs.reduce((a, b) => ((b.peakRecall ?? 0) > (a.peakRecall ?? 0) ? b : a));
  const cheap = runs.reduce((a, b) => ((b.totalCostUsd ?? Infinity) < (a.totalCostUsd ?? Infinity) ? b : a));
  const fast = runs.reduce((a, b) => ((b.totalMs ?? Infinity) < (a.totalMs ?? Infinity) ? b : a));
  return (
    <div className="mt-4">
      <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5">Summary</p>
      <p className="text-xs text-gray-600 dark:text-gray-300 mb-2">
        Best recall <b className="text-gray-800 dark:text-gray-100">{best.model}</b> ({pct(best.peakRecall)}) · cheapest{' '}
        <b className="text-gray-800 dark:text-gray-100">{cheap.model}</b> ({usd(cheap.totalCostUsd)}) · fastest{' '}
        <b className="text-gray-800 dark:text-gray-100">{fast.model}</b> ({dur(fast.totalMs)}).
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 text-left">
              <th className="py-1 pr-3 font-semibold">Model</th>
              <th className="py-1 px-2 font-semibold text-right">Final R/P</th>
              <th className="py-1 px-2 font-semibold text-right">Peak R</th>
              <th className="py-1 px-2 font-semibold text-right">Out tok</th>
              <th className="py-1 px-2 font-semibold text-right">Cost</th>
              <th className="py-1 px-2 font-semibold text-right">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-gray-600 dark:text-gray-300">
            {runs.map((r, i) => (
              <tr key={r.id}>
                <td className="py-1 pr-3 whitespace-nowrap font-medium" style={{ color: colors[i % colors.length] }}>{r.model}</td>
                <td className="py-1 px-2 text-right tabular-nums">{pct(r.finalRecall)}<span className="text-gray-300 dark:text-gray-600">/{pct(r.finalPrecision)}</span></td>
                <td className="py-1 px-2 text-right tabular-nums">{pct(r.peakRecall)}</td>
                <td className="py-1 px-2 text-right tabular-nums">{tok(r.totalOutTokens)}</td>
                <td className="py-1 px-2 text-right tabular-nums">{usd(r.totalCostUsd)}</td>
                <td className="py-1 px-2 text-right tabular-nums">{dur(r.totalMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Short axis labels keyed by layer id — full labels are too long for the chart and
// get truncated when the fixed-viewBox SVG scales up.
const SHORT_LAYER = { journey: 'Journey', apis: 'APIs', services: 'Services', flags: 'Flags', incidents: 'Incidents', traces: 'Traces', docs: 'Docs' };
const shortLayer = (s) => SHORT_LAYER[s.layer] || (s.label || '').replace(/^\+ /, '');

function f1Of(s) {
  const r = s.recall || 0, p = s.precision || 0;
  return r + p ? Math.round((2 * r * p) / (r + p)) : 0;
}

// Context sufficiency — the gradient scale, re-pointed at AMOUNT of context. Layers
// are placed left→right by how much context they add, with the F1 peak pinned to the
// green centre: left of it = too little context, right = too much (over-explaining).
// Dot size = F1 (bigger = better); the ★ dot is the sweet spot.
function ContextSufficiency({ steps }) {
  const gradient = 'linear-gradient(to right, #f59e0b 0%, #fcd34d 24%, #34d399 44%, #10b981 50%, #34d399 56%, #fcd34d 76%, #f59e0b 100%)';
  const n = steps.length;
  const f1s = steps.map(f1Of);
  const peakIdx = f1s.reduce((b, v, i) => (v > f1s[b] ? i : b), 0);
  const peakF1 = f1s[peakIdx];
  // Centre = 100% F1 (the ideal). A dot's distance from centre = how far below ideal
  // it is (higher F1 ⇒ closer to centre ⇒ better). Side = context amount: layers up to
  // the F1 peak sit left ("too little"), layers after it sit right ("too much").
  const posOf = (i) => {
    const offset = ((100 - f1s[i]) / 100) * 46; // 0 at perfect, ~46 at F1 0
    return i <= peakIdx ? 50 - offset : 50 + offset;
  };
  const pos = steps.map((_, i) => posOf(i));
  // Greedy row stacking so labels never overlap.
  const order = steps.map((_, i) => i).sort((a, b) => pos[a] - pos[b]);
  const rowLast = []; const rowOf = new Array(n); const GAP = 12;
  for (const i of order) { let r = rowLast.findIndex((p) => pos[i] - p >= GAP); if (r === -1) r = rowLast.length; rowLast[r] = pos[i]; rowOf[i] = r; }
  const rows = Math.max(1, rowLast.length); const rowH = 22;
  const color = (i) => (f1s[i] >= peakF1 - 5 ? '#10b981' : '#f59e0b'); // green at/near the best

  let verdict, tone;
  if (peakIdx === n - 1) {
    verdict = `F1 is still climbing at the full stack (${shortLayer(steps[peakIdx])}, F1 ${peakF1}) — no over-context yet; more context is still paying off.`;
    tone = 'emerald';
  } else if (peakIdx === 0) {
    verdict = `The bare ${shortLayer(steps[0])} already scores best (F1 ${peakF1}). Every added layer only costs tokens/noise — you're over-explaining.`;
    tone = 'amber';
  } else {
    const extraTok = (steps[n - 1].approxTokens || 0) - (steps[peakIdx].approxTokens || 0);
    const endDelta = f1s[n - 1] - peakF1;
    verdict = `Sweet spot: ${shortLayer(steps[peakIdx])} (F1 ${peakF1}). Left of it = too little context; the full stack then adds ~${extraTok.toLocaleString()} tokens for ${endDelta >= 0 ? '+' : ''}${endDelta} F1 — over-context.`;
    tone = 'emerald';
  }

  return (
    <div className="mt-5">
      <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">
        Context sufficiency — how much context is right
      </p>
      <div className="flex justify-between text-[10px] text-gray-400 dark:text-gray-500 mb-1">
        <span>Too little · under-context</span><span>Best F1 (100%)</span><span>Too much · over-context</span>
      </div>
      <div className="h-2 rounded-full" style={{ background: gradient }} />
      <div className="relative" style={{ height: rows * rowH + 6 }}>
        {steps.map((s, i) => {
          const dotTop = 4 + rowOf[i] * rowH;
          const size = 6 + (f1s[i] / 100) * 10; // dot diameter scales with F1 (quality)
          const dF1 = i > 0 ? f1s[i] - f1s[i - 1] : null;
          const dTok = i > 0 ? (s.approxTokens || 0) - (steps[i - 1].approxTokens || 0) : null;
          const zone = i === peakIdx ? 'just right — sweet spot ★' : i < peakIdx ? 'too little context' : 'too much context';
          const tipLines = [
            s.label,
            `F1 ${f1s[i]}%${s.f1Std > 0 ? ` ±${s.f1Std}` : ''}${dF1 != null ? `  (${dF1 >= 0 ? '+' : ''}${dF1} vs previous)` : ''}`,
            `Recall ${s.recall || 0}%  ·  Precision ${s.precision || 0}%`,
            `Context ~${(s.approxTokens || 0).toLocaleString()} tok${dTok != null ? ` (+${dTok.toLocaleString()})` : ''}`,
            `Efficiency ${effOf(s)} F1 per 1k tok`,
            s.costUsd ? `Cost ${usd(s.costUsd)}${s.ms ? `  ·  ${dur(s.ms)}` : ''}` : null,
            s.failed || s.failedCount ? '⚠ some calls failed (scored 0)' : null,
            `Verdict: ${zone}`,
          ].filter(Boolean);
          return (
            <Fragment key={s.layer}>
              <div className="absolute w-px bg-gray-200 dark:bg-gray-700" style={{ left: `${pos[i]}%`, top: 0, height: dotTop + 1 }} />
              <div
                className="group absolute -translate-x-1/2 flex flex-col items-center cursor-default"
                style={{ left: `${pos[i]}%`, top: dotTop }}
              >
                {/* hover card (instant, styled — replaces the flaky native title) */}
                <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-30 whitespace-nowrap rounded-lg bg-gray-900 dark:bg-gray-700 text-white px-2.5 py-1.5 shadow-lg pointer-events-none text-left text-[10px] leading-snug">
                  {tipLines.map((l, k) => (
                    <div key={k} className={k === 0 ? 'font-semibold mb-0.5' : 'text-gray-300'}>{l}</div>
                  ))}
                </div>
                <span className="rounded-full ring-2 ring-white dark:ring-gray-900 transition-transform group-hover:scale-125" style={{ width: size, height: size, background: color(i) }} />
                <span className="text-[9px] text-gray-500 dark:text-gray-400 whitespace-nowrap mt-0.5">{shortLayer(s)}{i === peakIdx ? ' ★' : ''}</span>
              </div>
            </Fragment>
          );
        })}
      </div>
      <p className={`text-xs mt-1 ${tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
        {verdict}
      </p>
      <p className="text-[10px] text-gray-400 dark:text-gray-500">
        Centre = ideal (100% F1). <span className="font-medium">Closer to centre = higher F1 = better.</span> Side = context amount: left of the ★ = too little, right = too much (more tokens, no gain). Dot size also tracks F1.
      </p>
    </div>
  );
}

// Marginal Context Value: what each ADDED layer bought — ΔF1 (diverging bar) and ROI
// (ΔF1 per 1k added tokens). Makes "which layers carry the value vs. are just noise"
// immediate, and is the marginal (not level) form of efficiency.
function MarginalValue({ steps }) {
  const rows = steps.slice(1).map((s, k) => {
    const prev = steps[k];
    const dF1 = s.f1 - prev.f1;
    const dTok = (s.approxTokens || 0) - (prev.approxTokens || 0);
    return { s, dF1, dTok, roi: dTok > 0 ? Math.round((dF1 / dTok) * 1000 * 10) / 10 : null };
  });
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.dF1)));
  return (
    <div className="mt-5">
      <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5">
        Marginal value — what each added layer bought
      </p>
      <div className="space-y-1">
        {rows.map(({ s, dF1, dTok, roi }) => (
          <div key={s.layer} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 truncate text-gray-600 dark:text-gray-300" title={s.label}>{shortLayer(s)}</span>
            <div className="relative flex-1 h-3 bg-gray-100 dark:bg-gray-800 rounded">
              <div className="absolute top-0 bottom-0 left-1/2 w-px bg-gray-300 dark:bg-gray-600" />
              <div
                className="absolute top-0 bottom-0 rounded"
                style={{
                  background: dF1 >= 0 ? '#10b981' : '#ef4444',
                  left: dF1 >= 0 ? '50%' : `${50 - (Math.abs(dF1) / maxAbs) * 48}%`,
                  width: `${(Math.abs(dF1) / maxAbs) * 48}%`,
                }}
              />
            </div>
            <span className="w-36 shrink-0 text-right tabular-nums">
              <span className={dF1 >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>{dF1 >= 0 ? '+' : ''}{dF1} F1</span>
              <span className="text-gray-400 dark:text-gray-500"> · {dTok >= 0 ? '+' : ''}{dTok.toLocaleString()} tok</span>
              {roi != null && <span className="text-gray-500 dark:text-gray-400"> · ROI {roi}</span>}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">
        ΔF1 vs the previous layer (bar right = added value, left = hurt) · ROI = ΔF1 per 1k added tokens. Near-zero bars are layers paying tokens for little/no gain.
      </p>
    </div>
  );
}

// Saturation curve: F1 vs context size as the full context is padded with irrelevant
// filler. The plateau (where F1 stops rising while tokens climb) is the over-context
// line — "past here you're paying for noise."
function SaturationCurve({ steps }) {
  const W = 1000, padL = 40, padR = 18, padT = 18, padB = 34, H = 200;
  const f1s = steps.map((s) => s.f1);
  const toks = steps.map((s) => s.approxTokens || 0);
  const minT = Math.min(...toks), maxT = Math.max(...toks, minT + 1);
  const x = (t) => padL + ((t - minT) / (maxT - minT)) * (W - padL - padR);
  const y = (v) => padT + (1 - v / 100) * (H - padT - padB);
  const path = steps.map((s, i) => `${i ? 'L' : 'M'} ${x(toks[i]).toFixed(1)} ${y(f1s[i]).toFixed(1)}`).join(' ');
  // Knee = first padding step whose F1 gain over the previous drops below 3 points.
  let knee = -1;
  for (let i = 1; i < steps.length; i++) { if (f1s[i] - f1s[i - 1] < 3) { knee = i; break; } }
  const verdict = knee > 0
    ? `F1 plateaus at ~${toks[knee].toLocaleString()} tokens (${steps[knee].label}). Beyond that, more context is wasted spend — quality flat, cost rising.`
    : `No plateau yet — F1 hasn't saturated even at ${steps[steps.length - 1]?.label || 'max padding'}.`;

  return (
    <div className="mt-5">
      <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">
        Saturation — F1 vs context size (full context + irrelevant padding)
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {knee > 0 && <rect x={x(toks[knee])} y={padT} width={W - padR - x(toks[knee])} height={H - padT - padB} fill="#f59e0b" opacity="0.07" />}
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={padL} y1={y(g)} x2={W - padR} y2={y(g)} stroke="currentColor" className="text-gray-200 dark:text-gray-700" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <text x={padL - 6} y={y(g) + 3} textAnchor="end" className="fill-gray-400 dark:fill-gray-500" fontSize="9">{g}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke="#10b981" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {steps.map((s, i) => (
          <g key={s.layer}>
            <circle cx={x(toks[i])} cy={y(f1s[i])} r={i === knee ? 5 : 3} fill="#10b981" className={i === knee ? 'stroke-white dark:stroke-gray-900' : ''} strokeWidth="2">
              <title>{`${s.label} · F1 ${f1s[i]}% · ~${toks[i].toLocaleString()} tok${s.costUsd ? ` · ${usd(s.costUsd)}` : ''}`}</title>
            </circle>
            <text x={x(toks[i])} y={H - 18} textAnchor="middle" className="fill-gray-500 dark:fill-gray-400" fontSize="9">{s.label.replace(' context', '')}</text>
            <text x={x(toks[i])} y={H - 7} textAnchor="middle" className="fill-gray-400 dark:fill-gray-500" fontSize="8">{(toks[i] / 1000).toFixed(1)}k</text>
          </g>
        ))}
        {knee > 0 && <text x={x(toks[knee])} y={padT - 5} textAnchor="middle" className="fill-amber-600 dark:fill-amber-400" fontSize="10" fontWeight="600">plateau</text>}
      </svg>
      <p className={`text-xs mt-1 ${knee > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{verdict}</p>
      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
        Starts at the full real context, then pads with irrelevant "reference material" to 2×/3×/5×/8× the tokens. A flat green line past the plateau = the over-context tax: paying for noise the model can't use.
      </p>
    </div>
  );
}

// Attribution (leave-one-out): F1 lost when each layer is removed from the full stack.
// The honest "did the model use it?" — measured by ablation, not self-report.
function Attribution({ steps }) {
  const base = steps.find((s) => s.layer === 'full') || steps[0];
  const rows = steps.filter((s) => s !== base).map((s) => {
    const contribution = (base.f1 || 0) - (s.f1 || 0); // F1 the layer adds (drop when removed)
    const tokCost = (base.approxTokens || 0) - (s.approxTokens || 0); // tokens the layer costs
    return { s, contribution, tokCost, roi: tokCost > 0 ? Math.round((contribution / tokCost) * 1000 * 10) / 10 : null };
  });
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.contribution)));
  return (
    <div className="mt-4">
      <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">
        Attribution — F1 lost when each layer is removed
      </p>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
        Baseline = full context (F1 <span className="font-medium">{base.f1}%</span>). Each bar = how much F1 drops without that layer — the layer's real contribution, by ablation.
      </p>
      <div className="space-y-1">
        {rows.map(({ s, contribution, tokCost, roi }) => (
          <div key={s.layer} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 truncate text-gray-600 dark:text-gray-300" title={s.label}>{shortLayer(s)}</span>
            <div className="relative flex-1 h-3 bg-gray-100 dark:bg-gray-800 rounded">
              <div className="absolute top-0 bottom-0 left-1/2 w-px bg-gray-300 dark:bg-gray-600" />
              <div
                className="absolute top-0 bottom-0 rounded"
                style={{
                  background: contribution >= 0 ? '#10b981' : '#ef4444',
                  left: contribution >= 0 ? '50%' : `${50 - (Math.abs(contribution) / maxAbs) * 48}%`,
                  width: `${(Math.abs(contribution) / maxAbs) * 48}%`,
                }}
              />
            </div>
            <span className="w-40 shrink-0 text-right tabular-nums">
              <span className={contribution > 0 ? 'text-emerald-600 dark:text-emerald-400' : contribution < 0 ? 'text-red-500' : 'text-gray-400'}>
                {contribution >= 0 ? '+' : ''}{contribution} F1
              </span>
              <span className="text-gray-400 dark:text-gray-500"> · {tokCost.toLocaleString()} tok</span>
              {roi != null && <span className="text-gray-500 dark:text-gray-400"> · ROI {roi}</span>}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">
        Big bar = the model genuinely relies on it · ~0 = noise (safe to drop, saves tokens) · <span className="text-red-500">red</span> = removing it <em>improved</em> F1 (the layer was hurting). ROI = F1 contributed per 1k tokens it costs.
      </p>
    </div>
  );
}

// Recall + precision vs the cumulative layer stack. x = layers (in order), y = 0–100%.
// Wide internal viewBox so the chart can fill the card width without the text/points
// scaling up on large screens.
function LayerCurve({ steps }) {
  const W = 1000, H = 190, padL = 36, padR = 18, padT = 16, padB = 32;
  const n = steps.length;
  const x = (i) => padL + (n === 1 ? 0 : (i * (W - padL - padR)) / (n - 1));
  const y = (v) => padT + (1 - v / 100) * (H - padT - padB);
  const path = (key) => steps.map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(s[key]).toFixed(1)}`).join(' ');
  const series = [
    { key: 'recall', color: '#10b981', label: 'Recall' },
    { key: 'precision', color: '#6366f1', label: 'Precision' },
  ];

  return (
    <div className="mt-4">
      <div className="flex items-center gap-4 mb-1">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
            <span className="inline-block w-3 h-0.5 rounded" style={{ background: s.color }} />{s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={padL} y1={y(g)} x2={W - padR} y2={y(g)} stroke="currentColor" className="text-gray-200 dark:text-gray-700" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <text x={padL - 6} y={y(g) + 3} textAnchor="end" className="fill-gray-400 dark:fill-gray-500" fontSize="10">{g}</text>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.key}>
            <path d={path(s.key)} fill="none" stroke={s.color} strokeWidth="1.75" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            {steps.map((st, i) => (
              <g key={i}>
                <circle cx={x(i)} cy={y(st[s.key])} r="3.5" fill={s.color} />
                <circle cx={x(i)} cy={y(st[s.key])} r="10" fill="transparent">
                  <title>{`${shortLayer(st)} · ${s.label} ${st[s.key]}%`}</title>
                </circle>
              </g>
            ))}
          </g>
        ))}
        {steps.map((st, i) => (
          <text key={i} x={x(i)} y={H - 10} textAnchor={i === 0 ? 'start' : i === steps.length - 1 ? 'end' : 'middle'} className="fill-gray-400 dark:fill-gray-500" fontSize="11">
            {shortLayer(st)}
          </text>
        ))}
      </svg>
    </div>
  );
}
