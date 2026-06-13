import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { SYSTEM_PROMPT, IMPACT_SYSTEM_PROMPT, IMPACT_AGENT_SYSTEM_PROMPT, CRITIC_SYSTEM_PROMPT, IMPACT_CHAT_SYSTEM_PROMPT, TEST_PLAN_SYSTEM_PROMPT, CLARIFYING_QUESTIONS_PROMPT } from './prompt.js';
import { getSettings } from './settings.js';
import { enabledMcpServers } from './mcp.js';
import { buildMcpHost } from './mcpHost.js';
import { buildImpactTools } from './impactTools.js';
import { evalMemoryHint } from './impactMemory.js';
import db from '../db.js';

// Task routing as a *downgrade* that respects the Settings model as the ceiling:
// the easy, high-volume tasks drop to a cheaper model, while trust-critical tasks
// always honor whatever model you picked in Settings. Anthropic-only (the cheap
// model is a Claude ID) — other providers use the Settings model for everything.
const CHEAP_MODEL = 'claude-haiku-4-5';
const CHEAP_TASKS = new Set(['analyze', 'chat', 'questions']); // structured extraction + conversational follow-ups + clarifying questions

// The model that will actually run for a given task, given the active settings.
// Used by both transport() (to send it) and the memoization wrappers (to key on it).
function activeModelFor(label, settings) {
  const base = settings.model;
  if (!settings.smartRouting || settings.provider !== 'anthropic' || !CHEAP_TASKS.has(label)) return base;
  // Only downgrade when Haiku is genuinely cheaper than the chosen model, so an
  // explicit pick (e.g. Haiku itself) is never silently overridden upward.
  const baseRate = PRICING[base]?.in;
  const cheapRate = PRICING[CHEAP_MODEL]?.in;
  return (baseRate != null && cheapRate != null && baseRate > cheapRate) ? CHEAP_MODEL : base;
}

// The provider + model the impact analysis would actually use right now (after
// smart-routing). Lets the experiment tag each run so results compare across models.
export function activeImpactModel() {
  const settings = getSettings();
  return { provider: settings.provider, model: activeModelFor('impact', settings) };
}

// ---- App-level result memoization (100% off on exact repeats) ----
function cacheKey(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
function getCached(key) {
  const row = db.prepare('SELECT result FROM impact_cache WHERE key = ?').get(key);
  return row ? JSON.parse(row.result) : null;
}
function putCached(key, result) {
  db.prepare('INSERT OR REPLACE INTO impact_cache (key, result, created_at) VALUES (?, ?, ?)')
    .run(key, JSON.stringify(result), new Date().toISOString());
}

// Memoization controls — for demonstrating cache-hit ($0, instant) vs miss (real
// call, real cost/time).
export function impactCacheCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM impact_cache').get().c;
}
export function clearImpactCache() {
  return db.prepare('DELETE FROM impact_cache').run().changes;
}

