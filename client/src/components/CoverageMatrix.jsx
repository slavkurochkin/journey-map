import { useState, useEffect } from 'react';
import InfoIcon from './InfoIcon.jsx';

// Journey/station-scoped test types. Service unit coverage lives on each
// service in the station detail panel, since a station can touch many services.
const TYPES = [
  { value: 'unit-frontend', short: 'Unit FE' },
  { value: 'integration',   short: 'Integ' },
  { value: 'contract',      short: 'Contract' },
  { value: 'e2e',           short: 'E2E' },
];

// Click cycles through these states (undefined = not set)
const CYCLE = [undefined, 'covered', 'partial', 'none'];
const CELL = {
  undefined: { sym: '·', cls: 'text-gray-300 bg-gray-50 dark:bg-gray-800/40 hover:bg-gray-100 dark:hover:bg-gray-800' },
  covered:   { sym: '✓', cls: 'text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-500/20 hover:bg-green-200' },
  partial:   { sym: '~', cls: 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/20 hover:bg-amber-200' },
  none:      { sym: '✕', cls: 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-500/20 hover:bg-red-200' },
};

// Roll a station's services up into one status: all covered → covered,
// any covered/partial → partial, all none → none, no services → undefined.
function rollupServices(svcList) {
  if (!svcList?.length) return undefined;
  const statuses = svcList.map((s) => s.coverage || 'none');
  if (statuses.every((s) => s === 'covered')) return 'covered';
  if (statuses.some((s) => s === 'covered' || s === 'partial')) return 'partial';
  return 'none';
}

export default function CoverageMatrix({ sessionId, stations = [], svcVersion = 0 }) {
  // map[stationId][type] = status
  const [coverage, setCoverage] = useState({});
  // map[stationId] = [{ name, coverage }]
  const [services, setServices] = useState({});

  useEffect(() => {
    if (sessionId) {
      fetchCoverage();
      fetchServices();
    }
  }, [sessionId]);

  // Refetch the services rollup when service coverage changes elsewhere
  useEffect(() => {
    if (sessionId && svcVersion > 0) fetchServices();
  }, [svcVersion]);

  async function fetchCoverage() {
    const res = await fetch(`/api/sessions/${sessionId}/coverage`);
    if (!res.ok) return;
    const rows = await res.json();
    const map = {};
    for (const r of rows) {
      (map[r.stationId] ??= {})[r.type] = r.status;
    }
    setCoverage(map);
  }

  async function fetchServices() {
    const res = await fetch(`/api/sessions/${sessionId}/station-services`);
    if (!res.ok) return;
    const rows = await res.json();
    const map = {};
    for (const r of rows) {
      (map[r.stationId] ??= []).push({ name: r.name, coverage: r.coverage });
    }
    setServices(map);
  }

  async function cycle(stationId, type) {
    const current = coverage[stationId]?.[type];
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
    // optimistic update
    setCoverage((prev) => ({
      ...prev,
      [stationId]: { ...prev[stationId], [type]: next },
    }));
    await fetch(`/api/sessions/${sessionId}/coverage`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stationId, type, status: next ?? '' }),
    });
  }

  async function cycle(stationId, type) {
    const current = coverage[stationId]?.[type];
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
    // optimistic update
    setCoverage((prev) => ({
      ...prev,
      [stationId]: { ...prev[stationId], [type]: next },
    }));
    await fetch(`/api/sessions/${sessionId}/coverage`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stationId, type, status: next ?? '' }),
    });
  }

  if (!sessionId) {
    return <p className="text-xs text-gray-400 dark:text-gray-500 italic">Save the session to track test coverage.</p>;
  }

  // Per-type totals for the footer
  const totals = TYPES.map((t) => {
    let covered = 0, partial = 0;
    for (const st of stations) {
      const s = coverage[st.id]?.[t.value];
      if (s === 'covered') covered++;
      else if (s === 'partial') partial++;
    }
    return { covered, partial };
  });

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide pb-2 pr-3">Station</th>
              {TYPES.map((t) => (
                <th key={t.value} className="text-center font-medium text-gray-500 dark:text-gray-400 pb-2 px-1 whitespace-nowrap">{t.short}</th>
              ))}
              <th className="text-center font-medium text-gray-400 dark:text-gray-500 pb-2 px-1 whitespace-nowrap border-l border-gray-100 dark:border-gray-800">
                <span className="inline-flex items-center gap-1">
                  Services
                  <InfoIcon>
                    Read-only rollup of this station's services' unit-test coverage:
                    <span className="block mt-1.5"><span className="text-green-400 font-bold">✓</span> all services covered</span>
                    <span className="block"><span className="text-amber-400 font-bold">~</span> some covered or partial</span>
                    <span className="block"><span className="text-red-400 font-bold">✕</span> services exist, none covered</span>
                    <span className="block"><span className="text-gray-400 dark:text-gray-500 font-bold">·</span> no services attached</span>
                    <span className="block mt-1.5 text-gray-400 dark:text-gray-500">Edit per-service status in the station detail or the service table below.</span>
                  </InfoIcon>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {stations.map((st) => {
              const rollup = rollupServices(services[st.id]);
              const rollCell = CELL[rollup];
              const svcCount = services[st.id]?.length ?? 0;
              return (
                <tr key={st.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="py-1.5 pr-3 text-gray-700 dark:text-gray-300 font-medium">{st.label}</td>
                  {TYPES.map((t) => {
                    const status = coverage[st.id]?.[t.value];
                    const cell = CELL[status];
                    return (
                      <td key={t.value} className="text-center px-1 py-1">
                        <button
                          onClick={() => cycle(st.id, t.value)}
                          title={`${t.short}: ${status ?? 'not set'} (click to change)`}
                          className={`w-7 h-7 rounded font-bold transition-colors ${cell.cls}`}
                        >
                          {cell.sym}
                        </button>
                      </td>
                    );
                  })}
                  {/* Read-only services rollup (derived from per-service unit coverage) */}
                  <td className="text-center px-1 py-1 border-l border-gray-100 dark:border-gray-800">
                    <span
                      title={svcCount ? `${svcCount} service${svcCount !== 1 ? 's' : ''}: ${rollup} (edit in station detail)` : 'no services'}
                      className={`inline-flex items-center justify-center w-7 h-7 rounded font-bold cursor-default ${rollCell.cls.replace(/hover:[^ ]+/g, '')}`}
                    >
                      {rollCell.sym}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 dark:border-gray-700">
              <td className="pt-2 pr-3 text-xs text-gray-400 dark:text-gray-500">{stations.length} stations</td>
              {totals.map((tot, i) => (
                <td key={i} className="text-center pt-2 px-1 text-xs text-gray-500 dark:text-gray-400">
                  {tot.covered}/{stations.length}
                </td>
              ))}
              <td className="text-center pt-2 px-1 text-xs text-gray-400 dark:text-gray-500 border-l border-gray-100 dark:border-gray-800">
                {stations.filter((st) => rollupServices(services[st.id]) === 'covered').length}/{stations.length}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex gap-3 mt-3 text-xs text-gray-400 dark:text-gray-500">
        <span><span className="text-green-600 dark:text-green-400 font-bold">✓</span> covered</span>
        <span><span className="text-amber-600 dark:text-amber-400 font-bold">~</span> partial</span>
        <span><span className="text-red-500 font-bold">✕</span> none</span>
        <span><span className="text-gray-300 font-bold">·</span> not set</span>
      </div>
    </div>
  );
}
