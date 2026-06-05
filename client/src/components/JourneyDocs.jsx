import { useState, useEffect } from 'react';
import { DOC_TYPES, docMeta, relativeTime, isStale } from '../utils/docTypes.js';
import Icon from './Icon.jsx';

export default function JourneyDocs() {
  const [docs, setDocs] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState('prd');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchDocs(); }, []);

  async function fetchDocs() {
    const res = await fetch('/api/sessions/journey-docs');
    if (res.ok) setDocs(await res.json());
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    await fetch('/api/sessions/journey-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, title, url }),
    });
    setTitle(''); setUrl(''); setType('prd'); setShowForm(false);
    await fetchDocs();
    setSaving(false);
  }

  async function handleRemove(doc) {
    await fetch(`/api/sessions/journey-docs/${doc.id}`, { method: 'DELETE' });
    setDocs((prev) => prev.filter((d) => d.id !== doc.id));
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Documentation</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">PRDs, design docs & specs for this feature</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-xs text-emerald-500 hover:text-emerald-700 font-medium transition-colors"
        >
          {showForm ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {docs.length > 0 ? (
        <div className="space-y-1.5">
          {docs.map((doc) => {
            const meta = docMeta(doc.type);
            const stale = isStale(doc.updatedAt);
            return (
              <div key={doc.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group">
                <Icon name={meta.icon} size={16} className="text-gray-500 dark:text-gray-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {doc.url ? (
                      <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-gray-800 dark:text-gray-200 hover:text-emerald-600 hover:underline truncate">
                        {doc.title}
                      </a>
                    ) : (
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{doc.title}</span>
                    )}
                    <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">{meta.label}</span>
                  </div>
                  <p className={`text-xs mt-0.5 ${stale ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}>
                    updated {relativeTime(doc.updatedAt)}{stale && ' · may be stale'}
                  </p>
                </div>
                {doc.url && <Icon name="external-link" size={13} className="text-gray-300 group-hover:text-emerald-400 shrink-0" />}
                <button
                  onClick={() => handleRemove(doc)}
                  className="text-gray-300 hover:text-red-400 text-sm leading-none shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove"
                >×</button>
              </div>
            );
          })}
        </div>
      ) : (
        !showForm && <p className="text-xs text-gray-300 italic">No documentation linked yet.</p>
      )}

      {showForm && (
        <form onSubmit={handleAdd} className="space-y-2 mt-3 border-t border-gray-100 dark:border-gray-800 pt-3">
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
              placeholder="title — e.g. Checkout redesign PRD"
              className="flex-1 min-w-0 text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
            />
          </div>
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="link (optional)"
              className="flex-1 text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
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
