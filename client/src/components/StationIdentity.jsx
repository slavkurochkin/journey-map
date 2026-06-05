import { useState } from 'react';

// Aggregate-only: correct the auto-derived station identity.
// Rename this station, or merge it into another (when the heuristic split
// what is really one logical step into two).
export default function StationIdentity({ station, others = [], onChange }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(station.label);
  const [busy, setBusy] = useState(false);

  if (!station.canonicalKey) return null; // only in aggregate view

  async function put(body) {
    setBusy(true);
    await fetch('/api/sessions/aggregate/overrides', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    onChange?.();
  }

  const mergeTargets = others.filter((s) => s.canonicalKey && s.canonicalKey !== station.canonicalKey);

  return (
    <div className="border border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-2.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 transition-colors"
      >
        {open ? 'Done editing identity' : 'Edit identity (rename / merge)'}
      </button>

      {open && (
        <div className="mt-2.5 space-y-2.5">
          {/* Rename */}
          <div className="flex gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="flex-1 text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
            <button
              onClick={() => put({ canonicalKey: station.canonicalKey, customLabel: label })}
              disabled={busy || !label.trim() || label === station.label}
              className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 disabled:opacity-40 px-2 transition-colors"
            >
              Rename
            </button>
          </div>

          {/* Merge THIS station into another (the chosen one survives) */}
          {mergeTargets.length > 0 && (
            <div className="flex gap-2 items-center">
              <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">Merge <strong className="text-gray-600 dark:text-gray-400">“{station.label}”</strong> into</span>
              <select
                value=""
                onChange={(e) => e.target.value && put({ canonicalKey: station.canonicalKey, mergedInto: e.target.value })}
                disabled={busy}
                className="flex-1 text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              >
                <option value="">choose the station to keep…</option>
                {mergeTargets.map((s) => (
                  <option key={s.canonicalKey} value={s.canonicalKey}>{s.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Stations merged INTO this one — unmerge to split them back out */}
          {station.mergedFrom?.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Merged in ({station.mergedFrom.length})</p>
              <div className="flex flex-wrap gap-1.5">
                {station.mergedFrom.map((m) => (
                  <span key={m.canonicalKey} className="inline-flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-1 rounded-full">
                    {m.label}
                    <button
                      onClick={() => put({ canonicalKey: m.canonicalKey, mergedInto: null })}
                      disabled={busy}
                      title="Unmerge — split this back into its own station"
                      className="text-gray-400 dark:text-gray-500 hover:text-red-500 ml-0.5 leading-none transition-colors"
                    >×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-gray-300">
            This station folds into the one you choose, which stays on the map. Use the × above to unmerge.
          </p>
        </div>
      )}
    </div>
  );
}
