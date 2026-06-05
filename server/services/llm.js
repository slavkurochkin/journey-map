import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { SYSTEM_PROMPT, IMPACT_SYSTEM_PROMPT, IMPACT_CHAT_SYSTEM_PROMPT, TEST_PLAN_SYSTEM_PROMPT, CLARIFYING_QUESTIONS_PROMPT } from './prompt.js';
import { getSettings } from './settings.js';
import { enabledMcpServers } from './mcp.js';
import { buildMcpHost } from './mcpHost.js';
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

// Tolerant JSON parse: local models often wrap output in prose or code fences,
// so fall back to extracting the first {...} / [...] block.
function parseJsonResponse(text) {
  const stripped = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const m = stripped.match(/[[{][\s\S]*[\]}]/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Model did not return valid JSON');
  }
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
  let cost = '';
  const p = PRICING[model];
  if (p) {
    // Anthropic: write 1.25x, read 0.1x. OpenAI: cached read 0.5x, no write premium.
    const inCost = provider === 'anthropic'
      ? fresh * p.in + write * p.in * 1.25 + read * p.in * 0.1
      : fresh * p.in + read * p.in * 0.5;
    cost = ` · ~$${((inCost + out * p.out) / 1e6).toFixed(5)}`;
  }
  console.log(
    `[llm] ${label} · ${model} · in ${fresh} · write ${write} · read ${read} (${hit}% cached) · out ${out}${cost}`
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
async function openaiToolLoop(client, { model, system, messages, maxTokens, temperature, tokenParam, host, label, provider }) {
  const msgs = [{ role: 'system', content: system }, ...messages];
  for (let i = 0; i < MCP_MAX_ITERS; i++) {
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
        result = await host.callTool(tc.function.name, args);
        console.log(`[mcp] ${model} → ${tc.function.name}`);
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
        return await openaiToolLoop(client, { model, system, messages, maxTokens: effMaxTokens, temperature, tokenParam, host, label, provider });
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

export async function analyzeImpact(query, context, facts = null, extraFacts = []) {
  const settings = getSettings();
  const fb = factsBlock(facts, extraFacts);
  const key = cacheKey(['impact', settings.provider, activeModelFor('impact', settings), settings.maxTokens, settings.temperature, query, fb, context]);
  const cached = getCached(key);
  if (cached) { console.log('[llm] impact · cache hit (app) · $0'); return cached; }

  const text = await transport({
    system: `${IMPACT_SYSTEM_PROMPT}\n\nAPPLICATION CONTEXT:\n${JSON.stringify(context)}`,
    messages: [{ role: 'user', content: `CHANGE:\n${query}${fb}` }],
    label: 'impact',
  });
  const result = parseJsonResponse(text);
  putCached(key, result);
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
