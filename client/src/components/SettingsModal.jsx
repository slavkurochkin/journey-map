import { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, Check, AlertTriangle } from 'lucide-react';
import McpServers from './McpServers.jsx';

const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic · Claude', hint: 'Best quality for structured analysis.', key: 'ANTHROPIC_API_KEY' },
  { id: 'openai', name: 'OpenAI', hint: 'GPT models via the OpenAI API.', key: 'OPENAI_API_KEY' },
  { id: 'ollama', name: 'Ollama · local', hint: 'Runs offline on your machine. No API key, no cost.', key: null },
];

export default function SettingsModal({ open, onClose, onSaved }) {
  const [cfg, setCfg] = useState(null);
  const [provider, setProvider] = useState('anthropic');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434');
  const [smartRouting, setSmartRouting] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [tokenParam, setTokenParam] = useState('auto');
  const [maxTokens, setMaxTokens] = useState('4096');
  const [temperature, setTemperature] = useState(''); // blank = provider default
  const [forceJson, setForceJson] = useState(true);
  const [ollamaModels, setOllamaModels] = useState([]);
  const [ollamaErr, setOllamaErr] = useState(null);
  const [ollamaLoading, setOllamaLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        setCfg(d); setProvider(d.provider); setModel(d.model); setBaseUrl(d.ollamaBaseUrl);
        setSmartRouting(d.smartRouting !== false);
        setTokenParam(d.tokenParam || 'auto');
        setMaxTokens(String(d.maxTokens ?? 4096));
        setTemperature(d.temperature == null ? '' : String(d.temperature));
        setForceJson(d.forceJson !== false);
      });
  }, [open]);

  const loadOllama = useCallback((url) => {
    setOllamaLoading(true);
    setOllamaErr(null);
    fetch(`/api/settings/ollama-models?baseUrl=${encodeURIComponent(url ?? baseUrl)}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (ok) setOllamaModels(d.models || []);
        else { setOllamaErr(d.error); setOllamaModels([]); }
      })
      .catch((e) => setOllamaErr(e.message))
      .finally(() => setOllamaLoading(false));
  }, [baseUrl]);

  useEffect(() => { if (open && provider === 'ollama') loadOllama(); }, [open, provider]); // eslint-disable-line

  if (!open) return null;
  const status = cfg?.status || {};

  function pick(p) {
    setProvider(p);
    setModel(cfg?.models?.[p] ?? cfg?.defaults?.[p] ?? '');
  }

  async function save() {
    setSaving(true);
    try {
      const r = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider, model: model.trim(), ollamaBaseUrl: baseUrl.trim(), smartRouting,
          tokenParam, maxTokens: parseInt(maxTokens, 10) || 4096, temperature: temperature.trim(), forceJson,
        }),
      });
      const d = await r.json();
      setCfg(d);
      onSaved?.(d);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-gray-900/40 dark:bg-black/60 backdrop-blur-sm" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-soft-lg border border-gray-200/70 dark:border-gray-800 max-h-[88vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900 rounded-t-2xl">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">AI Provider</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Choose which model runs analysis and impact.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Provider cards */}
          <div className="space-y-2">
            {PROVIDERS.map((p) => {
              const active = provider === p.id;
              const available = status[p.id] !== false;
              return (
                <button
                  key={p.id}
                  onClick={() => pick(p.id)}
                  className={`w-full text-left px-3.5 py-3 rounded-xl border transition-colors ${
                    active
                      ? 'border-emerald-400 dark:border-emerald-500/60 bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-300/50 dark:ring-emerald-500/30'
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{p.name}</span>
                    {active && <Check size={15} className="text-emerald-600 dark:text-emerald-400" />}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{p.hint}</p>
                  {p.key && !available && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                      <AlertTriangle size={12} /> {p.key} not set — add it to server/.env
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          {/* Ollama base URL */}
          {provider === 'ollama' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Ollama URL</label>
              <div className="flex gap-2">
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  className="flex-1 text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
                <button
                  onClick={() => loadOllama()}
                  title="Refresh model list"
                  className="px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/40"
                >
                  <RefreshCw size={15} className={ollamaLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>
          )}

          {/* Model */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Model</label>
            {provider === 'ollama' && ollamaModels.length > 0 ? (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              >
                {!ollamaModels.includes(model) && <option value={model}>{model} (not installed)</option>}
                {ollamaModels.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={cfg?.defaults?.[provider] || 'model name'}
                className="w-full text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            )}
            {provider === 'ollama' && ollamaErr && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                <AlertTriangle size={12} /> {ollamaErr}
              </p>
            )}
            {provider === 'ollama' && !ollamaErr && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {ollamaModels.length ? `${ollamaModels.length} model${ollamaModels.length !== 1 ? 's' : ''} installed` : 'No models found — run e.g. `ollama pull llama3.1:8b`'}
              </p>
            )}
          </div>

          {provider === 'anthropic' && (
            <div className="flex items-start justify-between gap-3 pt-1">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Smart routing</label>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 leading-relaxed max-w-[18rem]">
                  Run easy tasks (initial analysis &amp; follow-up chat) on Haiku to cut cost. Impact analysis and test plans always use the model above.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={smartRouting}
                onClick={() => setSmartRouting((v) => !v)}
                title={smartRouting ? 'Smart routing on' : 'Smart routing off'}
                className={`relative shrink-0 w-10 h-6 rounded-full transition-colors ${smartRouting ? 'bg-emerald-600' : 'bg-gray-300 dark:bg-gray-600'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${smartRouting ? 'translate-x-4' : ''}`} />
              </button>
            </div>
          )}

          {provider !== 'anthropic' && (
            <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
              Note: this tool relies on strict JSON output. Smaller local models are less reliable at that than Claude — use a capable model for best results.
            </p>
          )}

          {/* Advanced model parameters */}
          <div className="pt-1 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors mt-3"
            >
              <span className="text-gray-400 dark:text-gray-500 text-[10px]">{advancedOpen ? '▾' : '▸'}</span>
              Advanced model parameters
            </button>

            {advancedOpen && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Max output tokens</label>
                  <input
                    type="number"
                    min="1"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(e.target.value)}
                    placeholder="4096"
                    className="w-full text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Temperature</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                    placeholder="provider default"
                    className="w-full text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Leave blank to use the provider default — recommended for o1/o3 reasoning models, which reject custom values.</p>
                </div>

                {provider === 'openai' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Token limit parameter</label>
                      <select
                        value={tokenParam}
                        onChange={(e) => setTokenParam(e.target.value)}
                        className="w-full text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      >
                        <option value="auto">Auto (recommended)</option>
                        <option value="max_tokens">max_tokens (older models)</option>
                        <option value="max_completion_tokens">max_completion_tokens (o1 / o3 / gpt-5)</option>
                      </select>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Auto sends <code className="font-mono">max_tokens</code>, then retries with <code className="font-mono">max_completion_tokens</code> if the model requires it.</p>
                    </div>

                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Force JSON mode</label>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 leading-relaxed max-w-[18rem]">
                          Sends <code className="font-mono">response_format=json_object</code>. Turn off for models that reject it — the parser still extracts JSON from the reply.
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={forceJson}
                        onClick={() => setForceJson((v) => !v)}
                        title={forceJson ? 'Force JSON on' : 'Force JSON off'}
                        className={`relative shrink-0 w-10 h-6 rounded-full transition-colors ${forceJson ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${forceJson ? 'translate-x-4' : ''}`} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <McpServers open={open} provider={provider} />
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-800 sticky bottom-0 bg-white dark:bg-gray-900 rounded-b-2xl">
          <button onClick={onClose} className="text-sm font-medium px-4 py-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
            Cancel
          </button>
          <button onClick={save} disabled={saving} className="btn-primary px-5 disabled:opacity-50">
            {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