// Extract the first COMPLETE JSON object/array via brace matching (handles
// trailing prose or a second block after the JSON — which a greedy regex botches).
function extractFirstJson(s) {
  const start = s.search(/[[{]/);
  if (start < 0) return null;
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

// Tolerant JSON parse: models often wrap output in prose or code fences, or emit
// a trailing block — fall back to the first complete {...} / [...].
function parseJsonResponse(text) {
  // Anthropic has no response_format guarantee, so it often wraps JSON in ```json
  // fences and occasionally adds a sentence of preamble/epilogue. Strip ALL fences
  // (anywhere, not just anchored), then fall back to the first complete {...}/[...]
  // block — and never let a recovery attempt throw a raw parse error.
  const stripped = String(text || '').replace(/```+(?:json)?/gi, '').trim();
  try {
    return JSON.parse(stripped);
  } catch { /* recover a bare block below */ }
  const block = extractFirstJson(stripped);
  if (block) {
    try { return JSON.parse(block); } catch { /* fall through to friendly error */ }
  }
  throw new Error('Model did not return valid JSON');
}

// Which providers are usable right now (keys present / assumed-local for Ollama).
export function providerStatus() {
  return {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    ollama: true,
  };
}

// Throw a clear error if the *active* provider can't run.
export function assertConfigured() {
  const { provider } = getSettings();
  const st = providerStatus();
  if (provider === 'anthropic' && !st.anthropic)
    throw new Error('Anthropic is selected but ANTHROPIC_API_KEY is not set. Add it to server/.env or pick another provider in Settings.');
  if (provider === 'openai' && !st.openai)
    throw new Error('OpenAI is selected but OPENAI_API_KEY is not set. Add it to server/.env or pick another provider in Settings.');
}

// Approx prices ($ per million tokens) for a rough cost readout in logs.
const PRICING = {
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 0.8, out: 4 },
  'claude-opus-4-8': { in: 15, out: 75 },
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
};

// Log token usage so you can verify caching is actually hitting. The two
// providers report it differently:
//   Anthropic → input_tokens (fresh) + cache_creation (write, 1.25x) + cache_read (0.1x)
//   OpenAI    → prompt_tokens (total) with prompt_tokens_details.cached_tokens (0.5x) inside it
// Normalize both to fresh / write / read so the line reads the same.
// Captures measured token usage + $ cost across every model call within a scope,
// surviving awaits and parallel branches — see withUsageCapture. logUsage writes
// into the active store if one is set, so no call site needs to thread a callback.
const usageStore = new AsyncLocalStorage();

// Run `fn` and return { value, usage:{ inputTokens, outputTokens, costUsd } } with
// the totals of every LLM call it made (one-shot + critic + any tool turns).
export async function withUsageCapture(fn) {
  const store = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const value = await usageStore.run(store, fn);
  return { value, usage: store };
}

function logUsage(label, provider, model, u) {
  if (!u) return;
  let fresh, write, read, out;
  if (provider === 'anthropic') {
    fresh = u.input_tokens ?? 0;
    write = u.cache_creation_input_tokens ?? 0;
    read = u.cache_read_input_tokens ?? 0;
    out = u.output_tokens ?? 0;
  } else {
    read = u.prompt_tokens_details?.cached_tokens ?? 0;
    fresh = (u.prompt_tokens ?? 0) - read;
    write = 0;
    out = u.completion_tokens ?? 0;
  }
  const promptTotal = fresh + write + read;
  const hit = promptTotal ? Math.round((read / promptTotal) * 100) : 0;
  let costNum = 0;
  const p = PRICING[model];
  if (p) {
    // Anthropic: write 1.25x, read 0.1x. OpenAI: cached read 0.5x, no write premium.
    const inCost = provider === 'anthropic'
      ? fresh * p.in + write * p.in * 1.25 + read * p.in * 0.1
      : fresh * p.in + read * p.in * 0.5;
    costNum = (inCost + out * p.out) / 1e6;
  }
  // Accumulate into the active capture scope, if any.
  const store = usageStore.getStore();
  if (store) { store.inputTokens += promptTotal; store.outputTokens += out; store.costUsd += costNum; }
  console.log(
    `[llm] ${label} · ${model} · in ${fresh} · write ${write} · read ${read} (${hit}% cached) · out ${out}${p ? ` · ~$${costNum.toFixed(5)}` : ''}`
  );
}

// Newer OpenAI models (o1/o3/gpt-5-era) reject `max_tokens` and require
// `max_completion_tokens`; older ones (gpt-4o, etc.) only accept `max_tokens`.
// Try the classic param, and on that specific 400 retry with the new one —
// then remember the model's choice so it's a one-time cost, not every call.
// No model list to maintain, so both old and new models keep working.
const OPENAI_TOKEN_PARAM = new Map(); // model → 'max_tokens' | 'max_completion_tokens'

// Send a chat.completions request applying the right token-limit param (with the
// learn-on-400 fallback), given a ready params object (model + messages + extras).
async function openaiSend(client, params, maxTokens, tokenParam = 'auto') {
  if (tokenParam === 'max_tokens' || tokenParam === 'max_completion_tokens') {
    return client.chat.completions.create({ ...params, [tokenParam]: maxTokens });
  }
  const param = OPENAI_TOKEN_PARAM.get(params.model) || 'max_tokens';
  try {
    return await client.chat.completions.create({ ...params, [param]: maxTokens });
  } catch (err) {
    const wantsNewParam = err?.param === 'max_tokens' || /max_completion_tokens/i.test(err?.message || '');
    if (param !== 'max_tokens' || !wantsNewParam) throw err;
    OPENAI_TOKEN_PARAM.set(params.model, 'max_completion_tokens');
    return client.chat.completions.create({ ...params, max_completion_tokens: maxTokens });
  }
}

async function openaiCreate(client, { model, system, messages, maxTokens, json, tokenParam = 'auto', temperature = null }) {
  const base = {
    model,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
    ...(temperature != null ? { temperature } : {}),
    messages: [{ role: 'system', content: system }, ...messages],
  };
  return openaiSend(client, base, maxTokens, tokenParam);
}

// Self-hosted tool-use loop for OpenAI/Ollama: expose the MCP host's tools, let
// the model call them, route each call back to the server, feed results in, repeat.
const MCP_MAX_ITERS = 6;
async function openaiToolLoop(client, { model, system, messages, maxTokens, temperature, tokenParam, host, label, provider, tag = 'tool', onToolCall, maxIters = MCP_MAX_ITERS }) {
  const msgs = [{ role: 'system', content: system }, ...messages];
  for (let i = 0; i < maxIters; i++) {
    const params = { model, ...(temperature != null ? { temperature } : {}), tools: host.tools, messages: msgs };
    const resp = await openaiSend(client, params, maxTokens, tokenParam);
    logUsage(label, provider, model, resp.usage);
    const m = resp.choices[0].message;
    if (!m.tool_calls?.length) return m.content || '';
    msgs.push(m);
    for (const tc of m.tool_calls) {
      let result;
      try {
        const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        onToolCall?.(tc.function.name, args);
        result = await host.callTool(tc.function.name, args);
        console.log(`[${tag}] ${model} → ${tc.function.name}`);
      } catch (e) {
        result = `Error: ${e.message}`;
      }
      msgs.push({ role: 'tool', tool_call_id: tc.id, content: String(result) });
    }
  }
  // Iteration cap reached — force a final answer without tools.
  const final = await openaiSend(client, { model, ...(temperature != null ? { temperature } : {}), messages: msgs }, maxTokens, tokenParam);
  return final.choices[0].message.content || '';
}

// Anthropic-native tool_use loop (for internal tools, not the hosted MCP connector).
async function anthropicToolLoop(client, { model, system, messages, maxTokens, temperature, tools, callTool, label, onToolCall, maxIters = MCP_MAX_ITERS }) {
  const aTools = tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));
  const msgs = [...messages];
  for (let i = 0; i < maxIters; i++) {
    const resp = await client.messages.create({
      model,
      max_tokens: maxTokens,
      ...(temperature != null ? { temperature } : {}),
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: aTools,
      messages: msgs,
    });
    logUsage(label, 'anthropic', model, resp.usage);
    const toolUses = resp.content.filter((b) => b.type === 'tool_use');
    if (!toolUses.length) return resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    msgs.push({ role: 'assistant', content: resp.content });
    const results = [];
    for (const tu of toolUses) {
      let out;
      try { onToolCall?.(tu.name, tu.input || {}); out = await callTool(tu.name, tu.input || {}); console.log(`[agent] ${model} → ${tu.name}`); }
      catch (e) { out = `Error: ${e.message}`; }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: String(out) });
    }
    msgs.push({ role: 'user', content: results });
  }
  const final = await client.messages.create({
    model, max_tokens: maxTokens,
    ...(temperature != null ? { temperature } : {}),
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: msgs,
  });
  return final.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// Run the impact agent: the model navigates the journey graph via internal tools
// (backed by gatherStationContext) instead of being handed the whole graph.
async function runImpactAgent(userMessage, context, settings, onToolCall) {
  const model = activeModelFor('impact', settings);
  const maxTokens = settings.maxTokens || 4096;
  const { temperature, provider } = settings;
  const { tools, callTool, touched } = buildImpactTools(context);
  const labels = (context.stations || []).map((s) => s.label).join(', ');
  const messages = [{ role: 'user', content: `${userMessage}\n\nKnown journey steps: ${labels}\n\nInvestigate with the tools, then return ONLY the concerns JSON.` }];

  let text;
  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    text = await anthropicToolLoop(client, { model, system: IMPACT_AGENT_SYSTEM_PROMPT, messages, maxTokens, temperature, tools, callTool, label: 'impact', onToolCall, maxIters: 12 });
  } else {
    const client = new OpenAI(
      provider === 'ollama'
        ? { baseURL: settings.ollamaBaseUrl.replace(/\/$/, '') + '/v1', apiKey: 'ollama' }
        : { apiKey: process.env.OPENAI_API_KEY }
    );
    text = await openaiToolLoop(client, { model, system: IMPACT_AGENT_SYSTEM_PROMPT, messages, maxTokens, temperature, tokenParam: settings.tokenParam, host: { tools, callTool }, label: 'impact', provider, tag: 'agent', onToolCall, maxIters: 12 });
  }
  return { text, touched };
}

// Single transport. `system` is the system prompt; `messages` are user/assistant
// turns only. `json` requests structured output (skipped for free-form chat).
async function transport({ system, messages, maxTokens = 4096, json = true, label = 'llm' }) {
  assertConfigured();
  const settings = getSettings();
  const { provider, ollamaBaseUrl, tokenParam, temperature, forceJson } = settings;
  const model = activeModelFor(label, settings); // task-routed under anthropic, else the Settings model
  const effMaxTokens = settings.maxTokens || maxTokens; // Settings cap governs every call

  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const params = {
      model,
      max_tokens: effMaxTokens,
      ...(temperature != null ? { temperature } : {}),
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
    };
    // Connector-first MCP: let enabled remote servers' tools be called on free-form
    // (non-JSON) turns — i.e. the impact chat. Skipped for JSON tasks so tool-use
    // can't interrupt structured output. Zero client code; Anthropic-only.
    let options;
    const servers = !json ? enabledMcpServers() : [];
    if (servers.length) {
      params.mcp_servers = servers;
      options = { headers: { 'anthropic-beta': 'mcp-client-2025-04-04' } };
    }
    const resp = await client.messages.create(params, options);
    logUsage(label, provider, model, resp.usage);
    // With MCP the response can interleave tool_use/tool_result blocks — collect text.
    return resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('') || '';
  }

  // openai | ollama — both speak the OpenAI chat API
  const isOllama = provider === 'ollama';
  const client = new OpenAI(
    isOllama
      ? { baseURL: ollamaBaseUrl.replace(/\/$/, '') + '/v1', apiKey: 'ollama' }
      : { apiKey: process.env.OPENAI_API_KEY }
  );
  // Self-hosted MCP host: on free-form (chat) turns, expose enabled servers' tools
  // and run the tool-use loop ourselves (OpenAI/Ollama have no hosted connector).
  // Per-server failures are isolated; if no tools come up, fall back to a plain call.
  const servers = !json ? enabledMcpServers() : [];
  if (servers.length) {
    const host = await buildMcpHost(servers);
    if (host.tools.length) {
      try {
        return await openaiToolLoop(client, { model, system, messages, maxTokens: effMaxTokens, temperature, tokenParam, host, label, provider, tag: 'mcp' });
      } finally {
        await host.close();
      }
    }
    await host.close();
  }

  const resp = await openaiCreate(client, {
    model, system, messages, maxTokens: effMaxTokens,
    json: json && forceJson, tokenParam, temperature,
  });
  logUsage(label, provider, model, resp.usage);
  return resp.choices[0].message.content;
}

export async function analyzeRecording(recording) {
  // Recording is unique per call (no cache benefit) — just send it compact.
  const text = await transport({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Analyze this recording:\n\n${JSON.stringify(recording)}` }],
    label: 'analyze',
  });
  return parseJsonResponse(text);
}

