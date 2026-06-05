// Extract API requests from a recording's networkRequests[] and assign each to a
// station, so the request/response detail is auto-populated without manual upload.
//
// Rules:
// - skip CORS preflight (OPTIONS)
// - per station, keep one record per endpoint (method + path), preferring the
//   response with the richest body (a 200 over an empty 304)
// - a request belongs to the last station that started at or before its timestamp
export function extractApiRequests(recording, stations) {
  const reqs = (recording?.networkRequests ?? []).filter(
    (r) => r.method && r.method.toUpperCase() !== 'OPTIONS' && r.url
  );
  if (!reqs.length || !stations?.length) return [];

  const sorted = [...stations]
    .filter((s) => s.startTimestamp)
    .sort((a, b) => a.startTimestamp - b.startTimestamp);
  if (!sorted.length) return [];

  function pathOf(url) {
    try { return new URL(url).pathname; } catch { return url; }
  }
  function stationFor(ts) {
    let best = null;
    for (const s of sorted) {
      if (s.startTimestamp <= ts) best = s;
    }
    return best ?? sorted[0];
  }

  // key: `${stationId}|${METHOD} ${path}` → richest request
  const byKey = new Map();
  for (const r of reqs) {
    const station = stationFor(r.timestamp ?? sorted[0].startTimestamp);
    const key = `${station.id}|${r.method.toUpperCase()} ${pathOf(r.url)}`;
    const bodyLen = (r.responseBody || '').length;
    const existing = byKey.get(key);
    if (!existing || bodyLen > existing._bodyLen) {
      byKey.set(key, { stationId: station.id, data: normalize(r), _bodyLen: bodyLen });
    }
  }

  return [...byKey.values()].map(({ stationId, data }) => ({ stationId, data }));
}

// Normalize a recording network request into the same shape as a manual upload
function normalize(r) {
  return {
    method: r.method,
    url: r.url,
    status: r.status,
    statusText: r.statusText,
    duration: r.duration,
    timestamp: r.timestamp,
    requestHeaders: r.requestHeaders ?? [],
    requestBody: r.requestBody ?? null,
    responseHeaders: r.responseHeaders ?? [],
    responseBody: r.responseBody ?? '',
  };
}
