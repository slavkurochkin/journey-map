// Auto-sync feature flags from a recording's flat `featureFlags[]` array.
//
// The recorder emits flags parallel to networkRequests: a flat array where each
// entry carries a timestamp, e.g.
//   { type:'flag', provider:'LaunchDarkly', key, value, previous, changed, kind, timestamp }
//
// There are two honest shapes hiding in that array, and we map them differently:
//   - A bootstrap / bulk read at page load — many flags evaluated in one shot, all
//     sharing a single timestamp. These describe state the WHOLE journey ran under,
//     not one step → scope 'session'.
//   - A per-interaction eval or a mid-session change — a flag actually read (or
//     flipped) at a specific moment → scope 'station', matched to the step whose
//     window contains it (same "last station started at/before ts" rule used by
//     networkRequests and screenshots).
//
// The recorder MAY tag entries with kind: 'bootstrap' | 'eval' | 'change'. We honor
// that when present, and fall back to timestamp-cluster detection when it isn't (so
// today's "all flags share one timestamp" exports are correctly read as session-level
// without waiting on a recorder change).

// Sentinel station id for session-scoped flags (no single owning step).
export const SESSION_SCOPE_STATION = '__session__';

// A served value counts as "on" unless it's an explicit off-ish value. Variant
// strings (e.g. "streamlined") mean the flag is serving that variant → enabled.
function isEnabled(value) {
  return !(value === false || value === 0 || value === null || value === undefined || value === '');
}

export function extractFeatureFlags(recording, stations = []) {
  const flags = (recording?.featureFlags ?? []).filter((f) => f && f.key);
  if (!flags.length) return [];

  const sorted = stations
    .filter((s) => s.startTimestamp)
    .sort((a, b) => a.startTimestamp - b.startTimestamp);

  // How many distinct flag keys were read at each timestamp. A timestamp shared by
  // 2+ keys is a bulk read (bootstrap), not a per-interaction eval.
  const keysAtTs = new Map();
  for (const f of flags) {
    if (f.timestamp == null) continue;
    if (!keysAtTs.has(f.timestamp)) keysAtTs.set(f.timestamp, new Set());
    keysAtTs.get(f.timestamp).add(f.key);
  }

  // The last station that started at or before ts; null if ts precedes them all.
  const stationFor = (ts) => {
    if (ts == null) return null;
    let best = null;
    for (const s of sorted) if (s.startTimestamp <= ts) best = s;
    return best;
  };

  // Dedup per scope+station+key, preferring a `changed` eval, then the latest.
  const byKey = new Map();
  for (const f of flags) {
    const bulk = f.timestamp != null && (keysAtTs.get(f.timestamp)?.size ?? 0) >= 2;
    let scope, stationId;
    if (f.kind === 'bootstrap' || bulk) {
      scope = 'session';
      stationId = SESSION_SCOPE_STATION;
    } else {
      const st = stationFor(f.timestamp); // 'eval' | 'change' → match by time
      if (st) { scope = 'station'; stationId = st.id; }
      else { scope = 'session'; stationId = SESSION_SCOPE_STATION; } // evaluated before any station began
    }

    const dedupKey = `${scope}|${stationId}|${f.key.toLowerCase()}`;
    const prev = byKey.get(dedupKey);
    const better = !prev
      || (f.changed && !prev._changed)
      || (!!f.changed === prev._changed && (f.timestamp ?? 0) >= prev._ts);
    if (!better) continue;
    byKey.set(dedupKey, {
      stationId,
      scope,
      name: f.key,
      enabled: isEnabled(f.value),
      value: f.value !== undefined ? JSON.stringify(f.value) : null,
      provider: f.provider || null,
      _changed: !!f.changed,
      _ts: f.timestamp ?? 0,
    });
  }

  return [...byKey.values()].map(({ _changed, _ts, ...row }) => row);
}
