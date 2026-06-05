import { useState, useEffect } from 'react';
import Icon from './Icon.jsx';

export default function FeatureFlagList({ sessionId, stationId, sessionMappings }) {
  const isAggregate = !!sessionMappings;
  const effectiveMappings = sessionMappings ?? (sessionId ? [{ sessionId, stationId }] : null);

  const [flags, setFlags] = useState([]); // [{ id, name, enabled, rollout, description, sessionId }]
  const [name, setName] = useState('');
  const [rollout, setRollout] = useState('');
  const [description, setDescription] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingRollout, setEditingRollout] = useState(null); // flag id
  const [rolloutDraft, setRolloutDraft] = useState('');
  const [editingDesc, setEditingDesc] = useState(null); // flag id
  const [descDraft, setDescDraft] = useState('');

  useEffect(() => {
    if (effectiveMappings?.length) fetchFlags();
  }, [sessionId, stationId, sessionMappings]);

  async function fetchFlags() {
    const results = await Promise.all(
      effectiveMappings.map(({ sessionId: sid, stationId: stId }) =>
        fetch(`/api/sessions/${sid}/flags?stationId=${stId}`)
          .then((r) => (r.ok ? r.json() : []))
          .then((list) => list.map((f) => ({ ...f, sessionId: sid })))
      )
    );
    const seen = new Set();
    setFlags(results.flat().filter((f) => {
      const key = f.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }));
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    await fetch(`/api/sessions/${sessionId}/flags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stationId, name, enabled: true, rollout, description }),
    });
    setName('');
    setRollout('');
    setDescription('');
    await fetchFlags();
    setAdding(false);
  }

  async function patchFlag(flag, body) {
    await fetch(`/api/sessions/${flag.sessionId}/flags/${flag.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function handleToggle(flag) {
    const enabled = !flag.enabled;
    await patchFlag(flag, { enabled });
    setFlags((prev) => prev.map((f) => (f.id === flag.id ? { ...f, enabled } : f)));
  }

  function startEditRollout(flag) {
    setEditingRollout(flag.id);
    setRolloutDraft(flag.rollout ?? '');
  }

  async function saveRollout(flag) {
    const value = rolloutDraft.trim();
    await patchFlag(flag, { rollout: value });
    setFlags((prev) => prev.map((f) => (f.id === flag.id ? { ...f, rollout: value || null } : f)));
    setEditingRollout(null);
  }

  function startEditDesc(flag) {
    setEditingDesc(flag.id);
    setDescDraft(flag.description ?? '');
  }

  async function saveDesc(flag) {
    const value = descDraft.trim();
    await patchFlag(flag, { description: value });
    setFlags((prev) => prev.map((f) => (f.id === flag.id ? { ...f, description: value || null } : f)));
    setEditingDesc(null);
  }

  async function handleRemove(flag) {
    await fetch(`/api/sessions/${flag.sessionId}/flags/${flag.id}`, { method: 'DELETE' });
    setFlags((prev) => prev.filter((f) => f.id !== flag.id));
  }

  if (!effectiveMappings?.length) return null;

  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Feature Flags</p>

      {flags.length > 0 ? (
        <div className="space-y-1.5 mb-3">
          {flags.map((flag) => {
            const on = flag.enabled;
            return (
              <div
                key={flag.id}
                className={`text-xs border rounded-lg px-2.5 py-1.5 ${
                  on ? 'bg-emerald-50/60 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30' : 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700'
                }`}
              >
                {/* Top row */}
                <div className="flex items-center gap-2">
                  {/* Toggle */}
                  <button
                    onClick={() => !isAggregate && handleToggle(flag)}
                    disabled={isAggregate}
                    title={isAggregate ? undefined : 'Toggle'}
                    className={`w-7 h-3.5 rounded-full relative transition-colors shrink-0 ${
                      on ? 'bg-emerald-500' : 'bg-gray-300'
                    } ${isAggregate ? 'cursor-default' : 'cursor-pointer'}`}
                  >
                    <span className={`absolute top-0.5 w-2.5 h-2.5 bg-white dark:bg-gray-900 rounded-full transition-all ${on ? 'left-[14px]' : 'left-0.5'}`} />
                  </button>

                  {/* Name */}
                  <span className={`font-medium ${on ? 'text-emerald-800 dark:text-emerald-300' : 'text-gray-400 dark:text-gray-500'}`}>{flag.name}</span>

                  {/* Rollout */}
                  {editingRollout === flag.id ? (
                    <input
                      value={rolloutDraft}
                      onChange={(e) => setRolloutDraft(e.target.value)}
                      onBlur={() => saveRollout(flag)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveRollout(flag);
                        if (e.key === 'Escape') setEditingRollout(null);
                      }}
                      autoFocus
                      placeholder="e.g. 10% of users"
                      className="ml-1 text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 border border-emerald-300 dark:border-emerald-500/40 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-400 w-40"
                    />
                  ) : flag.rollout ? (
                    <button
                      onClick={() => !isAggregate && startEditRollout(flag)}
                      disabled={isAggregate}
                      className="ml-1 inline-flex items-center gap-1 bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded font-medium hover:bg-amber-200 transition-colors disabled:cursor-default"
                      title={isAggregate ? undefined : 'Edit targeting'}
                    >
                      <Icon name="target" size={12} /> {flag.rollout}
                    </button>
                  ) : (
                    !isAggregate && (
                      <button
                        onClick={() => startEditRollout(flag)}
                        className="ml-1 text-gray-300 hover:text-emerald-500 transition-colors"
                        title="Add targeting"
                      >
                        + targeting
                      </button>
                    )
                  )}

                  {/* Remove */}
                  {!isAggregate && (
                    <button
                      onClick={() => handleRemove(flag)}
                      className="ml-auto text-gray-300 hover:text-red-400 leading-none transition-colors shrink-0"
                      title="Remove"
                    >×</button>
                  )}
                </div>

                {/* Description line */}
                <div className="mt-1 pl-9">
                  {editingDesc === flag.id ? (
                    <input
                      value={descDraft}
                      onChange={(e) => setDescDraft(e.target.value)}
                      onBlur={() => saveDesc(flag)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveDesc(flag);
                        if (e.key === 'Escape') setEditingDesc(null);
                      }}
                      autoFocus
                      placeholder="what is this flag for?"
                      className="w-full text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 border border-emerald-300 dark:border-emerald-500/40 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    />
                  ) : flag.description ? (
                    <button
                      onClick={() => !isAggregate && startEditDesc(flag)}
                      disabled={isAggregate}
                      className="text-left text-gray-500 dark:text-gray-400 hover:text-gray-700 transition-colors disabled:cursor-default disabled:hover:text-gray-500"
                      title={isAggregate ? undefined : 'Edit description'}
                    >
                      {flag.description}
                    </button>
                  ) : (
                    !isAggregate && (
                      <button
                        onClick={() => startEditDesc(flag)}
                        className="text-gray-300 hover:text-emerald-500 transition-colors"
                        title="Add description"
                      >
                        + add description
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-gray-300 italic mb-2">No feature flags added for this station.</p>
      )}

      {!isAggregate && (
        <form onSubmit={handleAdd} className="space-y-2">
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="flag name"
              className="flex-1 text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
            />
            <input
              value={rollout}
              onChange={(e) => setRollout(e.target.value)}
              placeholder="targeting (optional)"
              className="flex-1 text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
            />
            <button
              type="submit"
              disabled={adding || !name.trim()}
              className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 disabled:opacity-40 px-2 transition-colors"
            >
              {adding ? 'Adding…' : '+ Add'}
            </button>
          </div>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="description — what is this flag for? (optional)"
            className="w-full text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
          />
        </form>
      )}
    </div>
  );
}
