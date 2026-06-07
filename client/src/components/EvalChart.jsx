import { useMemo, useState } from 'react';

// Group per-case runs into batches (a "Run all" shares a batch_id) and average
// recall/precision per batch — the suite trend over time.
function groupBatches(history) {
  const map = new Map();
  for (const h of history) {
    if (!map.has(h.batchId)) map.set(h.batchId, { createdAt: h.createdAt, recalls: [], precisions: [] });
    const b = map.get(h.batchId);
    b.recalls.push(h.recall ?? 0);
    b.precisions.push(h.precision ?? 0);
    if (h.createdAt < b.createdAt) b.createdAt = h.createdAt;
  }
  const mean = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  return [...map.values()]
    .map((b) => ({ createdAt: b.createdAt, recall: mean(b.recalls), precision: mean(b.precisions), n: b.recalls.length }))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Tiny inline recall-trend sparkline for a single case (red if trending down).
export function EvalSparkline({ runs }) {
  if (!runs || runs.length < 2) return null;
  const recalls = runs.map((r) => r.recall ?? 0);
  let lo = Math.min(...recalls), hi = Math.max(...recalls);
  if (hi === lo) { hi = Math.min(100, lo + 1); lo = Math.max(0, lo - 1); }
  const W = 64, H = 18, p = 2;
  const x = (i) => p + (i / (runs.length - 1)) * (W - 2 * p);
  const y = (v) => p + (1 - (v - lo) / (hi - lo)) * (H - 2 * p);
  const d = recalls.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const trend = recalls[recalls.length - 1] - recalls[0];
  const color = trend < 0 ? '#ef4444' : '#10b981';
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0">
      <title>{`recall ${recalls[0]}% → ${recalls[recalls.length - 1]}% over ${runs.length} runs`}</title>
      <path d={d} fill="none" stroke={color} strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
      <circle cx={x(runs.length - 1)} cy={y(recalls[recalls.length - 1])} r="1.5" fill={color} />
    </svg>
  );
}

export default function EvalChart({ history }) {
  const batches = useMemo(() => groupBatches(history || []), [history]);
  const [hover, setHover] = useState(null);

  if (batches.length < 2) {
    return <p className="text-xs text-gray-400 dark:text-gray-500 italic">Run the suite at least twice to see drift over time.</p>;
  }

  // Auto-scale the Y axis to the data range (padded) so small drifts are visible.
  const vals = batches.flatMap((b) => [b.recall, b.precision]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const padV = Math.max(3, (hi - lo) * 0.25);
  lo = Math.max(0, Math.floor(lo - padV));
  hi = Math.min(100, Math.ceil(hi + padV));
  if (hi - lo < 4) hi = Math.min(100, lo + 4);

  const W = 600, H = 60, padL = 16, padR = 6, padT = 7, padB = 7;
  const x = (i) => padL + (i / (batches.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const path = (key) => batches.map((b, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(b[key]).toFixed(1)}`).join(' ');

  const first = batches[0];
  const last = batches[batches.length - 1];
  const Delta = ({ k }) => {
    const d = last[k] - first[k];
    if (d === 0) return null;
    return <span className={d < 0 ? 'text-red-500' : 'text-emerald-500'}>{d > 0 ? '+' : ''}{d}</span>;
  };

  const hb = hover != null ? batches[hover] : null;

  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto' }}>
          {[hi, lo].map((g) => (
            <g key={g}>
              <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="#9ca3af" strokeOpacity="0.15" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <text x={0} y={y(g) + 2} fontSize="5.5" fill="#9ca3af">{g}</text>
            </g>
          ))}
          <path d={path('precision')} fill="none" stroke="#6366f1" strokeWidth="1" strokeDasharray="3 2" opacity="0.7" vectorEffect="non-scaling-stroke" />
          <path d={path('recall')} fill="none" stroke="#10b981" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {batches.map((b, i) => (
            <g key={i}>
              <circle cx={x(i)} cy={y(b.recall)} r={hover === i ? 2.4 : 1.4} fill="#10b981" />
              {/* larger transparent hover target */}
              <circle cx={x(i)} cy={y(b.recall)} r="7" fill="transparent" style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))} />
            </g>
          ))}
        </svg>

        {hb && (
          <div
            className="absolute z-10 pointer-events-none -translate-x-1/2 -translate-y-full -mt-2 px-2 py-1 rounded-md bg-gray-900 dark:bg-gray-700 text-white text-[10px] leading-tight whitespace-nowrap shadow-lg"
            style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(hb.recall) / H) * 100}%` }}
          >
            <div className="font-medium">{fmtDate(hb.createdAt)}</div>
            <div className="mt-0.5">
              <span className="text-emerald-300">recall {hb.recall}%</span>
              <span className="text-gray-400"> · </span>
              <span className="text-indigo-300">precision {hb.precision}%</span>
            </div>
            <div className="text-gray-400">{hb.n} case{hb.n !== 1 ? 's' : ''}</div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 text-[11px] mt-1 text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center gap-1">
          <span className="w-2.5 h-px bg-emerald-500 inline-block" /> recall
          <b className="text-gray-700 dark:text-gray-200 font-semibold">{last.recall}%</b> <Delta k="recall" />
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2.5 border-t border-dashed border-indigo-400 inline-block" /> precision
          <b className="text-gray-700 dark:text-gray-200 font-semibold">{last.precision}%</b> <Delta k="precision" />
        </span>
        <span className="ml-auto text-gray-400 dark:text-gray-500">{lo}–{hi}% · {batches.length} runs</span>
      </div>
    </div>
  );
}
