import db from '../db.js';

const tokenize = (s) => (s || '').toLowerCase().match(/[a-z][a-z0-9/_-]{3,}/g) || [];

// Memory across runs: if a past eval case with a *similar* change under-recalled
// (missed expected stations), remind the agent of those expected stations so it
// doesn't repeat the miss. Lightweight keyword overlap — no embeddings needed.
export function evalMemoryHint(change) {
  let rows;
  try {
    rows = db.prepare('SELECT name, change_text, expected, last_recall FROM eval_cases WHERE last_recall IS NOT NULL AND last_recall < 100').all();
  } catch {
    return '';
  }
  if (!rows.length) return '';

  const words = new Set(tokenize(change));
  let best = null, bestScore = 0;
  for (const r of rows) {
    const score = tokenize(r.change_text).filter((w) => words.has(w)).length;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  if (!best || bestScore < 2) return '';

  let expected;
  try { expected = JSON.parse(best.expected); } catch { return ''; }
  if (!Array.isArray(expected) || !expected.length) return '';

  return `\n\nMEMORY (from a past eval — recall was ${best.last_recall}%): a similar change ("${best.name}") was expected to affect: ${expected.join(', ')}. Check whether these apply to THIS change — they have been missed before.`;
}
