import ScreenshotGallery from './ScreenshotGallery.jsx';
import ApiRequestList from './ApiRequestList.jsx';
import TraceList from './TraceList.jsx';
import ActionList from './ActionList.jsx';
import ServiceList from './ServiceList.jsx';
import FeatureFlagList from './FeatureFlagList.jsx';
import ObservabilityList from './ObservabilityList.jsx';
import IncidentList from './IncidentList.jsx';
import CoverageBadges from './CoverageBadges.jsx';
import StationDocs from './StationDocs.jsx';
import StationIdentity from './StationIdentity.jsx';

const DOMAIN_BADGE = {
  authentication: 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-1 ring-inset ring-blue-200/60 dark:ring-blue-500/30',
  content:        'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300 ring-1 ring-inset ring-green-200/60 dark:ring-green-500/30',
  user:           'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 ring-1 ring-inset ring-purple-200/60 dark:ring-purple-500/30',
  navigation:     'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-200/60 dark:ring-amber-500/30',
  other:          'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 ring-1 ring-inset ring-gray-200/60',
};

function fmt(ms) {
  if (!ms || ms <= 0) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export default function StationDetail({ station, onClose, sessionId, stations, onServiceChange, aggregateStations, onIdentityChange }) {
  if (!station) return null;
  // Aggregate stations carry sessionMappings (read-only, spans sessions).
  // Single-session view leaves it undefined so upload/move stay enabled.
  const aggregateMappings = station.sessionMappings?.length ? station.sessionMappings : null;

  const duration = fmt(station.durationMs);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft p-5 divide-y divide-gray-100 dark:divide-gray-800 [&>*]:pt-4 [&>*:first-child]:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 tracking-tight">{station.label}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${DOMAIN_BADGE[station.domain] ?? DOMAIN_BADGE.other}`}>
              {station.domain}
            </span>
          </div>
          <div className="flex gap-3 mt-1">
            {duration && <p className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">{duration} avg</p>}
            {station.visitCount > 0 && (
              <p className="text-xs text-emerald-500 font-medium tabular-nums">{station.visitCount} visit{station.visitCount !== 1 ? 's' : ''}</p>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-gray-300 hover:text-gray-500 text-xl leading-none shrink-0 transition-colors"
        >
          ×
        </button>
      </div>

      {station.canonicalKey && onIdentityChange && (
        <ColorSwatches station={station} onChange={onIdentityChange} />
      )}

      {station.canonicalKey && (
        <StationIdentity key={station.canonicalKey} station={station} others={aggregateStations} onChange={onIdentityChange} />
      )}

      {(station.actions?.length > 0 || (sessionId && !aggregateMappings)) && (
        <ActionList
          sessionId={aggregateMappings ? undefined : sessionId}
          stationId={station.id}
          canonicalKey={aggregateMappings && onIdentityChange ? station.canonicalKey : undefined}
          actions={station.actions || []}
          actionKeys={station.actionKeys || []}
          editable={(!!sessionId && !aggregateMappings) || (!!aggregateMappings && !!station.canonicalKey && !!onIdentityChange)}
          onChange={aggregateMappings ? onIdentityChange : undefined}
        />
      )}

      {station.apis?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">APIs</p>
          <div className="flex flex-wrap gap-1.5">
            {station.apis.map((api, i) => (
              <code key={i} className="text-xs bg-gray-50 dark:bg-gray-800/40 text-gray-600 dark:text-gray-400 px-2 py-1 rounded-md font-mono ring-1 ring-gray-200/70">
                {api}
              </code>
            ))}
          </div>
        </div>
      )}

      <ApiRequestList apis={station.apis} sessionId={sessionId} stationId={station.id} />

      <TraceList apis={station.apis} sessionId={sessionId} stationId={station.id} sessionMappings={aggregateMappings} />

      <ScreenshotGallery sessionMappings={aggregateMappings} sessionId={sessionId} stationId={station.id} stations={stations} />

      <StationDocs sessionMappings={aggregateMappings} sessionId={sessionId} stationId={station.id} />

      <CoverageBadges sessionMappings={aggregateMappings} sessionId={sessionId} stationId={station.id} />

      <ServiceList sessionMappings={aggregateMappings} sessionId={sessionId} stationId={station.id} suggestions={station.suggestedServices} apis={station.apis} onChange={onServiceChange} />

      <FeatureFlagList sessionMappings={aggregateMappings} sessionId={sessionId} stationId={station.id} />

      <ObservabilityList sessionMappings={aggregateMappings} sessionId={sessionId} stationId={station.id} />

      <IncidentList sessionMappings={aggregateMappings} sessionId={sessionId} stationId={station.id} />
    </div>
  );
}

const PALETTE = ['#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#6B7280'];

function ColorSwatches({ station, onChange }) {
  async function setColor(color) {
    await fetch('/api/sessions/aggregate/overrides', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canonicalKey: station.canonicalKey, color }),
    });
    onChange?.();
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 dark:text-gray-500">Color</span>
      <div className="flex gap-1.5">
        {PALETTE.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            title={c}
            className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${
              station.color === c ? 'ring-2 ring-offset-1 ring-gray-400' : ''
            }`}
            style={{ background: c }}
          />
        ))}
        <button
          onClick={() => setColor(null)}
          title="Reset to domain color"
          className={`w-5 h-5 rounded-full border border-gray-300 bg-white dark:bg-gray-900 text-gray-400 dark:text-gray-500 text-[10px] leading-none transition-transform hover:scale-110 ${
            !station.color ? 'ring-2 ring-offset-1 ring-gray-400' : ''
          }`}
        >
          ×
        </button>
      </div>
    </div>
  );
}
