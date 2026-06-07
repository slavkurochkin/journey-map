import { endpointKeyFromString } from './endpoints.js';

// Internal tools for the impact agent: instead of dumping the whole journey graph
// into the prompt, the model navigates it via these calls (backed by the already
// computed gatherStationContext()). Same tool-host shape as the MCP host:
// { tools: [OpenAI defs], callTool(name, args) → JSON string }.
export function buildImpactTools(context) {
  const stations = context.stations || [];
  const edges = context.edges || [];
  const byId = new Map(stations.map((s) => [s.id, s]));
  const norm = (s) => (s || '').toLowerCase();
  const brief = (s) => ({ id: s.id, label: s.label, domain: s.domain, apis: s.apis });

  const tools = [
    { type: 'function', function: { name: 'search_stations', description: 'Find journey stations matching a query (matches label, domain, endpoint, or service name). Returns brief matches.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
    { type: 'function', function: { name: 'get_station', description: 'Full detail for a station id: endpoints, services (with unitTestCoverage), feature flags, observability, past incidents, test coverage, design docs, and trace facts.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
    { type: 'function', function: { name: 'get_downstream', description: 'Stations that come AFTER the given station in the journey (via edges) and may depend on its output.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
    { type: 'function', function: { name: 'find_endpoint_consumers', description: 'Stations that call a given endpoint, e.g. "POST /api/auth/login".', parameters: { type: 'object', properties: { endpoint: { type: 'string' } }, required: ['endpoint'] } } },
    { type: 'function', function: { name: 'get_traces', description: 'Ground-truth distributed-trace facts for a station: servicesObserved, downstreamCalls, p95Ms, errorRate.', parameters: { type: 'object', properties: { stationId: { type: 'string' } }, required: ['stationId'] } } },
  ];

  const touched = new Set(); // station ids the agent actually engaged with (for the fallback)

  async function callTool(name, args = {}) {
    if (args.id) touched.add(args.id);
    if (args.stationId) touched.add(args.stationId);
    let out;
    switch (name) {
      case 'search_stations': {
        const q = norm(args.query);
        out = stations.filter((s) =>
          norm(s.label).includes(q) ||
          norm(s.domain).includes(q) ||
          (s.apis || []).some((a) => norm(a).includes(q)) ||
          (s.services || []).some((x) => norm(x.name).includes(q))
        ).map(brief);
        break;
      }
      case 'get_station':
        out = byId.get(args.id) || { error: `No station with id "${args.id}"` };
        break;
      case 'get_downstream':
        out = edges.filter((e) => e.source === args.id).map((e) => byId.get(e.target)).filter(Boolean).map(brief);
        break;
      case 'find_endpoint_consumers': {
        const key = endpointKeyFromString(args.endpoint || '');
        out = stations.filter((s) => (s.apis || []).some((a) => endpointKeyFromString(a) === key)).map(brief);
        break;
      }
      case 'get_traces': {
        const s = byId.get(args.stationId);
        out = s ? (s.traces || { note: 'No traces uploaded for this station.' }) : { error: `No station with id "${args.stationId}"` };
        break;
      }
      default:
        out = { error: `Unknown tool: ${name}` };
    }
    if (Array.isArray(out)) for (const x of out) if (x?.id) touched.add(x.id); // search/find/downstream hits
    return JSON.stringify(out);
  }

  return { tools, callTool, touched };
}
