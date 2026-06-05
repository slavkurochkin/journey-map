import { Router } from 'express';
import db from '../db.js';
import { runAnalysis } from '../services/analyze.js';
import { saveSession, deleteSession } from '../services/sessionStore.js';
import { parseMeta } from '../services/meta.js';

const router = Router();

// Scrape a URL's meta tags (auto-fill incident links). Best-effort.
router.post('/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JourneyMapBot/1.0)' },
      signal: controller.signal,
    });
    clearTimeout(t);
    res.json(parseMeta(await r.text(), url));
  } catch {
    res.status(502).json({ error: 'Could not fetch that URL — fill in manually' });
  }
});

// Paginated + searchable session list: ?search=&limit=&offset= → { sessions, total }
router.get('/', (req, res) => {
  const search = (req.query.search || '').trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;

  const where = search ? 'WHERE title LIKE ?' : '';
  const args = search ? [`%${search}%`] : [];

  const total = db.prepare(`SELECT COUNT(*) AS c FROM sessions ${where}`).get(...args).c;
  const sessions = db.prepare(
    `SELECT id, title, timestamp FROM sessions ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
  ).all(...args, limit, offset);

  res.json({ sessions, total });
});

router.post('/', (req, res) => {
  const { recording, result } = req.body;
  if (!recording || !result) return res.status(400).json({ error: 'recording and result are required' });
  res.json({ id: saveSession(recording, result) });
});

// One-shot ingest from the recorder extension: analyze + save in one call.
router.post('/ingest', async (req, res) => {
  const recording = req.body?.recording ?? req.body;
  if (!recording || (!Array.isArray(recording.steps) && !Array.isArray(recording.networkRequests))) {
    return res.status(400).json({ error: 'Invalid recording: expected { steps, networkRequests }' });
  }
  try {
    const result = await runAnalysis(recording);
    const id = saveSession(recording, result);
    res.json({ id, title: result.title, stations: result.stations?.length ?? 0 });
  } catch (err) {
    console.error('Ingest error:', err);
    res.status(500).json({ error: err.message || 'Ingest failed' });
  }
});

// Param routes — must be registered LAST (after all literal-path routers)
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Session not found' });
  res.json({ ...row, recording: JSON.parse(row.recording), result: JSON.parse(row.result) });
});

// Rename a session (updates both the list title and the stored result title)
router.patch('/:id', (req, res) => {
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });
  const row = db.prepare('SELECT result FROM sessions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Session not found' });
  const result = JSON.parse(row.result);
  result.title = title.trim();
  db.prepare('UPDATE sessions SET title = ?, result = ? WHERE id = ?')
    .run(title.trim(), JSON.stringify(result), req.params.id);
  res.json({ ok: true, title: title.trim() });
});

router.delete('/:id', (req, res) => {
  deleteSession(req.params.id);
  res.json({ ok: true });
});

export default router;
