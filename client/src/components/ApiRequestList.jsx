import { useState, useEffect, useRef } from 'react';
import JsonDiffView from './JsonDiffView.jsx';

const METHOD_STYLE = {
  GET:     'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300',
  POST:    'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300',
  PUT:     'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300',
  PATCH:   'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300',
  DELETE:  'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300',
  OPTIONS: 'bg-gray-50 dark:bg-gray-800/40 text-gray-500 dark:text-gray-400',
};

function statusStyle(s) {
  if (s >= 500) return 'text-red-600 dark:text-red-400';
  if (s >= 400) return 'text-amber-600 dark:text-amber-400';
  if (s >= 300) return 'text-blue-500';
  return 'text-green-600 dark:text-green-400';
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

function prettyJson(str) {
  if (!str || str === 'null') return null;
  try { return JSON.stringify(JSON.parse(str), null, 2); } catch { return str; }
}

function maskHeader(name, value) {
  if (name.toLowerCase() === 'authorization') {
    const [scheme] = value.split(' ');
    return `${scheme} ***`;
  }
  return value;
}

function HeaderTable({ headers = [] }) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {headers.map((h, i) => (
          <tr key={i} className="border-b border-gray-50 last:border-0">
            <td className="py-0.5 pr-3 text-gray-400 dark:text-gray-500 font-medium whitespace-nowrap align-top">{h.name}</td>
            <td className="py-0.5 text-gray-600 dark:text-gray-400 break-all">{maskHeader(h.name, h.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RequestRow({ req, sessionId, onDelete, compareBase, onSetBase, onCompareWith, isBase }) {
  const [open, setOpen] = useState(false);
  const [showReqHeaders, setShowReqHeaders] = useState(false);
  const [showResHeaders, setShowResHeaders] = useState(false);
  const [copied, setCopied] = useState(false);

  const body = prettyJson(req.responseBody);

  function copyBody() {
    navigator.clipboard.writeText(body ?? req.responseBody ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={`border rounded-lg overflow-hidden transition-colors ${isBase ? 'border-emerald-300' : 'border-gray-100 dark:border-gray-800'}`}>
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded shrink-0 ${METHOD_STYLE[req.method] ?? METHOD_STYLE.GET}`}>
          {req.method}
        </span>
        <span className="text-xs text-gray-700 dark:text-gray-300 font-mono truncate flex-1" title={req.url}>
          {pathOf(req.url)}
        </span>
        {req.source === 'recording' && (
          <span className="text-[10px] font-medium text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-500/10 px-1.5 py-0.5 rounded shrink-0" title="Auto-imported from the recording">
            auto
          </span>
        )}
        <span className={`text-xs font-semibold shrink-0 ${statusStyle(req.status)}`}>{req.status}</span>
        {req.duration != null && (
          <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">{req.duration}ms</span>
        )}
        {req.timestamp && (
          <span className="text-xs text-gray-300 shrink-0 hidden sm:inline">{formatTs(req.timestamp)}</span>
        )}

        {/* Compare controls */}
        {!compareBase && (
          <button
            onClick={(e) => { e.stopPropagation(); onSetBase(req); }}
            className="text-xs text-emerald-400 hover:text-emerald-600 font-medium shrink-0 transition-colors"
            title="Use as compare base"
          >
            Compare
          </button>
        )}
        {compareBase && !isBase && (
          <button
            onClick={(e) => { e.stopPropagation(); onCompareWith(req); }}
            className="text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 font-semibold shrink-0 transition-colors"
            title="Compare with base"
          >
            Compare →
          </button>
        )}
        {isBase && (
          <span className="text-xs bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-semibold px-1.5 py-0.5 rounded shrink-0">
            Base
          </span>
        )}

        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="text-gray-300 hover:text-red-400 text-sm leading-none shrink-0 transition-colors"
          title="Remove"
        >×</button>
        <span className="text-gray-300 text-xs">{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div className="border-t border-gray-100 dark:border-gray-800 px-3 py-3 space-y-3 bg-gray-50/50 dark:bg-gray-800/40">
          <div>
            <button
              onClick={() => setShowReqHeaders((v) => !v)}
              className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide hover:text-gray-600 transition-colors"
            >
              Request Headers {showReqHeaders ? '▲' : '▼'}
            </button>
            {showReqHeaders && <div className="mt-1.5"><HeaderTable headers={req.requestHeaders} /></div>}
          </div>

          {req.requestBody && (
            <div>
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">Request Body</p>
              <pre className="text-xs font-mono bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded p-2 overflow-auto max-h-32 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {prettyJson(req.requestBody) ?? req.requestBody}
              </pre>
            </div>
          )}

          <div>
            <button
              onClick={() => setShowResHeaders((v) => !v)}
              className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide hover:text-gray-600 transition-colors"
            >
              Response Headers {showResHeaders ? '▲' : '▼'}
            </button>
            {showResHeaders && <div className="mt-1.5"><HeaderTable headers={req.responseHeaders} /></div>}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Response Body</p>
              <button onClick={copyBody} className="text-xs text-emerald-500 hover:text-emerald-700 font-medium transition-colors">
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            {body ? (
              <pre className="text-xs font-mono bg-gray-950 text-gray-100 rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap leading-relaxed">
                {body}
              </pre>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic">Empty</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ApiRequestList({ sessionId, stationId, apis = [] }) {
  // API requests are matched by endpoint signature across ALL sessions, so an
  // uploaded request attaches to every station calling the same endpoint.
  // Upload is only possible when a target sessionId is known (saved session).
  const canUpload = !!sessionId;

  const [requests, setRequests] = useState([]); // each tagged with its own sessionId
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [compareBase, setCompareBase] = useState(null);
  const [diffPair, setDiffPair] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    fetchRequests();
  }, [apis.join(','), sessionId, stationId]);

  async function fetchRequests() {
    const calls = [];

    // 1. Cross-session matches by endpoint signature (shared detail)
    if (apis.length) {
      const query = apis.map((a) => encodeURIComponent(a)).join(',');
      calls.push(fetch(`/api/sessions/requests/by-endpoints?endpoints=${query}`).then((r) => (r.ok ? r.json() : [])));
    }
    // 2. Requests uploaded directly to this station (covers stations with no detected endpoints)
    if (sessionId && stationId) {
      calls.push(fetch(`/api/sessions/${sessionId}/requests?stationId=${stationId}`).then((r) => (r.ok ? r.json() : [])));
    }

    if (!calls.length) { setRequests([]); return; }

    const results = (await Promise.all(calls)).flat();
    // Dedupe by request id (a directly-uploaded request may also match by endpoint)
    const seen = new Set();
    setRequests(results.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true))));
  }

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await fetch(`/api/sessions/${sessionId}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationId, data }),
      });
      await fetchRequests();
    } catch {
      setError('Invalid JSON file');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleDelete(req) {
    await fetch(`/api/sessions/${req.sessionId}/requests/${req.id}`, { method: 'DELETE' });
    setRequests((prev) => prev.filter((r) => r.id !== req.id));
    if (compareBase?.id === req.id) setCompareBase(null);
    if (diffPair?.a?.id === req.id || diffPair?.b?.id === req.id) setDiffPair(null);
  }

  function handleSetBase(req) {
    setCompareBase(req);
    setDiffPair(null);
  }

  function handleCompareWith(req) {
    setDiffPair({ a: compareBase, b: req });
  }

  async function handleAcceptNew(oldReq) {
    await fetch(`/api/sessions/${oldReq.sessionId}/requests/${oldReq.id}`, { method: 'DELETE' });
    setRequests((prev) => prev.filter((r) => r.id !== oldReq.id));
    clearCompare();
  }

  function clearCompare() {
    setCompareBase(null);
    setDiffPair(null);
  }

  if (!sessionId && !apis.length) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
          API Requests {requests.length > 0 && `(${requests.length})`}
        </p>
        <div className="flex gap-3">
          {compareBase && (
            <button onClick={clearCompare} className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 transition-colors">
              Cancel compare
            </button>
          )}
          {canUpload && (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="text-xs text-emerald-500 hover:text-emerald-700 font-medium disabled:opacity-40 transition-colors"
            >
              {uploading ? 'Uploading…' : '+ Add'}
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={handleUpload} />
      </div>

      {compareBase && !diffPair && (
        <p className="text-xs text-emerald-500 italic mb-2">
          Base selected — click <strong>Compare →</strong> on another request
        </p>
      )}

      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

      {requests.length === 0 ? (
        <p className="text-xs text-gray-300 italic">No API requests uploaded for this station.</p>
      ) : (
        <div className="space-y-1.5">
          {requests.map((req) => (
            <RequestRow
              key={req.id}
              req={req}
              sessionId={req.sessionId}
              onDelete={() => handleDelete(req)}
              compareBase={compareBase}
              isBase={compareBase?.id === req.id}
              onSetBase={handleSetBase}
              onCompareWith={handleCompareWith}
            />
          ))}
        </div>
      )}

      {diffPair && (
        <JsonDiffView
          reqA={diffPair.a}
          reqB={diffPair.b}
          onClose={clearCompare}
          onAcceptNew={handleAcceptNew}
        />
      )}
    </div>
  );
}
