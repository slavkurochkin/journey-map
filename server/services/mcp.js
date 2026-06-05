import { randomUUID } from 'node:crypto';
import db from '../db.js';

function parseTools(json) {
  if (!json) return [];
  try { const a = JSON.parse(json); return Array.isArray(a) ? a : []; } catch { return []; }
}
// Normalize a tools input (array or comma string) → clean string array.
function normalizeTools(tools) {
  const arr = Array.isArray(tools) ? tools : typeof tools === 'string' ? tools.split(',') : [];
  return [...new Set(arr.map((t) => String(t).trim()).filter(Boolean))];
}

// Enabled servers in the shape the Anthropic MCP connector expects (with the
// real auth token). Server-side only — never sent to the client. A non-empty
// allowlist becomes tool_configuration.allowed_tools (the model can call nothing else).
export function enabledMcpServers() {
  const rows = db.prepare('SELECT name, url, auth_token, allowed_tools FROM mcp_servers WHERE enabled = 1 ORDER BY created_at ASC').all();
  return rows.map((r) => {
    const allowed = parseTools(r.allowed_tools);
    return {
      type: 'url',
      name: r.name,
      url: r.url,
      ...(r.auth_token ? { authorization_token: r.auth_token } : {}),
      ...(allowed.length ? { tool_configuration: { enabled: true, allowed_tools: allowed } } : {}),
    };
  });
}

// Client-safe view: omit the token, expose only whether one is set.
export function listMcpServers() {
  const rows = db.prepare('SELECT id, name, url, enabled, auth_token, allowed_tools, created_at FROM mcp_servers ORDER BY created_at ASC').all();
  return rows.map((r) => ({
    id: r.id, name: r.name, url: r.url, enabled: !!r.enabled, hasToken: !!r.auth_token,
    allowedTools: parseTools(r.allowed_tools), createdAt: r.created_at,
  }));
}

export function createMcpServer({ name, url, authToken, enabled = true, allowedTools }) {
  const id = randomUUID();
  const tools = normalizeTools(allowedTools);
  db.prepare('INSERT INTO mcp_servers (id, name, url, auth_token, enabled, allowed_tools, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, name.trim(), url.trim(), authToken?.trim() || null, enabled ? 1 : 0, tools.length ? JSON.stringify(tools) : null, new Date().toISOString());
  return id;
}

// Partial update. authToken: undefined = leave, '' / null = clear. allowedTools: undefined = leave, [] = clear.
export function updateMcpServer(id, { name, url, authToken, enabled, allowedTools }) {
  const cur = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id);
  if (!cur) return false;
  const tools = allowedTools !== undefined ? normalizeTools(allowedTools) : parseTools(cur.allowed_tools);
  const next = {
    name: name !== undefined ? name.trim() : cur.name,
    url: url !== undefined ? url.trim() : cur.url,
    auth_token: authToken !== undefined ? (authToken?.trim() || null) : cur.auth_token,
    enabled: enabled !== undefined ? (enabled ? 1 : 0) : cur.enabled,
    allowed_tools: tools.length ? JSON.stringify(tools) : null,
  };
  db.prepare('UPDATE mcp_servers SET name = ?, url = ?, auth_token = ?, enabled = ?, allowed_tools = ? WHERE id = ?')
    .run(next.name, next.url, next.auth_token, next.enabled, next.allowed_tools, id);
  return true;
}

export function deleteMcpServer(id) {
  db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
}
