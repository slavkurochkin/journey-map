import { useState, useEffect } from 'react';
import ImpactAnalysis from './ImpactAnalysis.jsx';
import ImpactEvals from './ImpactEvals.jsx';
import ImpactReports from './ImpactReports.jsx';

export default function ImpactTab({ onViewOnMap, reportId = null, onReportConsumed }) {
  const [mode, setMode] = useState('analyze');
  const [loadedReport, setLoadedReport] = useState(null);

  // Open a shared report (?report=<id>) on first render.
  useEffect(() => {
    if (!reportId) return;
    fetch(`/api/sessions/impact/reports/${reportId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((rep) => { if (rep) { setLoadedReport(rep); setMode('analyze'); } })
      .finally(() => onReportConsumed?.());
  }, [reportId]);

  function openReport(rep) {
    setLoadedReport(rep);
    setMode('analyze');
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit">
        {[['analyze', 'Analyze'], ['reports', 'Reports'], ['evals', 'Evals']].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setMode(k)}
            className={`text-sm font-medium px-4 py-1.5 rounded-md transition-colors ${
              mode === k ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'analyze' && <ImpactAnalysis onViewOnMap={onViewOnMap} loadedReport={loadedReport} />}
      {mode === 'reports' && <ImpactReports onOpen={openReport} />}
      {mode === 'evals' && <ImpactEvals />}
    </div>
  );
}
