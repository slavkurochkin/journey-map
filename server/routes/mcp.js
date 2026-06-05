import { Router } from 'express';
import { listMcpServers, createMcpServer, updateMcpServer, deleteMcpServer } from '../services/mcp.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(listMcpServers());
});

router.post('/', (req, res) => {
  const { name, url, authToken, enabled, allowedTools } = req.body || {};
  if (!name?.trim() || !url?.trim()) return res.status(400).json({ error: 'name and url are required' });
  try {
    new URL(url); // validate it's a real URL
  } catch {
    return res.status(400).json({ error: 'url must be a valid URL' });
  }
  const id = createMcpServer({ name, url, authToken, enabled, allowedTools });
  res.json({ id });
});

router.patch('/:id', (req, res) => {
  const { name, url, authToken, enabled, allowedTools } = req.body || {};
  if (url !== undefined) {
    try { new URL(url); } catch { return res.status(400).json({ error: 'url must be a valid URL' }); }
  }
  const ok = updateMcpServer(req.params.id, { name, url, authToken, enabled, allowedTools });
  if (!ok) return res.status(404).json({ error: 'Server not found' });
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  deleteMcpServer(req.params.id);
  res.json({ ok: true });
});

export default router;
