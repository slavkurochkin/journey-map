import { useState, useEffect } from 'react';

const TYPE_LABEL = {
  'unit-frontend': 'Unit FE',
  'integration':   'Integ',
  'contract':      'Contract',
  'e2e':           'E2E',
};

const STATUS = {
  covered: { sym: '✓', cls: 'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300 border-green-200 dark:border-green-500/30' },
  partial: { sym: '~', cls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30' },
  none:    { sym: '✕', cls: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30' },
};

// Read-only coverage view for the station detail panel.
// Editing lives in the Testing card's coverage matrix.
export default function CoverageBadges({ sessionId, stationId, sessionMappings }) {
  const effectiveMappings = sessionMappings ?? (sessionId ? [{ sessionId, stationId }] : null);
  const [coverage, setCoverage] = useState({}); // type → best status

  useEffect(() => {
    if (effectiveMappings?.length) fetchCoverage();
  }, [sessionId, stationId, sessionMappings]);

  async function fetchCoverage() {
    const rank = { covered: 2, partial: 1, none: 0 };
    const results = await Promise.all(
      effectiveMappings.map(({ sessionId: sid, stationId: stId }) =>
        fetch(`/api/sessions/${sid}/coverage?stationId=${stId}`).then((r) => (r.ok ? r.json() : []))
      )
    );
    const best = {};
    for (const c of results.flat()) {
      if (!best[c.type] || (rank[c.status] ?? 0) > (rank[best[c.type]] ?? 0)) best[c.type] = c.status;
    }
    setCoverage(best);
  }

  const entries = Object.entries(coverage);
  if (!effectiveMappings?.length || entries.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Test Coverage</p>
      <div className="flex flex-wrap gap-1.5">
        {entries.map(([type, status]) => {
          const s = STATUS[status] ?? STATUS.none;
          return (
            <span key={type} className={`inline-flex items-center gap-1 text-xs border px-2 py-1 rounded-full ${s.cls}`}>
              <span className="font-bold">{s.sym}</span>
              {TYPE_LABEL[type] ?? type}
            </span>
          );
        })}
      </div>
    </div>
  );
}
