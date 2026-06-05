// Extract screenshot steps from a recording and assign each to exactly one station.
// Rule: a screenshot belongs to the last station that started before it was taken.
export function extractScreenshots(recording, stations) {
  const steps = recording?.steps ?? [];
  const shots = steps.filter((s) => s.type === 'screenshot' && s.dataUrl);
  if (!shots.length || !stations?.length) return [];

  // Only consider stations that have a startTimestamp, sorted chronologically
  const sortedStations = [...stations]
    .filter((s) => s.startTimestamp)
    .sort((a, b) => a.startTimestamp - b.startTimestamp);

  if (!sortedStations.length) return [];

  const matched = [];

  for (const shot of shots) {
    // Find the last station that started at or before this screenshot
    let best = null;
    for (const station of sortedStations) {
      if (station.startTimestamp <= shot.timestamp) best = station;
    }
    if (best) {
      matched.push({ stationId: best.id, dataUrl: shot.dataUrl, source: 'recording' });
    }
  }

  return matched;
}

export function dataUrlToBuffer(dataUrl) {
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  return Buffer.from(base64, 'base64');
}
