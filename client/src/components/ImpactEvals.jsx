import { useState, useEffect } from 'react';
import Icon from './Icon.jsx';

function recallColor(r) {
  if (r == null) return 'text-gray-300';
  if (r >= 80) return 'text-green-600 dark:text-green-400';
  if (r >= 50) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

export default function ImpactEvals() {
  const [cases, setCases] = useState([]);
  const [stations, setStations] = useState([]);
  const [running, setRunning] = useState({}); // caseId → bool
  const [results, setResults] = useState({}); // caseId → result detail
  const [runningAll, setRunningAll] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [change, setChange] = useState('');
  const [expected, setExpected] = useState([]); // station labels
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchCases();
    fetch('/api/sessions/aggregate/map').then((r) => (r.ok ? r.json() : null)).then((m) => setStations(m?.stations ?? []));
  }, []);

  async function fetchCases() {
    const res = await fetch('/api/sessions/impact/evals');
    if (res.ok) setCases(await res.json());
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim() || !change.trim() || expected.length === 0) return;
    setSaving(true);
    await fetch('/api/sessions/impact/evals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, change, expected }),
    });
    setName(''); setChange(''); setExpected([]); setShowForm(false);
    await fetchCases();
    setSaving(false);
  }

  async function runCase(c) {
    setRunning((r) => ({ ...r, [c.id]: true }));
    try {
      const res = await fetch(`/api/sessions/impact/evals/${c.id}/run`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setResults((r) => ({ ...r, [c.id]: data }));
        await fetchCases();
      }
    } finally {
      setRunning((r) => ({ ...r, [c.id]: false }));
    }
  }

  async function runAll() {
    setRunningAll(true);
    for (const c of cases) await runCase(c);
    setRunningAll(false);
  }

  async function remove(c) {
    await fetch(`/api/sessions/impact/evals/${c.id}`, { method: 'DELETE' });
    setCases((prev) => prev.filter((x) => x.id !== c.id));
  }

  function toggleExpected(label) {
    setExpected((prev) => prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]);
  }

  const aggRecall = cases.filter((c) => c.lastRecall != null);
  const meanRecall = aggRecall.length
    ? Math.round(aggRecall.reduce((a, c) => a + c.lastRecall, 0) / aggRecall.length)
    : null;

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Regression evals</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Define a change + the stations that <em>should</em> be flagged. Run before prompt/model changes to catch regressions.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {meanRecall != null && (
              <span className={`text-sm font-semibold ${recallColor(meanRecall)}`} title="mean recall across run cases">
                {meanRecall}% recall
              </span>
            )}
            {cases.length > 0 && (
              <button
                onClick={runAll}
                disabled={runningAll}
                className="btn-primary py-1.5"
              >
                {runningAll ? 'Running…' : 'Run all'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* New case */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft p-5">
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 transition-colors"
        >
          {showForm ? 'Cancel' : '+ New eval case'}
        </button>

        {showForm && (
          <form onSubmit={handleCreate} className="mt-4 space-y-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="case name — e.g. 'auth schema change'"
              className="w-full text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
            <textarea
              value={change}
              onChange={(e) => setChange(e.target.value)}
              placeholder="the change to analyze — e.g. 'adding a required field to the auth-service login response'"
              rows={2}
              className="w-full text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
            <div>
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5">
                Expected stations ({expected.length})
              </p>
              {stations.length === 0 ? (
                <p className="text-xs text-gray-300 italic">No stations — record & save some journeys first.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {stations.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleExpected(s.label)}
                      className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                        expected.includes(s.label)
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-emerald-300'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving || !name.trim() || !change.trim() || !expected.length}
                className="text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 px-4 py-2 rounded-lg transition-colors"
              >
                {saving ? 'Saving…' : 'Save case'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Cases */}
      {cases.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No eval cases yet.</p>
      ) : (
        cases.map((c) => {
          const result = results[c.id];
          return (
            <div key={c.id} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft p-5">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{c.name}</h3>
                    {c.lastRecall != null && (
                      <span className={`text-xs font-semibold ${recallColor(c.lastRecall)}`}>
                        {c.lastRecall}% recall · {c.lastPrecision}% precision
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{c.change}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">expects: {c.expected.join(', ')}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => runCase(c)}
                    disabled={running[c.id]}
                    className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 disabled:opacity-40 transition-colors"
                  >
                    {running[c.id] ? 'Running…' : 'Run'}
                  </button>
                  <button onClick={() => remove(c)} className="text-gray-300 hover:text-red-400 text-sm leading-none transition-colors" title="Delete">×</button>
                </div>
              </div>

              {/* Run result detail */}
              {result && (
                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 space-y-1.5 text-xs">
                  {result.matched.length > 0 && (
                    <div className="flex gap-2">
                      <span className="text-green-600 dark:text-green-400 font-medium shrink-0">✓ caught</span>
                      <span className="text-gray-600 dark:text-gray-400">{result.matched.join(', ')}</span>
                    </div>
                  )}
                  {result.missed.length > 0 && (
                    <div className="flex gap-2">
                      <span className="text-red-600 dark:text-red-400 font-medium shrink-0">✕ missed</span>
                      <span className="text-gray-600 dark:text-gray-400">{result.missed.join(', ')}</span>
                    </div>
                  )}
                  {result.extra.length > 0 && (
                    <div className="flex gap-2">
                      <span className="text-amber-600 dark:text-amber-400 font-medium shrink-0">+ extra</span>
                      <span className="text-gray-500 dark:text-gray-400">{result.extra.join(', ')}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
