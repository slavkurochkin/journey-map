import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

// Self-hosted MCP client host for providers without a hosted connector (OpenAI,
// Ollama). Connects to enabled servers, exposes their (allowlisted) tools as
// OpenAI function definitions, and routes tool calls back to the right server.
// Per-server failures are isolated so one bad server never breaks the chat.

const withTimeout = (p, ms, msg) =>
  Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms))]);

// OpenAI function names must match ^[a-zA-Z0-9_-]{1,64}$
const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

async function connectServer(server) {
  const headers = server.authorization_token ? { Authorization: `Bearer ${server.authorization_token}` } : {};
  const url = new URL(server.url);
  const client = new Client({ name: 'journey-map', version: '1.0.0' });
  // Prefer modern Streamable HTTP; fall back to SSE for older servers.
  try {
    await withTimeout(client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } })), 8000, 'connect timeout');
  } catch {
    await withTimeout(client.connect(new SSEClientTransport(url, { requestInit: { headers } })), 8000, 'connect timeout (sse)');
  }
  return client;
}

// servers: output of enabledMcpServers() ({ name, url, authorization_token?, tool_configuration? }).
export async function buildMcpHost(servers) {
  const clients = [];
  const tools = [];        // OpenAI tool defs
  const route = new Map(); // sanitized fn name → { client, toolName }

  for (const server of servers) {
    let client;
    try {
      client = await connectServer(server);
    } catch (err) {
      console.warn(`[mcp] connect failed for "${server.name}": ${err.message}`);
      continue;
    }
    clients.push(client);

    const allow = server.tool_configuration?.allowed_tools;
    let list;
    try {
      list = (await client.listTools()).tools || [];
    } catch (err) {
      console.warn(`[mcp] listTools failed for "${server.name}": ${err.message}`);
      continue;
    }

    for (const t of list) {
      if (allow && !allow.includes(t.name)) continue;
      const fnName = sanitize(`${server.name}__${t.name}`);
      route.set(fnName, { client, toolName: t.name });
      tools.push({
        type: 'function',
        function: {
          name: fnName,
          description: t.description || `${t.name} (via ${server.name})`,
          parameters: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} },
        },
      });
    }
  }

  return {
    tools,
    async callTool(fnName, args) {
      const r = route.get(fnName);
      if (!r) throw new Error(`Unknown tool: ${fnName}`);
      const res = await r.client.callTool({ name: r.toolName, arguments: args || {} });
      const blocks = Array.isArray(res?.content) ? res.content : [];
      const text = blocks.map((b) => (b.type === 'text' ? b.text : JSON.stringify(b))).join('\n').trim();
      return text || (res?.isError ? 'Tool returned an error.' : 'No content.');
    },
    async close() {
      await Promise.allSettled(clients.map((c) => c.close()));
    },
  };
}
