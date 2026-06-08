import { useState, useEffect, useRef } from 'react';

// Action steps for a station. Read-only in the unsaved view; editable in two modes:
//  • single saved session  → add / edit / delete, persisted into that session's result.
//  • aggregate map station  → edit / delete only, persisted as a canonical-station
//    override (the source recordings are never touched). Aggregate edits are keyed
//    by the action signature (`actionKeys`) so they survive re-aggregation.
export default function ActionList({ sessionId, stationId, canonicalKey, actions = [], actionKeys = [], editable = false, onChange }) {
  const aggregate = !!canonicalKey;
  const [items, setItems] = useState(actions);
  const [keys, setKeys] = useState(actionKeys);
  const [editing, setEditing] = useState(false);
  const addRef = useRef(false);

  // Reset when the station changes (not on every parent re-render).
  useEffect(() => { setItems(actions); setKeys(actionKeys); setEditing(false); }, [stationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- single-session persistence (whole array) ---
  async function persistSession(next) {
    setItems(next);
    onChange?.(next);
    if (!sessionId) return;
    await fetch(`/api/sessions/${sessionId}/stations/${stationId}/actions`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions: next }),
    });
  }

  // --- aggregate persistence (per-action override) ---
  async function aggregateOp(body) {
    await fetch(`/api/sessions/aggregate/overrides/${encodeURIComponent(canonicalKey)}/actions`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    onChange?.(); // refetch the map so the change is reflected everywhere
  }

  function commitSession() {
    persistSession(items.map((s) => s.trim()).filter(Boolean));
  }

  function renameItem(i) {
    const text = (items[i] || '').trim();
    if (aggregate) {
      if (text && text !== actions[i]) aggregateOp({ op: 'rename', sig: keys[i], label: text });
    } else {
      commitSession();
    }
  }

  function removeItem(i) {
    if (aggregate) {
      setItems((prev) => prev.filter((_, idx) => idx !== i));
      aggregateOp({ op: 'hide', sig: keys[i] });
    } else {
      persistSession(items.filter((_, idx) => idx !== i));
    }
  }

  function addStep() {
    addRef.current = true;
    setItems((prev) => [...prev, '']);
  }

  // Read-only modes
  if (!editable) {
    if (!items.length) return null;
    return <ReadOnly items={items} />;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
          Actions {items.length > 0 && `(${items.length})`}
        </p>
        <button
          onClick={() => { if (editing && !aggregate) commitSession(); setEditing((v) => !v); }}
          className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 transition-colors"
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>

      {!editing ? (
        items.length ? (
          <ReadOnly items={items} bare />
        ) : (
          <p className="text-xs text-gray-300 italic">No steps yet — click Edit to add.</p>
        )
      ) : (
        <div className="space-y-1.5">
          {items.map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-gray-300 select-none shrink-0">›</span>
              <input
                autoFocus={addRef.current && i === items.length - 1}
                value={step}
                onChange={(e) => setItems((prev) => prev.map((x, idx) => (idx === i ? e.target.value : x)))}
                onBlur={() => renameItem(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); renameItem(i); if (!aggregate) addStep(); }
                  if (e.key === 'Escape') e.currentTarget.blur();
                }}
                placeholder="Describe a step…"
                className="flex-1 text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
              />
              <button
                onClick={() => removeItem(i)}
                className="text-gray-300 hover:text-red-400 text-sm leading-none shrink-0 transition-colors"
                title="Delete step"
              >×</button>
            </div>
          ))}
          {!aggregate && (
            <button
              onClick={addStep}
              className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 transition-colors"
            >
              + Add step
            </button>
          )}
          {aggregate && (
            <p className="text-[11px] text-gray-400 dark:text-gray-500 italic pt-0.5">
              Edits apply to this merged station only — recordings are unchanged.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ReadOnly({ items, bare }) {
  return (
    <div>
      {!bare && <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Actions</p>}
      <ul className="space-y-1.5">
        {items.map((a, i) => (
          <li key={i} className="text-sm text-gray-700 dark:text-gray-300 flex gap-2">
            <span className="text-gray-300 select-none shrink-0">›</span>
            {a}
          </li>
        ))}
      </ul>
    </div>
  );
}