// For impact + test-plan the context is constant across queries within a session,
// so it goes in the cached system block (compact). Only the change query — which
// varies and is tiny — stays in the user message. This makes re-runs / reworded
// queries hit the prompt cache instead of re-billing the whole context.
// Author-stated change-intent facts (the "Sharpen this analysis" answers) →
// a readable block appended to the change. Treated as ground truth by the prompt.
const FACT_LABELS = {
  uiChange: 'UI change',
  flag: 'Behind a feature flag',
  backwardsCompatible: 'Backwards-compatible',
  responseShape: 'Changes API response shape',
  migration: 'Requires a DB migration',
  rollout: 'Rollout strategy',
};
function factsBlock(facts, extraFacts = []) {
  const lines = [];
  if (facts && typeof facts === 'object') {
    for (const [k, v] of Object.entries(facts)) if (v) lines.push(`- ${FACT_LABELS[k] ?? k}: ${v}`);
  }
  for (const l of extraFacts || []) if (l) lines.push(`- ${l}`); // model-generated clarifying answers, pre-labeled
  return lines.length ? `\n\nCHANGE FACTS (stated by the author — treat as ground truth):\n${lines.join('\n')}` : '';
}

// Impact analysis as a tool-using agent: the model navigates the journey graph
// via internal tools (impactTools) rather than being handed the whole context.
// Smart-routing, prompt-caching (per agent turn), and app-level memoization preserved.
// A critic pass re-checks each generated concern against the actual flagged-station
// context and drops/demotes unsupported ones — attacking the "confident but
// unverifiable" trust problem. Failures are non-fatal (return the generator result).
async function critiqueConcerns(change, result, context, settings) {
  const concerns = result.concerns || [];
  if (!concerns.length) return result;

  const byId = new Map((context.stations || []).map((s) => [s.id, s]));
  const byLabel = new Map((context.stations || []).map((s) => [s.label.toLowerCase(), s]));
  const seen = new Set();
  const flaggedCtx = [];
  for (const c of concerns) {
    const s = byId.get(c.stationId) || byLabel.get((c.stationLabel || '').toLowerCase());
    if (s && !seen.has(s.id)) { seen.add(s.id); flaggedCtx.push(s); }
  }

  const payload = {
    change,
    concerns: concerns.map((c) => ({ stationLabel: c.stationLabel, level: c.level, confidence: c.confidence, reason: c.reason, evidence: c.evidence })),
    context: flaggedCtx,
  };
  const text = await transport({
    system: CRITIC_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
    label: 'impact',
  });
  const critique = parseJsonResponse(text);

  const verdicts = new Map((critique.verdicts || []).map((v) => [(v.stationLabel || '').toLowerCase(), v]));
  const kept = [];
  const removed = [];
  const demoted = [];
  for (const c of concerns) {
    const v = verdicts.get((c.stationLabel || '').toLowerCase());
    if (!v || v.verdict === 'keep') { kept.push(c); continue; }
    if (v.verdict === 'drop') { removed.push(c.stationLabel); continue; }
    if (v.verdict === 'demote') {
      const from = c.level;
      if (v.adjustedLevel) c.level = v.adjustedLevel;
      if (v.adjustedConfidence) c.confidence = v.adjustedConfidence;
      if (c.level !== from) demoted.push({ label: c.stationLabel, from, to: c.level });
      kept.push(c);
      continue;
    }
    kept.push(c);
  }
  result.concerns = kept;
  result.critique = { coverageNote: critique.coverageNote || null, removed, demoted };
  return result;
}

