import { useState } from 'react';
import SubwayMap from './SubwayMap.jsx';
import StationDetail from './StationDetail.jsx';
import StationList from './StationList.jsx';
import ExportTabs from './ExportTabs.jsx';
import JourneyDocs from './JourneyDocs.jsx';
import Icon from './Icon.jsx';

function totalDuration(stations) {
  const ms = stations.reduce((sum, s) => sum + (s.durationMs || 0), 0);
  return ms > 0 ? (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`) : null;
}

export default function JourneyResult({ result, sessionId }) {
  const [selectedStation, setSelectedStation] = useState(null);
  const [serviceVersion, setServiceVersion] = useState(0); // bumps on any service change

  const duration = totalDuration(result.stations);
  const insightCount = result.insights?.length ?? 0;
  const bumpServices = () => setServiceVersion((v) => v + 1);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

        {/* Left column: summary + map */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{result.title}</h2>
            <div className="flex flex-wrap gap-4 mt-2 text-sm text-gray-500 dark:text-gray-400">
              <span>{result.stations.length} station{result.stations.length !== 1 ? 's' : ''}</span>
              {duration && <span>{duration} total</span>}
              {insightCount > 0 && (
                <span className="text-amber-600 dark:text-amber-400 font-medium">
                  {insightCount} insight{insightCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft overflow-hidden">
            <div className="px-6 pt-5 pb-2">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Journey Map</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Click a station to explore details</p>
            </div>
            <SubwayMap
              stations={result.stations}
              edges={result.edges}
              selectedStation={selectedStation}
              onStationSelect={setSelectedStation}
            />
          </div>

          <JourneyDocs />

          {insightCount > 0 && (
            <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-6">
              <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-3">Insights</h3>
              <ul className="space-y-2">
                {result.insights.map((insight, i) => (
                  <li key={i} className="flex gap-2 text-sm text-amber-700 dark:text-amber-300">
                    <Icon name="warning" size={14} className="mt-0.5 text-amber-500" />
                    {insight}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Right column: stations/detail + exports */}
        <div className="space-y-6">
          {selectedStation ? (
            <StationDetail
              station={selectedStation}
              onClose={() => setSelectedStation(null)}
              sessionId={sessionId}
              stations={result.stations}
              onServiceChange={bumpServices}
            />
          ) : (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft p-6">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Stations</h3>
              <StationList stations={result.stations} />
            </div>
          )}

          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft p-6">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Testing</h3>
            <ExportTabs result={result} sessionId={sessionId} serviceVersion={serviceVersion} />
          </div>
        </div>
      </div>

    </div>
  );
}
