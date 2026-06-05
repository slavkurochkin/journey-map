import { Router } from 'express';
import { getSettings, setSettings, DEFAULT_MODELS, PROVIDERS } from '../services/settings.js';
import { providerStatus } from '../services/llm.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({ ...getSettings(), defaults: DEFAULT_MODELS, status: providerStatus() });
});

router.put('/', (req, res) => {
  const { provider, model, ollamaBaseUrl, smartRouting, tokenParam, maxTokens, temperature, forceJson } = req.body || {};
  if (provider && !PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `provider must be one of ${PROVIDERS.join(', ')}` });
  }
  res.json({ ...setSettings({ provider, model, ollamaBaseUrl, smartRouting, tokenParam, maxTokens, temperature, forceJson }), defaults: DEFAULT_MODELS, status: providerStatus() });
});

// List models installed in the local Ollama instance.
router.get('/ollama-models', async (req, res) => {
  const base = (req.query.baseUrl || getSettings().ollamaBaseUrl).replace(/\/$/, '');
  try {
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error(`Ollama responded ${r.status}`);
    const data = await r.json();
    res.json({ models: (data.models || []).map((m) => m.name) });
  } catch (err) {
    res.status(502).json({ error: `Could not reach Ollama at ${base} (${err.message})`, models: [] });
  }
});

export default router;