// Friendly one-line description of a tool call, for the live investigation trail.
function toolDetail(tool, args, byId) {
  switch (tool) {
    case 'search_stations': return args?.query || '';
    case 'find_endpoint_consumers': return args?.endpoint || '';
    case 'get_station': return byId.get(args?.id)?.label || args?.id || '';
    case 'get_traces': return byId.get(args?.stationId)?.label || args?.stationId || '';
    case 'get_downstream': return byId.get(args?.id)?.label || args?.id || '';
    default: return '';
  }
}

// Use the tool-using agent only when the graph is too big to comfortably hand the
// model in one shot. At small/medium scale the one-shot (full context in a cached
// block) reasons more holistically and produces richer output — so prefer it.
function shouldUseAgent(context) {
  const stations = (context.stations || []).length;
  const size = JSON.stringify(context).length;
  return stations > 25 || size > 45000;
}

export async function analyzeImpact(query, context, facts = null, extraFacts = [], onEvent, options = {}) {
  assertConfigured();
  const settings = getSettings();
  const fb = factsBlock(facts, extraFacts);
  const memory = evalMemoryHint(query);
  // `forcePath` lets the context experiment pin the engine (always one-shot) so the
  // only thing varying across runs is the context, not the agent/one-shot split.
  const useAgent = options.forcePath ? options.forcePath === 'agent' : shouldUseAgent(context);
  const key = cacheKey([useAgent ? 'impact-agent' : 'impact-oneshot', settings.provider, activeModelFor('impact', settings), settings.maxTokens, settings.temperature, query, fb, memory, context]);
  // `noCache` (experiment averaging) skips the memo entirely — otherwise repeated
  // runs return the same cached answer and the variance we're measuring vanishes.
  const cached = options.noCache ? null : getCached(key);
  if (cached) { console.log('[llm] impact · cache hit (app) · $0'); return cached; }

  const userMessage = `CHANGE:\n${query}${fb}${memory}`;
  const trail = [];

  // One-shot over a (possibly pruned) context — the rich, holistic path.
  const oneShot = (ctx) => transport({
    system: `${IMPACT_SYSTEM_PROMPT}\n\nAPPLICATION CONTEXT:\n${JSON.stringify(ctx)}`,
    messages: [{ role: 'user', content: userMessage }],
    label: 'impact',
  });
  // "Thin" = no concerns, or none of the ship-it lists came back — a degenerate run.
  const isThin = (r) => (r?.concerns?.length ?? 0) === 0 ||
    ((r?.monitorChecklist?.length || 0) + (r?.affectedFlows?.length || 0) + (r?.reviewFocus?.length || 0)) === 0;

  let result;
  if (useAgent) {
    const byId = new Map((context.stations || []).map((s) => [s.id, s]));
    const onToolCall = (tool, args) => {
      const step = { tool, detail: toolDetail(tool, args, byId) };
      trail.push(step);
      onEvent?.({ type: 'tool', ...step });
    };
    const { text, touched } = await runImpactAgent(userMessage, context, settings, onToolCall);
    result = parseJsonResponse(text);

    // Degenerate-output guard: if the agent went thin, re-synthesize as a one-shot
    // over JUST the stations it fetched — fits even when the full graph doesn't, and
    // restores holistic reasoning. Only swap in the retry if it's actually richer.
    if (isThin(result)) {
      const candidates = (context.stations || []).filter((s) => touched.has(s.id));
      if (candidates.length) {
        console.log(`[agent] thin output → re-synthesizing one-shot over ${candidates.length} candidate stations`);
        onEvent?.({ type: 'tool', tool: '__synthesize', detail: `${candidates.length} candidate stations` });
        const pruned = {
          ...context,
          stations: candidates,
          edges: (context.edges || []).filter((e) => touched.has(e.source) && touched.has(e.target)),
        };
        try {
          const retry = parseJsonResponse(await oneShot(pruned));
          if (!isThin(retry)) result = retry;
        } catch (err) {
          console.warn('[agent] synthesis fallback failed:', err.message);
        }
      }
    }
  } else {
    result = parseJsonResponse(await oneShot(context));
  }

  try {
    onEvent?.({ type: 'critic' });
    result = await critiqueConcerns(`${query}${fb}`, result, context, settings);
  } catch (err) {
    console.warn('[critic] skipped:', err.message);
  }
  result.trail = trail;
  if (!options.noCache) putCached(key, result);
  return result;
}

