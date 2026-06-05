import { useState, useEffect } from 'react';

// Unit-test coverage cycles per service: unset → covered → partial → none → unset
const COV_CYCLE = [null, 'covered', 'partial', 'none'];
const COV = {
  null:      { sym: '·', title: 'unit coverage: not set', cls: 'text-gray-300' },
  covered:   { sym: '✓', title: 'unit coverage: covered', cls: 'text-green-600 dark:text-green-400' },
  partial:   { sym: '~', title: 'unit coverage: partial', cls: 'text-amber-500' },
  none:      { sym: '✕', title: 'unit coverage: none', cls: 'text-red-500' },
};

export default function ServiceList({ sessionId, stationId, sessionMappings, suggestions = [], apis = [], onChange }) {
  const isAggregate = !!sessionMappings;
  const effectiveMappings = sessionMappings ?? (sessionId ? [{ sessionId, stationId }] : null);
  const [dismissed, setDismissed] = useState([]); // suggestion names dismissed this view

  const [services, setServices] = useState([]); // [{ id, name, coverage, sessionId }]
  const [traceServices, setTraceServices] = useState([]); // service names observed in traces
  const [input, setInput] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (effectiveMappings?.length) fetchServices();
  }, [sessionId, stationId, sessionMappings]);

  // Observed services from uploaded traces (single-session editable view only).
  useEffect(() => {
    if (isAggregate || !sessionId || !stationId) { setTraceServices([]); return; }
    const params = new URLSearchParams({ sessionId, stationId });
    if (apis.length) params.set('endpoints', apis.map((a) => a).join(','));
    fetch(`/api/sessions/trace-services?${params}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setTraceServices)
      .catch(() => setTraceServices([]));
  }, [sessionId, stationId, apis.join(','), isAggregate, services.length]);

  async function fetchServices() {
    const results = await Promise.all(
      effectiveMappings.map(({ sessionId: sid, stationId: stId }) =>
        fetch(`/api/sessions/${sid}/services?stationId=${stId}`)
          .then((r) => (r.ok ? r.json() : []))
          .then((list) => list.map((s) => ({ ...s, sessionId: sid })))
      )
    );
    // Dedupe by name; in aggregate keep the best coverage seen
    const rank = { covered: 2, partial: 1, none: 0 };
    const byName = new Map();
    for (const s of results.flat()) {
      const key = s.name.toLowerCase();
      const cur = byName.get(key);
      if (!cur) byName.set(key, s);
      else if ((rank[s.coverage] ?? -1) > (rank[cur.coverage] ?? -1)) byName.set(key, s);
    }
    setServices([...byName.values()]);
  }

  async function handleAdd(e) {
    e.preventDefault();
    const name = input.trim();
    if (!name) return;
    setAdding(true);
    await fetch(`/api/sessions/${sessionId}/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stationId, name }),
    });
    setInput('');
    await fetchServices();
    setAdding(false);
    onChange?.();
  }

  async function cycleCoverage(svc) {
    const next = COV_CYCLE[(COV_CYCLE.indexOf(svc.coverage ?? null) + 1) % COV_CYCLE.length];
    setServices((prev) => prev.map((s) => (s.name === svc.name ? { ...s, coverage: next } : s)));
    // Set by service name so coverage stays consistent across the whole session
    await fetch(`/api/sessions/${svc.sessionId}/service-coverage`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: svc.name, coverage: next ?? '' }),
    });
    onChange?.();
  }

  async function handleRemove(service) {
    await fetch(`/api/sessions/${service.sessionId}/services/${service.id}`, { method: 'DELETE' });
    setServices((prev) => prev.filter((s) => s.id !== service.id));
    onChange?.();
  }

  async function confirmSuggestion(name) {
    await fetch(`/api/sessions/${sessionId}/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stationId, name }),
    });
    await fetchServices();
    onChange?.();
  }

  if (!effectiveMappings?.length) return null;

  // Suggestions not already added and not dismissed (editable single-session view only)
  const addedNames = new Set(services.map((s) => s.name.toLowerCase()));
  const pendingSuggestions = isAggregate ? [] : (suggestions || []).filter(
    (s) => !addedNames.has(s.toLowerCase()) && !dismissed.includes(s.toLowerCase())
  );

  // Services the traces prove this station calls but that aren't added yet (and
  // aren't already covered by the network-call suggestion above).
  const aiPending = new Set(pendingSuggestions.map((s) => s.toLowerCase()));
  const traceSuggestions = isAggregate ? [] : traceServices.filter(
    (s) => !addedNames.has(s.toLowerCase()) && !dismissed.includes(s.toLowerCase()) && !aiPending.has(s.toLowerCase())
  );

  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
        Services <span className="normal-case text-gray-300 font-normal">· unit coverage</span>
      </p>

      {services.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {services.map((svc) => {
            const cov = COV[svc.coverage ?? null] ?? COV.null;
            return (
              <span
                key={svc.id}
                className="inline-flex items-center gap-1.5 text-xs bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-500/30 px-2 py-1 rounded-full"
              >
                {/* unit-test coverage indicator */}
                <button
                  onClick={() => !isAggregate && cycleCoverage(svc)}
                  disabled={isAggregate}
                  title={isAggregate ? cov.title : `${cov.title} (click to change)`}
                  className={`font-bold ${cov.cls} ${isAggregate ? 'cursor-default' : 'cursor-pointer hover:opacity-70'}`}
                >
                  {cov.sym}
                </button>
                {svc.name}
                {!isAggregate && (
                  <button
                    onClick={() => handleRemove(svc)}
                    className="text-teal-400 hover:text-teal-700 ml-0.5 leading-none transition-colors"
                    title="Remove"
                  >×</button>
                )}
              </span>
            );
          })}
        </div>
      ) : (
        pendingSuggestions.length === 0 && traceSuggestions.length === 0 && (
          <p className="text-xs text-gray-300 italic mb-2">No services added for this station.</p>
        )
      )}

      {/* AI-suggested services — confirm to add, × to dismiss */}
      {pendingSuggestions.length > 0 && (
        <div className="mb-2">
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1">Suggested from network calls:</p>
          <div className="flex flex-wrap gap-1.5">
            {pendingSuggestions.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 text-xs text-teal-600 dark:text-teal-400 border border-dashed border-teal-300 bg-teal-50/40 dark:bg-teal-500/10 px-2 py-1 rounded-full"
              >
                <button
                  onClick={() => confirmSuggestion(name)}
                  className="font-bold hover:text-teal-800 transition-colors"
                  title="Confirm — add this service"
                >+</button>
                {name}
                <button
                  onClick={() => setDismissed((d) => [...d, name.toLowerCase()])}
                  className="text-teal-300 hover:text-teal-600 ml-0.5 leading-none transition-colors"
                  title="Dismiss"
                >×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Trace-observed services — ground truth from uploaded traces */}
      {traceSuggestions.length > 0 && (
        <div className="mb-2">
          <p className="text-[11px] text-emerald-500 dark:text-emerald-400 mb-1 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Seen in traces — not yet added:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {traceSuggestions.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300 border border-dashed border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-500/10 px-2 py-1 rounded-full"
              >
                <button
                  onClick={() => confirmSuggestion(name)}
                  className="font-bold hover:text-emerald-900 dark:hover:text-emerald-100 transition-colors"
                  title="Add this service (observed in traces)"
                >+</button>
                {name}
                <button
                  onClick={() => setDismissed((d) => [...d, name.toLowerCase()])}
                  className="text-emerald-300 hover:text-emerald-600 ml-0.5 leading-none transition-colors"
                  title="Dismiss"
                >×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {!isAggregate && (
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. auth-service"
            className="flex-1 text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={adding || !input.trim()}
            className="text-xs font-medium text-teal-600 dark:text-teal-400 hover:text-teal-800 disabled:opacity-40 px-2 transition-colors"
          >
            {adding ? 'Adding…' : '+ Add'}
          </button>
        </form>
      )}
    </div>
  );
}
