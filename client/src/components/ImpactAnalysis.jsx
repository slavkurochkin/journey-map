import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import StationDetail from './StationDetail.jsx';
import Icon from './Icon.jsx';

const LEVEL = {
  high:   { label: 'High',   chip: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300',    bar: 'bg-red-500',    card: 'border-red-200 dark:border-red-500/30' },
  medium: { label: 'Medium', chip: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300', bar: 'bg-amber-400',  card: 'border-amber-200 dark:border-amber-500/30' },
  low:    { label: 'Low',    chip: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300',   bar: 'bg-blue-400',   card: 'border-blue-200 dark:border-blue-500/30' },
};

const EVIDENCE = {
  endpoint:       'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
  service:        'bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-300',
  downstream:     'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  flag:           'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300',
  incident:       'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300',
  'coverage-gap': 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300',
  'doc-stale':    'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-300',
};

const EXAMPLES = [
  'Adding a "verified" boolean field to the auth-service login response',
  'Changing GET /api/stories to paginate with a cursor instead of page number',
  'Deprecating the profile-service and moving avatars to a CDN',
];

const FOLLOWUP_SUGGESTIONS = [
  'What tests should we add first?',
  'What should I monitor after shipping?',
  'Has anything like this broken before?',
];

function summarizeResult(result) {
  const lines = [result.summary || ''];
  for (const c of result.concerns ?? []) {
    const ev = c.evidence?.length ? ` (evidence: ${c.evidence.map((e) => e.detail).join(', ')})` : '';
    lines.push(`- [${c.level}] ${c.stationLabel}: ${c.reason}${ev}`);
  }
  return lines.join('\n');
}

export default function ImpactAnalysis({ onViewOnMap, loadedReport = null }) {
  const [query, setQuery] = useState('');
  const [change, setChange] = useState(''); // the analyzed change (persists)
  const [result, setResult] = useState(null);
  const [stations, setStations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editingChange, setEditingChange] = useState(false); // reopen the full change editor after results

  const [thread, setThread] = useState([]); // [{ role: 'user'|'assistant', text }]
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const threadEndRef = useRef(null);

  const [votes, setVotes] = useState({}); // concernKey → 'up' | 'down'
  const [stats, setStats] = useState(null);
  const [view, setView] = useState('blast'); // blast | test | monitor | flows | review
  const [briefCopied, setBriefCopied] = useState(false);
  const [testPlan, setTestPlan] = useState(null); // { tests: [...] }
  const [testPlanLoading, setTestPlanLoading] = useState(false);
  const [savedLink, setSavedLink] = useState(null); // shareable URL after saving
  const [savingReport, setSavingReport] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  // Hydrate from a saved/shared report (no LLM call) when one is opened.
  useEffect(() => {
    if (!loadedReport) return;
    setQuery(loadedReport.change || '');
    setChange(loadedReport.change || '');
    setResult(loadedReport.result || null);
    setTestPlan(loadedReport.testPlan || null);
    setThread([]); setVotes({}); setView('blast'); setSelected(null);
    setSavedLink(null); setError(null);
    fetch('/api/sessions/aggregate/map')
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => setStations(m?.stations ?? []))
      .catch(() => {});
  }, [loadedReport]);

  async function saveReport() {
    if (!result || savingReport) return;
    setSavingReport(true);
    try {
      const res = await fetch('/api/sessions/impact/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ change, result, testPlan }),
      });
      if (res.ok) {
        const { id } = await res.json();
        const url = `${window.location.origin}/?report=${id}`;
        setSavedLink(url);
        try { await navigator.clipboard.writeText(url); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); } catch { /* clipboard blocked */ }
      }
    } finally {
      setSavingReport(false);
    }
  }

  async function generateTestPlan() {
    if (testPlan || testPlanLoading) return;
    setTestPlanLoading(true);
    try {
      const labels = (result.concerns ?? []).map((c) => c.stationLabel);
      const res = await fetch('/api/sessions/impact/test-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ change, stations: labels }),
      });
      if (res.ok) setTestPlan(await res.json());
    } finally {
      setTestPlanLoading(false);
    }
  }

  function openView(key) {
    setView(key);
    if (key === 'test') generateTestPlan();
  }

  function buildBrief() {
    const r = result;
    const lines = [`# Change brief\n\n**Change:** ${change}\n`, `## Summary\n${r.summary}\n`];
    if (r.concerns?.length) {
      lines.push('## Blast radius');
      for (const c of r.concerns) {
        lines.push(`- **[${(c.level || '').toUpperCase()}] ${c.stationLabel}** — ${c.reason}`);
        if (c.evidence?.length) lines.push(`  - evidence: ${c.evidence.map((e) => e.detail).join(', ')}`);
        if (c.checks?.length) c.checks.forEach((ch) => lines.push(`  - [ ] ${ch}`));
      }
      lines.push('');
    }
    if (testPlan?.tests?.length) {
      lines.push('## Test plan');
      for (const t of testPlan.tests) {
        lines.push(`- [ ] **[${(t.priority || '').toUpperCase()}] ${t.type}** — ${t.target}`);
        lines.push(`  - assert: ${t.assertion}`);
        if (t.rationale) lines.push(`  - why: ${t.rationale}`);
      }
      lines.push('');
    }
    const section = (title, arr) => {
      if (arr?.length) { lines.push(`## ${title}`); arr.forEach((x) => lines.push(`- ${x}`)); lines.push(''); }
    };
    section('Monitoring', r.monitorChecklist);
    section('Affected flows', r.affectedFlows);
    section('Review focus', r.reviewFocus);
    return lines.join('\n');
  }

  function copyBrief() {
    navigator.clipboard.writeText(buildBrief());
    setBriefCopied(true);
    setTimeout(() => setBriefCopied(false), 1500);
  }

  const VIEWS = [
    { key: 'blast',   label: 'Blast radius' },
    { key: 'test',    label: 'Test plan',  count: testPlan?.tests?.length },
    { key: 'monitor', label: 'Monitoring', count: result?.monitorChecklist?.length },
    { key: 'flows',   label: 'Flows',      count: result?.affectedFlows?.length },
    { key: 'review',  label: 'Review',     count: result?.reviewFocus?.length },
  ];

  useEffect(() => { fetchStats(); }, []);

  async function fetchStats() {
    const res = await fetch('/api/sessions/impact/feedback/stats');
    if (res.ok) setStats(await res.json());
  }

  async function vote(concern, value) {
    const key = concern.stationId || concern.stationLabel;
    if (votes[key]) return; // one vote per concern per analysis
    setVotes((v) => ({ ...v, [key]: value }));
    await fetch('/api/sessions/impact/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        change, stationLabel: concern.stationLabel, level: concern.level,
        confidence: concern.confidence, vote: value,
      }),
    });
    fetchStats();
  }

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [thread, chatLoading]);

  async function handleAnalyze() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setSelected(null);
    setThread([]);
    setVotes({});
    setView('blast');
    setTestPlan(null);
    setSavedLink(null);
    setEditingChange(false);
    setChange(query);
    try {
      const [impactRes, mapRes] = await Promise.all([
        fetch('/api/sessions/impact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        }),
        fetch('/api/sessions/aggregate/map'),
      ]);
      if (!impactRes.ok) {
        const err = await impactRes.json();
        throw new Error(err.error || 'Impact analysis failed');
      }
      setResult(await impactRes.json());
      const map = mapRes.ok ? await mapRes.json() : null;
      setStations(map?.stations ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function sendFollowUp(text) {
    const question = (text ?? chatInput).trim();
    if (!question || chatLoading) return;
    setChatInput('');
    const nextThread = [...thread, { role: 'user', text: question }];
    setThread(nextThread);
    setChatLoading(true);

    // Build message history: the change, the analysis summary, then the conversation
    const messages = [
      { role: 'user', content: `I'm making this change:\n${change}\n\nAnalyze the impact.` },
      { role: 'assistant', content: result ? summarizeResult(result) : 'Analysis complete.' },
      ...nextThread.map((t) => ({ role: t.role, content: t.text })),
    ];

    try {
      const res = await fetch('/api/sessions/impact/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Follow-up failed');
      }
      const { reply } = await res.json();
      setThread((prev) => [...prev, { role: 'assistant', text: reply }]);
    } catch (err) {
      setThread((prev) => [...prev, { role: 'assistant', text: `Error: ${err.message}` }]);
    } finally {
      setChatLoading(false);
    }
  }

  function findStation(concern) {
    return (
      stations.find((s) => s.id === concern.stationId) ||
      stations.find((s) => s.label?.toLowerCase() === concern.stationLabel?.toLowerCase()) ||
      null
    );
  }

  function diveIn(concern) {
    const station = findStation(concern);
    if (station) setSelected(station);
  }

  function viewOnMap(concern) {
    const station = findStation(concern);
    if (station) onViewOnMap?.({ id: station.id, canonicalKey: station.canonicalKey, label: station.label });
  }

  const orderedConcerns = result?.concerns
    ? [...result.concerns].sort((a, b) => {
        const rank = { high: 0, medium: 1, low: 2 };
        return (rank[a.level] ?? 3) - (rank[b.level] ?? 3);
      })
    : [];

  const counts = orderedConcerns.reduce((acc, c) => {
    acc[c.level] = (acc[c.level] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Input — full editor before/while there are no results (or when re-editing),
          collapsing to a compact, editable subject line once a result is in. */}
      {(!result || editingChange) ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Impact Analysis</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Describe a change. Get the journeys at risk — then ask follow-up questions.
            </p>
          </div>

          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAnalyze(); }}
            placeholder="e.g. I'm adding a new required field to the auth-service login endpoint…"
            rows={3}
            autoFocus={editingChange}
            className="w-full text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          />

          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => setQuery(ex)}
                className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 px-2.5 py-1 rounded-full transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            {editingChange && (
              <button
                onClick={() => { setEditingChange(false); setQuery(change); }}
                className="text-sm font-medium px-4 py-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleAnalyze}
              disabled={loading || !query.trim()}
              className="btn-primary px-5"
            >
              {loading ? 'Analyzing…' : result ? 'Re-analyze' : 'Analyze Impact'}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft px-5 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">Analyzing change</p>
            <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap line-clamp-2">{change}</p>
          </div>
          <button
            onClick={() => setEditingChange(true)}
            className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 shrink-0 whitespace-nowrap transition-colors"
          >
            Edit &amp; re-analyze
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg p-4 text-red-700 dark:text-red-300 text-sm">{error}</div>
      )}

      {loading && (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <div className="inline-block w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm">Tracing the blast radius across your journeys…</p>
        </div>
      )}

      {/* Results: blast radius (left) + chat (right) */}
      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Left column — blast radius */}
          <div className="space-y-4">
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft p-6">
              <p className="text-sm text-gray-700 dark:text-gray-300">{result.summary}</p>
              {orderedConcerns.length > 0 && (
                <div className="flex gap-2 mt-3 items-center flex-wrap">
                  {['high', 'medium', 'low'].map((lvl) =>
                    counts[lvl] ? (
                      <span key={lvl} className={`text-xs font-semibold px-2.5 py-1 rounded-full ${LEVEL[lvl].chip}`}>
                        {counts[lvl]} {LEVEL[lvl].label}
                      </span>
                    ) : null
                  )}
                  {stats?.total > 0 && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto" title={`${stats.up} useful / ${stats.down} not, across ${stats.total} rated concerns`}>
                      {stats.precision}% rated useful · n={stats.total}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Output sub-tabs + brief export */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg overflow-x-auto">
                {VIEWS.map((v) => (
                  <button
                    key={v.key}
                    onClick={() => openView(v.key)}
                    className={`text-xs font-medium px-3 py-1.5 rounded-md whitespace-nowrap transition-colors ${
                      view === v.key ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                    }`}
                  >
                    {v.label}{v.count ? ` (${v.count})` : ''}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button onClick={copyBrief} className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 transition-colors">
                  {briefCopied ? 'Copied!' : 'Copy brief'}
                </button>
                <button onClick={saveReport} disabled={savingReport} className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 transition-colors disabled:opacity-50">
                  {savingReport ? 'Saving…' : savedLink ? (linkCopied ? '✓ Link copied' : 'Saved') : 'Save & share'}
                </button>
              </div>
            </div>

            {savedLink && (
              <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-lg px-3 py-2 flex items-center gap-2">
                <input
                  readOnly
                  value={savedLink}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 text-xs text-gray-600 dark:text-gray-300 bg-transparent focus:outline-none font-mono truncate"
                />
                <button
                  onClick={() => { navigator.clipboard.writeText(savedLink); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); }}
                  className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 shrink-0 transition-colors"
                >
                  {linkCopied ? 'Copied!' : 'Copy link'}
                </button>
              </div>
            )}

            {/* Test plan — focused generation with real API shapes */}
            {view === 'test' && (
              testPlanLoading ? (
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft p-6 text-center text-gray-400 dark:text-gray-500">
                  <div className="inline-block w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-2" />
                  <p className="text-sm">Writing a test plan from the real API shapes…</p>
                </div>
              ) : testPlan?.tests?.length ? (
                <div className="space-y-2.5">
                  {testPlan.tests.map((t, i) => <TestCard key={i} t={t} />)}
                </div>
              ) : <EmptyView text="No specific tests needed for this change." />
            )}

            {/* Monitoring */}
            {view === 'monitor' && (
              <ListCard items={result.monitorChecklist} icon="alert" empty="Nothing specific to monitor flagged." />
            )}
            {/* Flows */}
            {view === 'flows' && (
              <ListCard items={result.affectedFlows} icon="downstream" empty="No specific user flows flagged." />
            )}
            {/* Review */}
            {view === 'review' && (
              <ListCard items={result.reviewFocus} icon="endpoint" empty="No specific review focus flagged." />
            )}

            {view === 'blast' && (orderedConcerns.length === 0 ? (
              <div className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-xl p-6 text-sm text-green-700 dark:text-green-300">
                No areas of concern identified for this change.
              </div>
            ) : (
              orderedConcerns.map((c, i) => {
                const lvl = LEVEL[c.level] ?? LEVEL.low;
                const lowConf = c.confidence === 'low';
                return (
                  <div key={i} className={`bg-white dark:bg-gray-900 rounded-xl border shadow-sm overflow-hidden ${lvl.card} ${lowConf ? 'opacity-75' : ''}`}>
                    <div className="flex">
                      <div className={`w-1 shrink-0 ${lvl.bar}`} />
                      <div className="p-5 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${lvl.chip}`}>
                            {lvl.label}
                          </span>
                          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{c.stationLabel}</h3>
                          {c.confidence && (
                            <span className={`text-xs px-1.5 py-0.5 rounded ${lowConf ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500' : 'text-gray-400 dark:text-gray-500'}`} title="model confidence this is a genuine concern">
                              {c.confidence} confidence
                            </span>
                          )}
                          {stations.some((s) => s.id === c.stationId || s.label?.toLowerCase() === c.stationLabel?.toLowerCase()) && (
                            <div className="ml-auto flex items-center gap-3 shrink-0">
                              {onViewOnMap && (
                                <button
                                  onClick={() => viewOnMap(c)}
                                  className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 transition-colors"
                                  title="Highlight this station on the journey map"
                                >
                                  View on map →
                                </button>
                              )}
                              <button
                                onClick={() => diveIn(c)}
                                className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 transition-colors"
                              >
                                Dive in →
                              </button>
                            </div>
                          )}
                        </div>

                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">{c.reason}</p>

                        {c.evidence?.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2.5">
                            {c.evidence.map((ev, k) => (
                              <span
                                key={k}
                                className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${EVIDENCE[ev.type] ?? EVIDENCE.endpoint}`}
                                title={`evidence: ${ev.type}`}
                              >
                                <Icon name={ev.type} size={12} />
                                {ev.detail}
                              </span>
                            ))}
                          </div>
                        )}

                        {c.checks?.length > 0 && (
                          <div className="mt-3">
                            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5">What to check</p>
                            <ul className="space-y-1">
                              {c.checks.map((check, j) => (
                                <li key={j} className="text-sm text-gray-600 dark:text-gray-400 flex gap-2">
                                  <Icon name="square" size={13} className="text-gray-300 mt-0.5" />
                                  {check}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Feedback: was this a useful concern? */}
                        {(() => {
                          const key = c.stationId || c.stationLabel;
                          const voted = votes[key];
                          return (
                            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center gap-2">
                              {voted ? (
                                <span className="text-xs text-gray-400 dark:text-gray-500">
                                  {voted === 'up' ? '✓ Marked useful — thanks' : '✓ Marked not useful — thanks'}
                                </span>
                              ) : (
                                <>
                                  <span className="text-xs text-gray-400 dark:text-gray-500">Useful?</span>
                                  <button onClick={() => vote(c, 'up')} className="text-gray-400 dark:text-gray-500 hover:text-green-600 transition-colors" title="Useful concern"><Icon name="thumbs-up" size={15} /></button>
                                  <button onClick={() => vote(c, 'down')} className="text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors" title="False positive / not useful"><Icon name="thumbs-down" size={15} /></button>
                                </>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                );
              })
            ))}
          </div>

          {/* Right column — follow-up chat (sticky) */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft p-5 flex flex-col lg:sticky lg:top-6"
               style={{ maxHeight: 'calc(100vh - 3rem)' }}>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 shrink-0">Ask about this change</h3>

            <div className="flex-1 overflow-y-auto min-h-[8rem]">
              {thread.length > 0 ? (
                <div className="space-y-3">
                  {thread.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-emerald-600 text-white rounded-br-sm'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-bl-sm'
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm">
                        <span className="inline-flex gap-1">
                          <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </span>
                      </div>
                    </div>
                  )}
                  <div ref={threadEndRef} />
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Try asking:</p>
                  {FOLLOWUP_SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => sendFollowUp(s)}
                      className="text-left text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); sendFollowUp(); }}
              className="flex gap-2 mt-3 shrink-0 border-t border-gray-100 dark:border-gray-800 pt-3"
            >
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask a follow-up…"
                className="flex-1 text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
              <button
                type="submit"
                disabled={chatLoading || !chatInput.trim()}
                className="btn-primary"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Slide-over: full station detail for a concern */}
      {selected && createPortal(
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSelected(null)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-xl bg-gray-50 dark:bg-gray-800/40 h-full overflow-y-auto shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <StationDetail station={selected} onClose={() => setSelected(null)} />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function EmptyView({ text }) {
  return <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft p-6 text-sm text-gray-400 dark:text-gray-500">{text}</div>;
}

const PRIORITY = {
  p0: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300',
  p1: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300',
  p2: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300',
};
const TEST_TYPE = {
  contract:    'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-500/30',
  integration: 'bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-500/30',
  e2e:         'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
  unit:        'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700',
};

function TestCard({ t }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${PRIORITY[t.priority] ?? PRIORITY.p2}`}>
          {(t.priority || 'p2').toUpperCase()}
        </span>
        <span className={`text-xs font-medium px-2 py-0.5 rounded border ${TEST_TYPE[t.type] ?? TEST_TYPE.unit}`}>
          {t.type}
        </span>
        <code className="text-xs font-mono text-gray-700 dark:text-gray-300">{t.target}</code>
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">{t.station}</span>
      </div>
      <p className="text-sm text-gray-800 dark:text-gray-200 mt-2 flex gap-2">
        <Icon name="square" size={13} className="text-gray-300 mt-0.5 shrink-0" />
        {t.assertion}
      </p>
      {t.rationale && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5 pl-5">{t.rationale}</p>}
    </div>
  );
}

function ListCard({ items, icon, empty }) {
  if (!items?.length) return <EmptyView text={empty} />;
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft p-5">
      <ul className="space-y-2">
        {items.map((x, i) => (
          <li key={i} className="text-sm text-gray-700 dark:text-gray-300 flex gap-2.5">
            <Icon name={icon} size={14} className="text-gray-400 dark:text-gray-500 mt-0.5 shrink-0" />
            {x}
          </li>
        ))}
      </ul>
    </div>
  );
}
