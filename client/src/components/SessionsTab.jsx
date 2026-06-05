import { useState, useEffect, useRef } from 'react';
import SubwayMap from './SubwayMap.jsx';
import StationDetail from './StationDetail.jsx';
import Icon from './Icon.jsx';
import JourneyResult from './JourneyResult.jsx';

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function SessionsTab({ focusStation = null, onFocusConsumed }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [aggregate, setAggregate] = useState(null);
  const [loadingAggregate, setLoadingAggregate] = useState(false);
  const [selectedStation, setSelectedStation] = useState(null);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listOpen, setListOpen] = useState(false); // collapsed by default — map is the home
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [lens, setLens] = useState(null); // coverage overlay on the aggregate map
  const [pendingFocus, setPendingFocus] = useState(null); // station to focus once the map is loaded
  const [centerTarget, setCenterTarget] = useState(null); // { id, nonce } → tells SubwayMap to pan/zoom

  const PAGE = 30;

  const mapRef = useRef(null);

  // Fire immediately on mount, then debounce on search changes
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      fetchSessions(true);
      return;
    }
    const t = setTimeout(() => fetchSessions(true), 250);
    return () => clearTimeout(t);
  }, [search]);

  async function fetchSessions(reset) {
    const offset = reset ? 0 : sessions.length;
    reset ? setLoading(true) : setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`/api/sessions?${params}`);
      const data = await res.json();
      setTotal(data.total ?? 0);
      setSessions((prev) => (reset ? data.sessions : [...prev, ...data.sessions]));
      // Auto-open the aggregate map on the very first load when there's data
      if (reset && !search.trim() && (data.total ?? 0) > 0 && !aggregate && !selectedSession) handleAggregate();
    } finally {
      reset ? setLoading(false) : setLoadingMore(false);
    }
  }

  async function handleDelete(id, e) {
    e.stopPropagation();
    await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setTotal((t) => Math.max(0, t - 1));
    if (selectedSession?.id === id) setSelectedSession(null);
    if (aggregate) setAggregate(null);
  }

  function startRename(session, e) {
    e.stopPropagation();
    setEditingId(session.id);
    setEditTitle(session.title);
  }

  async function saveRename(id) {
    const title = editTitle.trim();
    setEditingId(null);
    if (!title) return;
    await fetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
    if (selectedSession?.id === id) {
      setSelectedSession((prev) => ({ ...prev, result: { ...prev.result, title } }));
    }
  }

  async function handleViewSession(id) {
    setLoadingSession(true);
    setAggregate(null);
    setSelectedStation(null);
    try {
      const res = await fetch(`/api/sessions/${id}`);
      setSelectedSession(await res.json());
    } finally {
      setLoadingSession(false);
    }
  }

  async function handleAggregate() {
    setLoadingAggregate(true);
    setSelectedSession(null);
    setSelectedStation(null);
    try {
      const res = await fetch('/api/sessions/aggregate/map');
      setAggregate(await res.json());
    } finally {
      setLoadingAggregate(false);
    }
  }

  // Refetch the aggregate after a station-identity change (merge/rename/color).
  // Keep the same station selected if it still exists (re-select by canonical key);
  // if it was merged away, close the panel.
  async function refreshAggregate() {
    const res = await fetch('/api/sessions/aggregate/map');
    if (!res.ok) return;
    const map = await res.json();
    setAggregate(map);
    setSelectedStation((prev) => {
      if (!prev?.canonicalKey) return null;
      return map?.stations?.find((s) => s.canonicalKey === prev.canonicalKey) ?? null;
    });
  }

  // A concern on the Impact tab asked us to highlight a station: show the
  // aggregate map (loading it if needed) and remember which station to focus.
  useEffect(() => {
    if (!focusStation) return;
    setSelectedSession(null);
    setPendingFocus(focusStation);
    if (!aggregate) handleAggregate();
    onFocusConsumed?.();
  }, [focusStation]);

  // Once the aggregate map is present, resolve the pending focus to a real
  // station, select it, and pan the viewport to it.
  useEffect(() => {
    if (!pendingFocus || !aggregate?.stations?.length) return;
    const norm = (s) => (s || '').toLowerCase().trim();
    const st = aggregate.stations.find((s) =>
      (pendingFocus.canonicalKey && s.canonicalKey === pendingFocus.canonicalKey) ||
      (pendingFocus.id && s.id === pendingFocus.id) ||
      (pendingFocus.label && norm(s.label) === norm(pendingFocus.label))
    );
    if (st) {
      setSelectedStation(st);
      setCenterTarget({ id: st.id, nonce: Date.now() });
      setTimeout(() => mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    }
    setPendingFocus(null);
  }, [pendingFocus, aggregate]);

  if (loading) {
    return <div className="text-center py-20 text-gray-400 dark:text-gray-500 text-sm">Loading sessions...</div>;
  }

  if (!sessions.length && !search.trim()) {
    return (
      <div className="text-center py-24">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 ring-1 ring-emerald-100 dark:ring-emerald-500/30 flex items-center justify-center mb-4">
          <Icon name="map" size={24} className="text-emerald-400" />
        </div>
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">No sessions yet</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 max-w-xs mx-auto">
          Record a journey, then analyze and save it — your app map and stats will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Session list — collapsible, searchable, scroll-capped */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3">
          <button
            onClick={() => setListOpen((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:text-gray-900 transition-colors"
          >
            <span className="text-gray-400 dark:text-gray-500 text-xs">{listOpen ? '▾' : '▸'}</span>
            {total} session{total !== 1 ? 's' : ''}
          </button>
          {total > 1 && (
            <button
              onClick={handleAggregate}
              disabled={loadingAggregate}
              className="text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 disabled:opacity-50 transition-colors shrink-0"
            >
              {loadingAggregate ? 'Aggregating...' : 'View aggregate map →'}
            </button>
          )}
        </div>

        {listOpen && (
          <>
            <div className="px-5 py-2 border-b border-gray-100 dark:border-gray-800">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search sessions…"
                className="w-full text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
              />
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800 overflow-y-auto" style={{ maxHeight: 360 }}>
              {sessions.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500 italic px-5 py-4">No sessions match “{search}”.</p>
              ) : sessions.map((session) => (
                <div
                  key={session.id}
                  className={`group flex items-center gap-4 px-5 py-3 transition-colors ${
                    editingId === session.id ? 'bg-emerald-50/50 dark:bg-emerald-500/10' : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800'
                  } ${selectedSession?.id === session.id ? 'bg-emerald-50 dark:bg-emerald-500/10' : ''}`}
                  onClick={() => editingId !== session.id && handleViewSession(session.id)}
                >
                  <div className="flex-1 min-w-0">
                    {editingId === session.id ? (
                      <input
                        autoFocus
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => saveRename(session.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveRename(session.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="w-full text-sm font-medium text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 border border-emerald-300 dark:border-emerald-500/40 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                      />
                    ) : (
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{session.title}</p>
                    )}
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{formatDate(session.timestamp)}</p>
                  </div>
                  {editingId !== session.id && (
                    <div className="flex items-center gap-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => startRename(session, e)}
                        className="text-xs text-gray-400 dark:text-gray-500 hover:text-emerald-600 transition-colors font-medium"
                      >
                        Rename
                      </button>
                      <button
                        onClick={(e) => handleDelete(session.id, e)}
                        className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors font-medium"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {sessions.length < total && (
                <button
                  onClick={() => fetchSessions(false)}
                  disabled={loadingMore}
                  className="w-full text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 py-2.5 transition-colors disabled:opacity-50"
                >
                  {loadingMore ? 'Loading…' : `Load more (${total - sessions.length} more)`}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Loading state for single session */}
      {loadingSession && (
        <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">Loading session...</div>
      )}

      {/* Single session detail */}
      {selectedSession && !loadingSession && (
        <div>
          <JourneyResult result={selectedSession.result} sessionId={selectedSession.id} />
        </div>
      )}

      {/* Aggregate map */}
      {aggregate && (
        <div ref={mapRef}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft overflow-hidden">
            <div className="px-6 pt-5 pb-3 flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Aggregate Journey Map</h3>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  {aggregate.sessionCount} sessions · edge thickness = visit frequency · click a station to explore
                </p>
              </div>
              <MapLensControls lens={lens} onChange={setLens} />
            </div>
            <SubwayMap
              stations={aggregate.stations}
              edges={aggregate.edges}
              selectedStation={selectedStation}
              onStationSelect={setSelectedStation}
              lens={lens}
              center={centerTarget}
            />
            {lens && <MapLensLegend lens={lens} />}
          </div>

          {selectedStation && (
            <StationDetail
              station={selectedStation}
              onClose={() => setSelectedStation(null)}
              aggregateStations={aggregate.stations}
              onIdentityChange={refreshAggregate}
            />
          )}
        </div>
      )}
    </div>
  );
}

const COVERAGE_LENSES = [
  { key: 'e2e', label: 'E2E' },
  { key: 'contract', label: 'Contract' },
  { key: 'integration', label: 'Integration' },
  { key: 'unit-frontend', label: 'Unit FE' },
  { key: 'service-unit', label: 'Service units' },
];

const RISK_LENSES = [
  { key: 'incidents', label: 'Past incidents' },
  { key: 'missing-docs', label: 'Missing docs' },
  { key: 'stale-docs', label: 'Stale docs' },
  { key: 'feature-flags', label: 'Feature flags' },
  { key: 'no-observability', label: 'No observability' },
];

const LENS_LABELS = Object.fromEntries([...COVERAGE_LENSES, ...RISK_LENSES].map((l) => [l.key, l.label]));
const COVERAGE_KEYS = new Set(COVERAGE_LENSES.map((l) => l.key));
const RISK_KEYS = new Set(RISK_LENSES.map((l) => l.key));

const SELECT_CLASS =
  'text-xs font-medium text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg pl-2.5 pr-7 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/50 cursor-pointer';

function MapLensControls({ lens, onChange }) {
  const coverageValue = lens && COVERAGE_KEYS.has(lens) ? lens : '';
  const riskValue = lens && RISK_KEYS.has(lens) ? lens : '';

  return (
    <div className="flex items-center gap-2 flex-wrap shrink-0">
      <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        Coverage
        <select
          value={coverageValue}
          onChange={(e) => onChange(e.target.value || null)}
          className={SELECT_CLASS}
        >
          <option value="">None</option>
          {COVERAGE_LENSES.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        Risk & gaps
        <select
          value={riskValue}
          onChange={(e) => onChange(e.target.value || null)}
          className={SELECT_CLASS}
        >
          <option value="">None</option>
          {RISK_LENSES.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function LegendItem({ color, label, dimmed }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
      {label}
      {dimmed && <span className="text-gray-300 dark:text-gray-600">(dimmed)</span>}
    </span>
  );
}

function MapLensLegend({ lens }) {
  const coverageLegend = (
    <>
      <LegendItem color="#10B981" label="covered" />
      <LegendItem color="#F59E0B" label="partial" />
      <LegendItem color="#EF4444" label="not covered" />
      <LegendItem color="#CBD5E1" label="not set" dimmed />
    </>
  );

  const riskLegend = {
    incidents: (
      <>
        <LegendItem color="#EF4444" label="has past incidents" />
        <LegendItem color="#CBD5E1" label="none recorded" dimmed />
      </>
    ),
    'missing-docs': (
      <>
        <LegendItem color="#EF4444" label="no docs linked" />
        <LegendItem color="#CBD5E1" label="has docs" dimmed />
      </>
    ),
    'stale-docs': (
      <>
        <LegendItem color="#F59E0B" label="stale docs (6mo+)" />
        <LegendItem color="#CBD5E1" label="up to date / no docs" dimmed />
      </>
    ),
    'feature-flags': (
      <>
        <LegendItem color="#F59E0B" label="has flags" />
        <LegendItem color="#CBD5E1" label="none" dimmed />
      </>
    ),
    'no-observability': (
      <>
        <LegendItem color="#EF4444" label="no observability links" />
        <LegendItem color="#CBD5E1" label="has links" dimmed />
      </>
    ),
  };

  return (
    <div className="px-6 py-2.5 border-t border-gray-100 dark:border-gray-800 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
      <span className="font-medium text-gray-600 dark:text-gray-300">{LENS_LABELS[lens]}:</span>
      {COVERAGE_KEYS.has(lens) ? coverageLegend : riskLegend[lens]}
    </div>
  );
}