export async function generateTestPlan(change, context) {
  const settings = getSettings();
  const key = cacheKey(['test-plan', settings.provider, activeModelFor('test-plan', settings), settings.maxTokens, settings.temperature, change, context]);
  const cached = getCached(key);
  if (cached) { console.log('[llm] test-plan · cache hit (app) · $0'); return cached; }

  const text = await transport({
    system: `${TEST_PLAN_SYSTEM_PROMPT}\n\nAFFECTED STATIONS:\n${JSON.stringify(context)}`,
    messages: [{ role: 'user', content: `CHANGE:\n${change}` }],
    label: 'test-plan',
  });
  const result = parseJsonResponse(text);
  putCached(key, result);
  return result;
}

// Propose 2-4 quick-select clarifying questions tailored to THIS change.
export async function generateClarifyingQuestions(query, summary) {
  const text = await transport({
    system: CLARIFYING_QUESTIONS_PROMPT,
    messages: [{ role: 'user', content: `CHANGE:\n${query}\n\nAPP SUMMARY:\n${summary}` }],
    maxTokens: 800,
    label: 'questions',
  });
  const parsed = parseJsonResponse(text);
  const qs = Array.isArray(parsed?.questions) ? parsed.questions : [];
  return qs
    .filter((q) => q?.label && Array.isArray(q.options) && q.options.length)
    .slice(0, 4)
    .map((q, i) => ({ key: q.key || `q${i}`, label: String(q.label), options: q.options.map(String).slice(0, 4) }));
}

export async function chatImpact(messages, context) {
  return transport({
    system: `${IMPACT_CHAT_SYSTEM_PROMPT}\n\nAPPLICATION CONTEXT:\n${JSON.stringify(context)}`,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    maxTokens: 2048,
    json: false,
    label: 'chat',
  });
}
