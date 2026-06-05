const DOMAIN_BADGE = {
  authentication: 'bg-blue-100 dark:bg-blue-500/20 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-500/30',
  content:        'bg-green-100 dark:bg-green-500/20 text-green-800 dark:text-green-300 border-green-200 dark:border-green-500/30',
  user:           'bg-purple-100 dark:bg-purple-500/20 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-500/30',
  navigation:     'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
  other:          'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700',
};

function fmt(ms) {
  if (!ms || ms <= 0) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export default function StationList({ stations }) {
  return (
    <div className="space-y-1">
      {stations.map((station, i) => (
        <div key={station.id} className="flex gap-3">
          <div className="flex flex-col items-center pt-0.5">
            <div className="w-6 h-6 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
              {i + 1}
            </div>
            {i < stations.length - 1 && (
              <div className="w-px flex-1 bg-gray-200 mt-1" style={{ minHeight: '1.5rem' }} />
            )}
          </div>

          <div className="pb-4 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">{station.label}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${DOMAIN_BADGE[station.domain] ?? DOMAIN_BADGE.other}`}>
                {station.domain}
              </span>
              {fmt(station.durationMs) && (
                <span className="text-xs text-gray-400 dark:text-gray-500">{fmt(station.durationMs)}</span>
              )}
            </div>

            {station.actions.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {station.actions.map((a, j) => (
                  <li key={j} className="text-xs text-gray-500 dark:text-gray-400 flex gap-1.5">
                    <span className="text-gray-300 select-none">›</span>
                    {a}
                  </li>
                ))}
              </ul>
            )}

            {station.apis.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {station.apis.map((api, j) => (
                  <code key={j} className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded font-mono">
                    {api}
                  </code>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
