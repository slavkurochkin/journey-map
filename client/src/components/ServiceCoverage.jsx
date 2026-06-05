import { useState, useEffect, useRef } from 'react';
import Icon from './Icon.jsx';

const CYCLE = [undefined, 'covered', 'partial', 'none'];
const CELL = {
  undefined: { sym: '·', cls: 'text-gray-300 bg-gray-50 dark:bg-gray-800/40 hover:bg-gray-100 dark:hover:bg-gray-800' },
  covered:   { sym: '✓', cls: 'text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-500/20 hover:bg-green-200' },
  partial:   { sym: '~', cls: 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/20 hover:bg-amber-200' },
  none:      { sym: '✕', cls: 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-500/20 hover:bg-red-200' },
};

export default function ServiceCoverage({ sessionId, onChange, refreshKey = 0 }) {
  const [services, setServices] = useState([]); // [{ name, coverage }]
  const [preview, setPreview] = useState(null);  // lcov import preview
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    if (sessionId) fetchServices();
  }, [sessionId, refreshKey]);

  async function fetchServices() {
    const res = await fetch(`/api/sessions/${sessionId}/services`);
    if (res.ok) setServices(await res.json());
  }

  async function cycle(svc) {
    const next = CYCLE[(CYCLE.indexOf(svc.coverage ?? undefined) + 1) % CYCLE.length];
    setServices((prev) => prev.map((s) => (s.name === svc.name ? { ...s, coverage: next ?? null } : s)));
    await fetch(`/api/sessions/${sessionId}/service-coverage`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: svc.name, coverage: next ?? '' }),
    });
    onChange?.();
  }

  async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    setImporting(true);
    try {
      const lcov = await file.text();
      const res = await fetch(`/api/sessions/${sessionId}/coverage/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lcov }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setPreview(data.preview);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  async function applyPreview() {
    const toApply = preview.filter((p) => p.status);
    await Promise.all(toApply.map((p) =>
      fetch(`/api/sessions/${sessionId}/service-coverage`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: p.name, coverage: p.status }),
      })
    ));
    setPreview(null);
    await fetchServices();
    onChange?.();
  }

  if (!sessionId) return null;

  const covered = services.filter((s) => s.coverage === 'covered').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Service unit tests</p>
        {services.length > 0 && (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="text-xs text-emerald-500 hover:text-emerald-700 font-medium disabled:opacity-40 transition-colors inline-flex items-center gap-1"
            title="Import coverage from an lcov.info report"
          >
            <Icon name="import" size={13} />
            {importing ? 'Importing…' : 'Import lcov'}
          </button>
        )}
        <input ref={fileRef} type="file" accept=".info,.lcov,text/plain" className="hidden" onChange={handleImport} />
      </div>

      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

      {/* lcov import preview */}
      {preview && (
        <div className="mb-3 border border-emerald-200 dark:border-emerald-500/30 rounded-lg p-3 bg-emerald-50/40 dark:bg-emerald-500/10">
          <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300 mb-2">Coverage matched from report — review & apply</p>
          <table className="w-full text-xs">
            <tbody>
              {preview.map((p) => (
                <tr key={p.name} className="border-t border-emerald-100/60 dark:border-emerald-500/30">
                  <td className="py-1 pr-3 font-mono text-gray-700 dark:text-gray-300">{p.name}</td>
                  <td className="py-1 text-gray-500 dark:text-gray-400">
                    {p.percent == null ? <span className="text-gray-300">no match</span> : `${p.percent}% · ${p.files} file${p.files !== 1 ? 's' : ''}`}
                  </td>
                  <td className="py-1 text-right">
                    {p.status && <span className={`font-bold ${CELL[p.status].cls.split(' ')[0]}`}>{CELL[p.status].sym} {p.status}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end gap-3 mt-2">
            <button onClick={() => setPreview(null)} className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600">Cancel</button>
            <button
              onClick={applyPreview}
              disabled={!preview.some((p) => p.status)}
              className="text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 px-3 py-1 rounded-lg transition-colors"
            >
              Apply matched
            </button>
          </div>
        </div>
      )}

      {services.length === 0 ? (
        <p className="text-xs text-gray-300 italic">No services added yet — add them in a station's detail panel.</p>
      ) : (
        <>
          <table className="w-full text-xs border-collapse">
            <tbody>
              {services.map((svc) => {
                const cell = CELL[svc.coverage ?? undefined];
                return (
                  <tr key={svc.name} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="py-1.5 pr-3 text-gray-700 dark:text-gray-300 font-medium font-mono">{svc.name}</td>
                    <td className="text-right py-1 w-12">
                      <button
                        onClick={() => cycle(svc)}
                        title={`unit tests: ${svc.coverage ?? 'not set'} (click to change)`}
                        className={`w-7 h-7 rounded font-bold transition-colors ${cell.cls}`}
                      >
                        {cell.sym}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">{covered}/{services.length} services unit-tested</p>
        </>
      )}
    </div>
  );
}
