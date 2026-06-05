import { useState, useEffect } from 'react';
import Icon from './Icon.jsx';

const SEVERITY = {
  critical: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30',
  high:     'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-500/30',
  medium:   'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
  low:      'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700',
};
const SEV_OPTIONS = ['critical', 'high', 'medium', 'low'];

function formatDate(d) {
  if (!d) return null;
  const date = new Date(d);
  if (isNaN(date)) return d;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function IncidentList({ sessionId, stationId, sessionMappings }) {
  const isAggregate = !!sessionMappings;
  const effectiveMappings = sessionMappings ?? (sessionId ? [{ sessionId, stationId }] : null);

  const [incidents, setIncidents] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [severity, setSeverity] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (effectiveMappings?.length) fetchIncidents();
  }, [sessionId, stationId, sessionMappings]);

  async function fetchIncidents() {
    const results = await Promise.all(
      effectiveMappings.map(({ sessionId: sid, stationId: stId }) =>
        fetch(`/api/sessions/${sid}/incidents?stationId=${stId}`)
          .then((r) => (r.ok ? r.json() : []))
          .then((list) => list.map((i) => ({ ...i, sessionId: sid })))
      )
    );
    setIncidents(results.flat());
  }

  const [fetching, setFetching] = useState(false);

  async function autofillFromUrl() {
    if (!url.trim()) return;
    setFetching(true);
    try {
      const res = await fetch('/api/sessions/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        const meta = await res.json();
        if (meta.title && !description.trim()) setDescription(meta.title);
        if (meta.date && !occurredAt) {
          const d = new Date(meta.date);
          if (!isNaN(d)) setOccurredAt(d.toISOString().slice(0, 10));
        }
      }
    } finally {
      setFetching(false);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!description.trim()) return;
    setSaving(true);
    await fetch(`/api/sessions/${sessionId}/incidents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stationId, description, url, occurredAt, severity: severity || null }),
    });
    setDescription('');
    setUrl('');
    setOccurredAt('');
    setSeverity('');
    setShowForm(false);
    await fetchIncidents();
    setSaving(false);
  }

  async function handleRemove(inc) {
    await fetch(`/api/sessions/${inc.sessionId}/incidents/${inc.id}`, { method: 'DELETE' });
    setIncidents((prev) => prev.filter((i) => i.id !== inc.id));
  }

  if (!effectiveMappings?.length) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
          Past Incidents {incidents.length > 0 && `(${incidents.length})`}
        </p>
        {!isAggregate && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="text-xs text-emerald-500 hover:text-emerald-700 font-medium transition-colors"
          >
            {showForm ? 'Cancel' : '+ Add'}
          </button>
        )}
      </div>

      {incidents.length > 0 ? (
        <div className="space-y-1.5 mb-2">
          {incidents.map((inc) => (
            <div key={inc.id} className="border border-gray-100 dark:border-gray-800 rounded-lg px-3 py-2 bg-gray-50/50 dark:bg-gray-800/40">
              <div className="flex items-center gap-2">
                {inc.severity && (
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded border ${SEVERITY[inc.severity] ?? SEVERITY.low}`}>
                    {inc.severity}
                  </span>
                )}
                {inc.occurredAt && (
                  <span className="text-xs text-gray-400 dark:text-gray-500">{formatDate(inc.occurredAt)}</span>
                )}
                {inc.url && (
                  <a
                    href={inc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-emerald-500 hover:underline inline-flex items-center gap-1"
                  >
                    view <Icon name="external-link" size={11} />
                  </a>
                )}
                {!isAggregate && (
                  <button
                    onClick={() => handleRemove(inc)}
                    className="ml-auto text-gray-300 hover:text-red-400 text-sm leading-none transition-colors"
                    title="Remove"
                  >×</button>
                )}
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{inc.description}</p>
            </div>
          ))}
        </div>
      ) : (
        !showForm && <p className="text-xs text-gray-300 italic mb-2">No incidents recorded for this station.</p>
      )}

      {!isAggregate && showForm && (
        <form onSubmit={handleAdd} className="space-y-2 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What happened? (e.g. Stories feed returned 500s after schema change)"
            rows={2}
            className="w-full text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded px-2.5 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
          />
          <div className="flex gap-2">
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            >
              <option value="">severity</option>
              {SEV_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input
              type="date"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="text-xs bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-gray-600 dark:text-gray-400 dark:[color-scheme:dark]"
            />
          </div>
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="link to incident (postmortem, ticket…)"
              className="flex-1 text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
            />
            <button
              type="button"
              onClick={autofillFromUrl}
              disabled={fetching || !url.trim()}
              title="Auto-fill title & date from the link"
              className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 disabled:opacity-40 px-2 whitespace-nowrap transition-colors inline-flex items-center gap-1"
            >
              <Icon name="refresh" size={12} className={fetching ? 'animate-spin' : ''} />
              {fetching ? '…' : 'Auto-fill'}
            </button>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving || !description.trim()}
              className="text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 px-3 py-1.5 rounded-lg transition-colors"
            >
              {saving ? 'Saving…' : 'Save incident'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
