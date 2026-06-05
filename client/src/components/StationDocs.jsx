import { useState, useEffect } from 'react';
import { DOC_TYPES, docMeta, relativeTime, isStale } from '../utils/docTypes.js';
import Icon from './Icon.jsx';

export default function StationDocs({ sessionId, stationId, sessionMappings }) {
  const isAggregate = !!sessionMappings;
  const effectiveMappings = sessionMappings ?? (sessionId ? [{ sessionId, stationId }] : null);

  const [docs, setDocs] = useState([]); // [{ id, type, title, url, updatedAt, sessionId }]
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState('design');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (effectiveMappings?.length) fetchDocs();
  }, [sessionId, stationId, sessionMappings]);

  async function fetchDocs() {
    const results = await Promise.all(
      effectiveMappings.map(({ sessionId: sid, stationId: stId }) =>
        fetch(`/api/sessions/${sid}/station-docs?stationId=${stId}`)
          .then((r) => (r.ok ? r.json() : []))
          .then((list) => list.map((d) => ({ ...d, sessionId: sid })))
      )
    );
    setDocs(results.flat());
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    await fetch(`/api/sessions/${sessionId}/station-docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stationId, type, title, url }),
    });
    setTitle(''); setUrl(''); setType('design'); setShowForm(false);
    await fetchDocs();
    setSaving(false);
  }

  async function handleRemove(doc) {
    await fetch(`/api/sessions/${doc.sessionId}/station-docs/${doc.id}`, { method: 'DELETE' });
    setDocs((prev) => prev.filter((d) => d.id !== doc.id));
  }

  if (!effectiveMappings?.length) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
          Docs & Designs {docs.length > 0 && `(${docs.length})`}
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

      {docs.length > 0 ? (
        <div className="space-y-1.5 mb-2">
          {docs.map((doc) => {
            const meta = docMeta(doc.type);
            const stale = isStale(doc.updatedAt);
            return (
              <div key={doc.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-gray-100 dark:border-gray-800 group">
                <Icon name={meta.icon} size={14} className="text-gray-500 dark:text-gray-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  {doc.url ? (
                    <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-sm text-gray-700 dark:text-gray-300 hover:text-emerald-600 hover:underline truncate block">
                      {doc.title}
                    </a>
                  ) : (
                    <span className="text-sm text-gray-700 dark:text-gray-300 truncate block">{doc.title}</span>
                  )}
                  <span className={`text-xs ${stale ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}>
                    {meta.label} · updated {relativeTime(doc.updatedAt)}{stale && ' · stale'}
                  </span>
                </div>
                {doc.url && <Icon name="external-link" size={13} className="text-gray-300 shrink-0" />}
                {!isAggregate && (
                  <button
                    onClick={() => handleRemove(doc)}
                    className="text-gray-300 hover:text-red-400 text-sm leading-none shrink-0 transition-colors"
                    title="Remove"
                  >×</button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        !showForm && <p className="text-xs text-gray-300 italic mb-2">No docs or designs linked for this station.</p>
      )}

      {!isAggregate && showForm && (
        <form onSubmit={handleAdd} className="space-y-2">
          <div className="flex gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            >
              {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="title — e.g. Profile screen mockup"
              className="flex-1 min-w-0 text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
            />
          </div>
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="link (e.g. Figma URL)"
              className="flex-1 text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
            />
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 px-3 py-1.5 rounded-lg transition-colors"
            >
              {saving ? 'Saving…' : 'Add'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
