// Parse an lcov.info report into per-file line coverage: [{ file, hit, found }]
export function parseLcov(text) {
  const out = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SF:')) cur = { file: line.slice(3), hit: 0, found: 0 };
    else if (line.startsWith('LH:') && cur) cur.hit = parseInt(line.slice(3), 10) || 0;
    else if (line.startsWith('LF:') && cur) cur.found = parseInt(line.slice(3), 10) || 0;
    else if (line.startsWith('end_of_record') && cur) { out.push(cur); cur = null; }
  }
  return out;
}
