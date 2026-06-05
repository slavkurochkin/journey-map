import { useMemo } from 'react';
import { diffJson, parseBody } from '../utils/diffJson.js';

const KIND_STYLE = {
  added:        { label: '+ added',        bg: 'bg-green-50 dark:bg-green-500/10', text: 'text-green-700 dark:text-green-300', dot: 'bg-green-500' },
  removed:      { label: '− removed',      bg: 'bg-red-50 dark:bg-red-500/10',   text: 'text-red-700 dark:text-red-300',   dot: 'bg-red-500'   },
  type_changed: { label: '~ type changed', bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-400' },
};

function pretty(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') {
    try { return JSON.stringify(JSON.parse(val), null, 2); } catch { return val; }
  }
  return JSON.stringify(val, null, 2);
}

function pathOf(url) {
  try { return new URL(url).pathname; } catch { return url; }
}

function formatTs(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// Extract the leaf key name from a dot-path: "stories[0].test_id" → "test_id"
function leafKey(path) {
  const clean = path.replace(/\[\d+\]/g, '');
  const parts = clean.split('.');
  return parts[parts.length - 1];
}

// Highlight only lines that contain a structurally-changed field key.
// This avoids false positives from positional comparison when lines shift due to insertions.
function DiffBody({ textA, textB, labelA, labelB, changes }) {
  const { leftKeys, rightKeys } = useMemo(() => {
    const left = new Set();
    const right = new Set();
    for (const c of changes) {
      const k = leafKey(c.path);
      if (c.kind === 'removed' || c.kind === 'type_changed') left.add(k);
      if (c.kind === 'added'   || c.kind === 'type_changed') right.add(k);
    }
    return { leftKeys: left, rightKeys: right };
  }, [changes]);

  const hits = (line, keys) => [...keys].some((k) => line.includes(`"${k}":`));

  const linesA = (textA ?? '').split('\n');
  const linesB = (textB ?? '').split('\n');

  return (
    <div>
      <div className="grid grid-cols-2 gap-px mb-1">
        <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">{labelA}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">{labelB}</p>
      </div>
      <div className="rounded-lg overflow-auto max-h-72 bg-gray-950 text-xs font-mono leading-5">
        <div className="grid grid-cols-2 divide-x divide-gray-700">
          <div className="p-3">
            {linesA.map((line, i) => (
              <div key={i} className={hits(line, leftKeys) ? 'bg-red-900/50 text-red-200 rounded px-0.5' : 'text-gray-100'}>
                {line}
              </div>
            ))}
          </div>
          <div className="p-3">
            {linesB.map((line, i) => (
              <div key={i} className={hits(line, rightKeys) ? 'bg-green-900/50 text-green-200 rounded px-0.5' : 'text-gray-100'}>
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function JsonDiffView({ reqA, reqB, onClose, onAcceptNew }) {
  // Always show earlier timestamp on the left as "Before", later as "After"
  const [before, after] = (reqA.timestamp ?? 0) <= (reqB.timestamp ?? 0)
    ? [reqA, reqB]
    : [reqB, reqA];

  const changes = useMemo(() => {
    const bodyBefore = parseBody(before.responseBody);
    const bodyAfter  = parseBody(after.responseBody);
    if (bodyBefore === null && bodyAfter === null) return [];
    if (bodyBefore === null || bodyAfter === null) return [{
      path: '(root)', kind: 'type_changed',
      from: bodyBefore === null ? 'null' : typeof bodyBefore,
      to:   bodyAfter  === null ? 'null' : typeof bodyAfter,
    }];
    return diffJson(bodyBefore, bodyAfter);
  }, [before, after]);

  const groups = {
    added:        changes.filter((c) => c.kind === 'added'),
    removed:      changes.filter((c) => c.kind === 'removed'),
    type_changed: changes.filter((c) => c.kind === 'type_changed'),
  };

  const prettyBefore = pretty(before.responseBody);
  const prettyAfter  = pretty(after.responseBody);

  return (
    <div className="border border-emerald-100 dark:border-emerald-500/30 rounded-xl bg-white dark:bg-gray-900 shadow-sm overflow-hidden mt-2">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-emerald-50 dark:bg-emerald-500/10 border-b border-emerald-100 dark:border-emerald-500/30">
        <div>
          <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
            {before.method} {pathOf(before.url)}
          </span>
          <span className="text-xs text-emerald-500 ml-2">shape comparison</span>
        </div>
        <button onClick={onClose} className="text-emerald-400 hover:text-emerald-700 text-lg leading-none">×</button>
      </div>

      <div className="p-4 space-y-5">
        {/* Summary pills */}
        <div className="flex flex-wrap gap-2">
          {changes.length === 0 ? (
            <span className="text-sm font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-3 py-1 rounded-full">
              ✓ No shape differences detected
            </span>
          ) : (
            Object.entries(groups)
              .filter(([, arr]) => arr.length > 0)
              .map(([kind, arr]) => {
                const s = KIND_STYLE[kind];
                return (
                  <span key={kind} className={`text-xs font-semibold px-2.5 py-1 rounded-full ${s.bg} ${s.text}`}>
                    {s.label} ({arr.length})
                  </span>
                );
              })
          )}
        </div>

        {/* Change list */}
        {changes.length > 0 && (
          <div className="space-y-1">
            {Object.entries(groups)
              .filter(([, arr]) => arr.length > 0)
              .flatMap(([kind, arr]) =>
                arr.map((c) => {
                  const s = KIND_STYLE[kind];
                  return (
                    <div key={c.path + kind} className={`flex items-start gap-2 text-xs rounded px-2 py-1 ${s.bg}`}>
                      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
                      <span className={`font-mono font-medium ${s.text}`}>{c.path || '(root)'}</span>
                      <span className={`ml-auto shrink-0 ${s.text} opacity-70`}>
                        {kind === 'added'        && `(${c.valueType})`}
                        {kind === 'removed'      && `(${c.valueType})`}
                        {kind === 'type_changed' && `${c.from} → ${c.to}`}
                      </span>
                    </div>
                  );
                })
              )}
          </div>
        )}

        {/* Highlighted side-by-side bodies */}
        <DiffBody
          textA={prettyBefore}
          textB={prettyAfter}
          labelA={`Before · ${formatTs(before.timestamp)} · ${before.status} · ${before.duration}ms`}
          labelB={`After · ${formatTs(after.timestamp)} · ${after.status} · ${after.duration}ms`}
          changes={changes}
        />

        {/* Accept action */}
        <div className="flex items-center justify-between pt-1 border-t border-gray-100 dark:border-gray-800">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {changes.length === 0
              ? 'Responses are identical — safe to remove either.'
              : 'Review the changes above, then accept the new version if the shape looks correct.'}
          </p>
          <button
            onClick={() => onAcceptNew(before)}
            className="shrink-0 ml-4 bg-green-600 hover:bg-green-700 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
          >
            ✓ Accept new — remove old
          </button>
        </div>
      </div>
    </div>
  );
}
