import { useState } from 'react';
import CoverageMatrix from './CoverageMatrix.jsx';
import ServiceCoverage from './ServiceCoverage.jsx';

const TEXT_TABS = [
  { key: 'playwright', label: 'Playwright' },
  { key: 'gherkin',    label: 'Gherkin' },
  { key: 'markdown',   label: 'Markdown' },
];

export default function ExportTabs({ result, sessionId, serviceVersion = 0 }) {
  const [active, setActive] = useState('coverage');
  const [copied, setCopied] = useState(false);
  const [internalVersion, setInternalVersion] = useState(0); // bumps on service-matrix edits
  // Combined signal: external service changes (add/remove in station detail) + internal matrix edits
  const svcVersion = serviceVersion + internalVersion;

  const isText = active !== 'coverage';
  const content = isText ? (result[active] ?? '') : '';

  function handleCopy() {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleDownload() {
    const ext = { playwright: 'spec.ts', gherkin: 'feature', markdown: 'md' }[active];
    const blob = new Blob([content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `journey.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
          <button
            onClick={() => setActive('coverage')}
            className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
              active === 'coverage' ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
            }`}
          >
            Coverage
          </button>
          {TEXT_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActive(tab.key)}
              className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                active === tab.key ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {isText && (
          <div className="flex gap-3">
            <button onClick={handleDownload} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 font-medium">
              Download
            </button>
            <button onClick={handleCopy} className="text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 font-medium">
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}
      </div>

      {active === 'coverage' ? (
        <div className="space-y-5">
          <CoverageMatrix sessionId={sessionId} stations={result.stations} svcVersion={svcVersion} />
          <ServiceCoverage sessionId={sessionId} refreshKey={serviceVersion} onChange={() => setInternalVersion((v) => v + 1)} />
        </div>
      ) : (
        <pre className="bg-gray-950 text-gray-100 rounded-lg p-4 text-xs font-mono overflow-auto max-h-96 whitespace-pre-wrap leading-relaxed">
          {content || <span className="text-gray-500 dark:text-gray-400">No content generated</span>}
        </pre>
      )}
    </div>
  );
}
