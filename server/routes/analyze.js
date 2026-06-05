import { Router } from 'express';
import { runAnalysis } from '../services/analyze.js';

const router = Router();

router.post('/analyze', async (req, res) => {
  const recording = req.body;

  if (!recording || (!Array.isArray(recording.steps) && !Array.isArray(recording.networkRequests))) {
    return res.status(400).json({ error: 'Invalid recording: expected { steps, networkRequests }' });
  }

  try {
    const result = await runAnalysis(recording);
    res.json(result);
  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
});

export default router;
