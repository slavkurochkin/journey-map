import db from '../db.js';

export const PROVIDERS = ['anthropic', 'openai', 'ollama'];

export const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  ollama: 'llama3.1:8b',
};

// Env vars seed the initial defaults; the DB (Settings panel) overrides them.
const ENV_DEFAULTS = {
  provider: PROVIDERS.includes(process.env.LLM_PROVIDER) ? process.env.LLM_PROVIDER : 'anthropic',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
};

function readMap() {
  const rows = db.prepare('SELECT key, value FROM app_settings').all();
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

// Resolved settings for the *active* provider. `models` carries the per-provider
// model choices so the UI can show them all without losing the others on switch.
export function getSettings() {
  const map = readMap();
  const provider = map.llm_provider || ENV_DEFAULTS.provider;
  const models = {};
  for (const p of PROVIDERS) models[p] = map[`llm_model_${p}`] || DEFAULT_MODELS[p];
  return {
    provider,
    model: models[provider],
    models,
    ollamaBaseUrl: map.ollama_base_url || ENV_DEFAULTS.ollamaBaseUrl,
    // Smart routing: downgrade easy tasks to a cheaper model (anthropic only). On by default.
    smartRouting: map.smart_routing == null ? true : map.smart_routing === 'true',
    // ---- Advanced model parameters (with safe defaults) ----
    // OpenAI token-limit param: 'auto' learns max_tokens vs max_completion_tokens per model.
    tokenParam: ['auto', 'max_tokens', 'max_completion_tokens'].includes(map.token_param) ? map.token_param : 'auto',
    // Cap on output tokens for every call.
    maxTokens: Number.isInteger(+map.max_tokens) && +map.max_tokens > 0 ? +map.max_tokens : 4096,
    // Sampling temperature; null = omit the param entirely (provider default — safest for o1/o3).
    temperature: map.temperature == null || map.temperature === '' ? null : Number(map.temperature),
    // Send response_format:json_object on JSON tasks (OpenAI). Off for models that reject it.
    forceJson: map.force_json == null ? true : map.force_json === 'true',
  };
}

export function setSettings(partial = {}) {
  const up = db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  if (partial.provider && PROVIDERS.includes(partial.provider)) up.run('llm_provider', partial.provider);
  if (partial.ollamaBaseUrl != null) up.run('ollama_base_url', String(partial.ollamaBaseUrl).trim());
  if (partial.smartRouting != null) up.run('smart_routing', partial.smartRouting ? 'true' : 'false');
  if (partial.tokenParam != null && ['auto', 'max_tokens', 'max_completion_tokens'].includes(partial.tokenParam)) up.run('token_param', partial.tokenParam);
  if (partial.maxTokens != null) up.run('max_tokens', String(parseInt(partial.maxTokens, 10) || 4096));
  if (partial.temperature !== undefined) {
    const t = partial.temperature === null || partial.temperature === '' ? '' : String(Number(partial.temperature));
    up.run('temperature', t === 'NaN' ? '' : t);
  }
  if (partial.forceJson != null) up.run('force_json', partial.forceJson ? 'true' : 'false');
  if (partial.model != null) {
    // The model belongs to whichever provider this save targets.
    const target = partial.provider && PROVIDERS.includes(partial.provider)
      ? partial.provider
      : getSettings().provider;
    up.run(`llm_model_${target}`, String(partial.model).trim());
  }
  return getSettings();
}
