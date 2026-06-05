import { useState, useEffect } from 'react';
import { Trash2 } from 'lucide-react';

// Manage connected remote MCP servers. The impact chat can call their tools on
// demand (Anthropic provider only — connector-first, no per-server client code).
export default function McpServers({ open, provider }) {
  const [servers, setServers] = useState([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [tools, setTools] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editTools, setEditTools] = useState(null); // { id, value }

  useEffect(() => { if (open) load(); }, [open]);

  async function load() {
    const res = await fetch('/api/mcp');
    if (res.ok) setServers(await res.json());
  }

  async function add(e) {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;
    setAdding(true);
    setError('');
    try {
      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url, authToken: token, allowedTools: tools }),
      });
      if (!res.ok) { setError((await res.json()).error || 'Failed to add'); return; }
      setName(''); setUrl(''); setToken(''); setTools(''); setShowAdd(false);
      await load();
    } finally {
      setAdding(false);
    }
  }

  async function toggle(s) {
    await fetch(`/api/mcp/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !s.enabled }),
    });
    setServers((prev) => prev.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)));
  }

  async function remove(s) {
    await fetch(`/api/mcp/${s.id}`, { method: 'DELETE' });
    setServers((prev) => prev.filter((x) => x.id !== s.id));
  }

  async function saveTools() {
    const { id, value } = editTools;
    await fetch(`/api/mcp/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowedTools: value }),
    });
    setEditTools(null);
    await load();
  }

  const input = 'w-full text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent';

  return (
    <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">Connected MCP servers</p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
            The impact chat can call these servers' tools.{provider === 'ollama' && ' Requires a tool-capable local model.'}
          </p>
        </div>
        {!showAdd && (
          <button onClick={() => setShowAdd(true)} className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 transition-colors shrink-0">
            + Connect
          </button>
        )}
      </div>

      {servers.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {servers.map((s) => (
            <div key={s.id} className="flex items-center gap-2.5 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
              <button
                type="button"
                role="switch"
                aria-checked={s.enabled}
                onClick={() => toggle(s)}
                title={s.enabled ? 'Enabled' : 'Disabled'}
                className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${s.enabled ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${s.enabled ? 'translate-x-4' : ''}`} />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{s.name}</p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 font-mono truncate">{s.url}{s.hasToken ? ' · 🔑' : ''}</p>
                {editTools?.id === s.id ? (
                  <div className="flex items-center gap-1.5 mt-1">
                    <input
                      autoFocus
                      value={editTools.value}
                      onChange={(e) => setEditTools({ id: s.id, value: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveTools(); if (e.key === 'Escape') setEditTools(null); }}
                      placeholder="tool names, comma-separated (blank = all)"
                      className="flex-1 text-[11px] text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                    <button onClick={saveTools} className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400">Save</button>
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                    {s.allowedTools?.length ? `tools: ${s.allowedTools.join(', ')}` : 'all tools'}
                    <button onClick={() => setEditTools({ id: s.id, value: (s.allowedTools || []).join(', ') })} className="ml-1.5 text-indigo-500 hover:text-indigo-700">edit</button>
                  </p>
                )}
              </div>
              <button onClick={() => remove(s)} className="text-gray-300 hover:text-red-500 shrink-0 self-start transition-colors" title="Remove">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <form onSubmit={add} className="mt-2 space-y-2 bg-gray-50/60 dark:bg-gray-800/30 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Sentry)" className={input} />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/sse" className={input} />
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Auth token (optional)" className={input} />
          <input value={tools} onChange={(e) => setTools(e.target.value)} placeholder="Allowed tools — comma-separated, blank = all" className={input} />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setShowAdd(false); setError(''); }} className="text-xs font-medium px-3 py-1.5 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
              Cancel
            </button>
            <button type="submit" disabled={adding || !name.trim() || !url.trim()} className="text-xs btn-primary px-3 py-1.5">
              {adding ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
