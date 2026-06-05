import { useState, useEffect } from 'react';
import Icon from './Icon.jsx';

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function ImpactReports({ onOpen }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/sessions/impact/reports');
      if (res.ok) setReports(await res.json());
    } finally {
      setLoading(false);
    }
  }

  async function open(id) {
    setOpening(id);
    try {
      const res = await fetch(`/api/sessions/impact/reports/${id}`);
      if (res.ok) onOpen?.(await res.json());
    } finally {
      setOpening(null);
    }
  }

  async function remove(id, e) {
    e.stopPropagation();
    await fetch(`/api/sessions/impact/reports/${id}`, { method: 'DELETE' });
    setReports((prev) => prev.filter((r) => r.id !== id));
  }

  function copyLink(id, e) {
    e.stopPropagation();
    navigator.clipboard.writeText(`${window.location.origin}/?report=${id}`);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  if (loading) {
    return <div className="text-center py-16 text-gray-400 dark:text-gray-500 text-sm">Loading reports…</div>;
  }

  if (!reports.length) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft p-10 text-center">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 ring-1 ring-emerald-100 dark:ring-emerald-500/30 flex items-center justify-center mb-3">
          <Icon name="endpoint" size={20} className="text-emerald-400" />
        </div>
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">No saved reports yet</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 max-w-xs mx-auto">
          Run an impact analysis, then “Save &amp; share” to keep it here and get a link.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {reports.map((r) => (
        <div
          key={r.id}
          onClick={() => open(r.id)}
          className="group bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft p-4 cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-500/40 transition-colors"
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{r.title}</p>
              {r.summary && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{r.summary}</p>}
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-xs text-gray-400 dark:text-gray-500">{formatDate(r.createdAt)}</span>
                {r.concernCount > 0 && (
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                    {r.concernCount} concern{r.concernCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={(e) => copyLink(r.id, e)} className="text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-emerald-600 transition-colors">
                {copiedId === r.id ? 'Copied!' : 'Copy link'}
              </button>
              <button onClick={(e) => remove(r.id, e)} className="text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors">
                Delete
              </button>
            </div>
            {opening === r.id && <span className="text-xs text-emerald-500 shrink-0">Opening…</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
