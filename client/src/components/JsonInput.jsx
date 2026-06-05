import { useState, useRef } from 'react';

export default function JsonInput({ onAnalyze, loading }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setText(ev.target.result);
    reader.readAsText(file);
  }

  function handleSubmit() {
    setError('');
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError('Invalid JSON — check your recording format.');
      return;
    }
    onAnalyze(parsed);
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-800 shadow-soft p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Recording</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Paste or upload a session recording JSON</p>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          className="text-sm text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 font-medium"
        >
          Upload file
        </button>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} />
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'{ "steps": [...], "networkRequests": [...] }'}
        rows={12}
        className="w-full font-mono text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
      />

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={loading || !text.trim()}
          className="btn-primary px-5"
        >
          {loading ? 'Analyzing...' : 'Analyze Journey'}
        </button>
      </div>
    </div>
  );
}
