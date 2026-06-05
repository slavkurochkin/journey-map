import { analyzeRecording, assertConfigured } from './llm.js';
import { getSettings } from './settings.js';

// Prepare a recording for the LLM. Base64 screenshots are ALWAYS stripped (image
// bytes are useless to the model and enormous). Network bodies are only truncated
// for OpenAI, which has a much smaller context/TPM budget than Claude.
const MAX_BODY = 2000;
function sanitizeForLLM(recording, { truncateBodies = false } = {}) {
  const steps = (recording.steps ?? []).map((s) => {
    if (s.type === 'screenshot') {
      const { dataUrl, ...rest } = s;
      return { ...rest, dataUrl: '[screenshot omitted]' };
    }
    return s;
  });

  let networkRequests = recording.networkRequests ?? [];
  if (truncateBodies) {
    const trim = (b) =>
      typeof b === 'string' && b.length > MAX_BODY ? b.slice(0, MAX_BODY) + '…[truncated]' : b;
    networkRequests = networkRequests.map((r) => ({
      ...r,
      requestBody: trim(r.requestBody),
      responseBody: trim(r.responseBody),
    }));
  }

  return { ...recording, steps, networkRequests };
}

const DOMAIN_STYLES = {
  authentication: 'fill:#DBEAFE,stroke:#3B82F6,color:#1D4ED8',
  content:        'fill:#DCFCE7,stroke:#22C55E,color:#15803D',
  user:           'fill:#F3E8FF,stroke:#A855F7,color:#7E22CE',
  navigation:     'fill:#FEF3C7,stroke:#F59E0B,color:#B45309',
  other:          'fill:#F1F5F9,stroke:#94A3B8,color:#475569',
};

export async function runAnalysis(recording) {
  assertConfigured();
  // Claude has a large context budget and keeps full network bodies; OpenAI and
  // local Ollama models get truncated bodies to stay within tighter limits.
  const truncateBodies = getSettings().provider !== 'anthropic';
  const result = await analyzeRecording(sanitizeForLLM(recording, { truncateBodies }));
  result.mermaid = buildMermaid(result.stations, result.edges);
  return result;
}

export function buildMermaid(stations, edges) {
  const safeId = (id) => id.replace(/[^a-zA-Z0-9_]/g, '_');
  const lines = ['flowchart LR'];

  for (const s of stations) {
    lines.push(`  ${safeId(s.id)}["${s.label}"]`);
  }
  for (const e of edges) {
    lines.push(`  ${safeId(e.source)} --> ${safeId(e.target)}`);
  }
  for (const s of stations) {
    const style = DOMAIN_STYLES[s.domain] ?? DOMAIN_STYLES.other;
    lines.push(`  style ${safeId(s.id)} ${style}`);
  }

  return lines.join('\n');
}
