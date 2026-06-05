import { useState, useEffect } from 'react';
import JsonInput from './components/JsonInput.jsx';
import JourneyResult from './components/JourneyResult.jsx';
import SessionsTab from './components/SessionsTab.jsx';
import ImpactTab from './components/ImpactTab.jsx';
import { useTheme } from './theme.jsx';
import { Sun, Moon, Settings, Route } from 'lucide-react';
import SettingsModal from './components/SettingsModal.jsx';

const PROVIDER = {
  anthropic: { label: 'Claude', dot: 'bg-emerald-500' },
  openai:    { label: 'OpenAI', dot: 'bg-emerald-500' },
  ollama:    { label: 'Ollama', dot: 'bg-gray-400' },
};

export default function App() {
  const [tab, setTab] = useState('analyze');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusStation, setFocusStation] = useState(null); // concern → highlight on map
  const [reportId, setReportId] = useState(null); // shared impact report from ?report=<id>
  const [aiSettings, setAiSettings] = useState(null); // active provider/model for the header pill
  const { dark, toggle } = useTheme();

  useEffect(() => {
    fetch('/api/settings').then((r) => (r.ok ? r.json() : null)).then(setAiSettings).catch(() => {});
  }, []);

  // A shared-report deep link wins over the default landing tab.
  useEffect(() => {
    const shared = new URLSearchParams(window.location.search).get('report');
    if (shared) {
      setReportId(shared);
      setTab('impact');
      return;
    }
    // Land on the aggregate map (Sessions) when there's saved data; otherwise
    // start on Analyze so a first-time user has somewhere actionable.
    fetch('/api/sessions?limit=1')
      .then((r) => (r.ok ? r.json() : { total: 0 }))
      .then((data) => { if ((data.total ?? 0) > 0) setTab('sessions'); })
      .catch(() => {});
  }, []);

  // Jump from an impact concern to the station on the aggregate map.
  function viewOnMap(station) {
    setFocusStation({ ...station, nonce: Date.now() });
    setTab('sessions');
  }
  const [result, setResult] = useState(null);
  const [recording, setRecording] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  async function handleAnalyze(rec) {
    setLoading(true);
    setError(null);
    setResult(null);
    setRecording(rec);
    setSaveSuccess(false);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Analysis failed');
      }
      setResult(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recording, result }),
      });
      setSaveSuccess(true);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen text-gray-900 dark:text-gray-100">
      <header className="sticky top-0 z-30 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-200/70 dark:border-gray-800 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0 select-none">
            <div
              className="shrink-0 w-8 h-8 rounded-lg bg-emerald-600 dark:bg-emerald-500 flex items-center justify-center shadow-sm ring-1 ring-black/5 dark:ring-white/10"
              aria-hidden
            >
              <Route size={15} className="text-white" strokeWidth={2.25} />
            </div>
            <div className="min-w-0 flex flex-col gap-1">
              <h1 className="text-sm font-semibold text-gray-900 dark:text-gray-100 tracking-tight leading-none">
                Journey Map
              </h1>
              <p className="hidden sm:block text-[11px] text-gray-500 dark:text-gray-400 leading-none tracking-wide">
                Understand changes before you ship
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <nav className="flex gap-1 bg-gray-100/80 dark:bg-gray-800/80 p-1 rounded-xl ring-1 ring-gray-200/60 dark:ring-gray-700/60">
              {['analyze', 'sessions', 'impact'].map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`text-sm font-medium px-4 py-1.5 rounded-lg capitalize transition-all ${
                    tab === t
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-soft'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </nav>
            {aiSettings?.provider && (
              <button
                onClick={() => setSettingsOpen(true)}
                title="Active AI provider & model — click to change"
                className="hidden sm:flex items-center gap-1.5 max-w-[220px] text-xs font-medium px-2.5 py-1.5 rounded-xl bg-gray-100/80 dark:bg-gray-800/80 ring-1 ring-gray-200/60 dark:ring-gray-700/60 text-gray-600 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-gray-700/70 transition-colors"
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PROVIDER[aiSettings.provider]?.dot ?? 'bg-gray-400'}`} />
                <span className="shrink-0">{PROVIDER[aiSettings.provider]?.label ?? aiSettings.provider}</span>
                <span className="font-mono text-gray-400 dark:text-gray-500 truncate">{aiSettings.model}</span>
              </button>
            )}
            <button
              onClick={toggle}
              title={dark ? 'Switch to light' : 'Switch to dark'}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              title="AI provider settings"
              className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <Settings size={17} />
            </button>
          </div>
        </div>
      </header>

      <main className="px-6 py-8 space-y-6 max-w-[1600px] mx-auto">
        {tab === 'analyze' && (
          <>
            <JsonInput onAnalyze={handleAnalyze} loading={loading} />

            {error && (
              <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg p-4 text-red-700 dark:text-red-300 text-sm">
                {error}
              </div>
            )}

            {loading && (
              <div className="text-center py-20 text-gray-400 dark:text-gray-500">
                <div className="inline-block w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-sm">Analyzing journey with Claude...</p>
              </div>
            )}

            {result && (
              <>
                <div className="flex justify-end">
                  <button
                    onClick={handleSave}
                    disabled={saving || saveSuccess}
                    className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
                      saveSuccess
                        ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300 cursor-default'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50'
                    }`}
                  >
                    {saveSuccess ? '✓ Saved' : saving ? 'Saving...' : 'Save Session'}
                  </button>
                </div>
                <JourneyResult result={result} />
              </>
            )}
          </>
        )}

        {tab === 'sessions' && (
          <SessionsTab focusStation={focusStation} onFocusConsumed={() => setFocusStation(null)} />
        )}

        {tab === 'impact' && (
          <ImpactTab onViewOnMap={viewOnMap} reportId={reportId} onReportConsumed={() => setReportId(null)} />
        )}
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={setAiSettings} />
    </div>
  );
}
