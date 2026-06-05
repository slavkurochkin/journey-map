import { useState, useEffect } from 'react';
import Icon from './Icon.jsx';

const TYPES = [
  { value: 'dashboard', label: 'Dashboard', color: 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30' },
  { value: 'trace',     label: 'Trace',     color: 'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-500/30' },
  { value: 'logs',      label: 'Logs',      color: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700' },
  { value: 'alert',     label: 'Alert',     color: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30' },
  { value: 'metric',    label: 'Metric',    color: 'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300 border-green-200 dark:border-green-500/30' },
];

const typeMeta = (t) => TYPES.find((x) => x.value === t) ?? TYPES[2];

export default function ObservabilityList({ sessionId, stationId, sessionMappings }) {
  const isAggregate = !!sessionMappings;
  const effectiveMappings = sessionMappings ?? (sessionId ? [{ sessionId, stationId }] : null);

  const [items, setItems] = useState([]); // [{ id, type, label, url, sessionId }]
  const [type, setType] = useState('dashboard');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (effectiveMappings?.length) fetchItems();
  }, [sessionId, stationId, sessionMappings]);

  async function fetchItems() {
    const results = await Promise.all(
      effectiveMappings.map(({ sessionId: sid, stationId: stId }) =>
        fetch(`/api/sessions/${sid}/observability?stationId=${stId}`)
          .then((r) => (r.ok ? r.json() : []))
          .then((list) => list.map((o) => ({ ...o, sessionId: sid })))
      )
    );
    setItems(results.flat());
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!label.trim()) return;
    setAdding(true);
    await fetch(`/api/sessions/${sessionId}/observability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stationId, type, label, url }),
    });
    setLabel('');
    setUrl('');
    await fetchItems();
    setAdding(false);
  }

  async function handleRemove(item) {
    await fetch(`/api/sessions/${item.sessionId}/observability/${item.id}`, { method: 'DELETE' });
    setItems((prev) => prev.filter((o) => o.id !== item.id));
  }

  if (!effectiveMappings?.length) return null;

  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Observability</p>

      {items.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {items.map((item) => {
            const meta = typeMeta(item.type);
            const inner = (
              <>
                <Icon name={item.type} size={13} />
                {item.label}
                {item.url && <Icon name="external-link" size={12} className="opacity-50" />}
              </>
            );
            return (
              <span
                key={item.id}
                className={`inline-flex items-center gap-1 text-xs border px-2 py-1 rounded-full ${meta.color}`}
              >
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:underline"
                    title={item.url}
                  >
                    {inner}
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1">{inner}</span>
                )}
                {!isAggregate && (
                  <button
                    onClick={() => handleRemove(item)}
                    className="text-current opacity-40 hover:opacity-100 ml-0.5 leading-none transition-opacity"
                    title="Remove"
                  >×</button>
                )}
              </span>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-gray-300 italic mb-2">No observability links for this station.</p>
      )}

      {!isAggregate && (
        <form onSubmit={handleAdd} className="flex gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent bg-white dark:bg-gray-900"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="label"
            className="flex-1 min-w-0 text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="URL (optional)"
            className="flex-1 min-w-0 text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={adding || !label.trim()}
            className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 disabled:opacity-40 px-2 transition-colors"
          >
            {adding ? 'Adding…' : '+ Add'}
          </button>
        </form>
      )}
    </div>
  );
}
