// Pure aggregation helpers — no db, no side effects (unit-testable).

export function canonicalKey(station) {
  if (station.apis?.length > 0) {
    const apis = station.apis
      .map((a) => a.replace(/\/\d+/g, '/:id'))
      .sort()
      .join(',');
    return `${station.domain}:${apis}`;
  }
  const label = station.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `${station.domain}:${label}`;
}

export function safeId(key) {
  return key.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

// Across sessions the model phrases the same step differently ("Click Login
// button" vs "Click the 'Log In' button to submit credentials for admin@x.com"),
// so an exact-string union still shows near-duplicates on a merged station.
// Collapse them by a normalized significant-token signature: an action is
// redundant when its core tokens are a subset of another action's — we keep the
// most descriptive (superset) phrasing and drop the rest.
const ACTION_STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'into', 'for', 'of', 'in', 'on', 'at', 'with',
  'and', 'or', 'as', 'from', 'by', 'then', 'this', 'that', 'your',
]);

function actionSignature(action) {
  return new Set(
    String(action)
      .toLowerCase()
      .replace(/\b[\w.+-]+@[\w.-]+\b/g, ' ')   // drop email addresses (keep quoted UI labels)
      .replace(/\b(?:log|sign)\s*in\b/g, 'login')   // unify "log in" / "sign in"
      .replace(/\b(?:log|sign)\s*out\b/g, 'logout')
      .replace(/[^a-z0-9\s]/g, ' ')            // strip punctuation / path symbols
      .split(/\s+/)
      .filter((t) => t.length > 1 && !ACTION_STOPWORDS.has(t) && !/^\d+$/.test(t))
  );
}

const isSubsetOf = (a, b) => {
  for (const t of a) if (!b.has(t)) return false;
  return true;
};

// Stable key for an action, derived from its significant-token signature so the
// same step keeps the same key regardless of which phrasing dedup happens to pick
// (and survives re-aggregation). Empty-signature actions fall back to exact text.
export function actionSigKey(action) {
  const sig = actionSignature(action);
  return sig.size ? [...sig].sort().join(' ') : `=${String(action).toLowerCase().trim()}`;
}

// Apply a station's action override (hide / rename, keyed by sigKey) to a deduped
// action list. Returns the visible actions plus their keys (for the edit UI).
export function applyActionOverrides(deduped, override) {
  const hidden = new Set(override?.hidden || []);
  const renames = override?.renames || {};
  const actions = [];
  const actionKeys = [];
  for (const a of deduped || []) {
    const key = actionSigKey(a);
    if (hidden.has(key)) continue;
    actions.push(renames[key] ?? a);
    actionKeys.push(key);
  }
  return { actions, actionKeys };
}

export function dedupeActions(actions) {
  const items = (actions || []).map((a) => ({ a, sig: actionSignature(a) }));
  // Largest signature first so a superset is always kept before its subsets.
  const ordered = [...items].sort((x, y) => y.sig.size - x.sig.size || y.a.length - x.a.length);
  const kept = [];
  for (const item of ordered) {
    if (item.sig.size === 0) { kept.push(item); continue; } // nothing to compare on
    const redundant = kept.some((k) => k.sig.size > 0 && isSubsetOf(item.sig, k.sig));
    if (!redundant) kept.push(item);
  }
  const keep = new Set(kept.map((k) => k.a));
  return (actions || []).filter((a) => keep.has(a)); // preserve original order
}

// Follow merge pointers to the final key (cycle-guarded).
function resolveKey(key, overrides) {
  let k = key;
  const seen = new Set();
  while (overrides[k]?.mergedInto && !seen.has(k)) {
    seen.add(k);
    k = overrides[k].mergedInto;
  }
  return k;
}

// Merge multiple session results into distinct stations with visit counts + edges.
// `overrides` (canonicalKey → { mergedInto, customLabel }) applies user corrections.
export function aggregateResults(sessions, overrides = {}) {
  const stationMap = new Map();
  const idToKey = new Map();
  const edgeMap = new Map();
  const mappingsMap = new Map();
  const rawLabels = new Map(); // unresolved canonicalKey → original label
  const actionsMap = new Map(); // key → unioned actions
  const apisMap = new Map();    // key → unioned apis

  const addAll = (map, key, items) => {
    if (!map.has(key)) map.set(key, []);
    const arr = map.get(key);
    for (const it of items || []) if (!arr.includes(it)) arr.push(it);
  };

  sessions.forEach(({ sessionId, result }, idx) => {
    for (const station of result.stations) {
      const rawKey = canonicalKey(station);
      if (!rawLabels.has(rawKey)) rawLabels.set(rawKey, station.label);
      const key = resolveKey(rawKey, overrides);
      const sid = safeId(key);
      idToKey.set(`${idx}:${station.id}`, key);

      // Union actions + APIs from every station that maps to this key (so a
      // merged station shows the combined steps/endpoints, not just the anchor's).
      addAll(actionsMap, key, station.actions);
      addAll(apisMap, key, station.apis);

      // The "anchor" is the station whose own key IS the resolved key — i.e. the
      // merge target. Its identity (label/domain/apis) must win, regardless of
      // recording order. Merged-in sources only contribute counts/mappings.
      const isAnchor = rawKey === key;
      if (!stationMap.has(key)) {
        stationMap.set(key, { ...station, id: sid, canonicalKey: key, visitCount: 0, totalDuration: 0, _isAnchor: isAnchor });
        mappingsMap.set(sid, []);
      } else if (isAnchor && !stationMap.get(key)._isAnchor) {
        // A real target showed up after a merged-in source claimed the slot —
        // adopt the target's identity, keep the accumulated counts.
        const ex = stationMap.get(key);
        stationMap.set(key, { ...station, id: sid, canonicalKey: key, visitCount: ex.visitCount, totalDuration: ex.totalDuration, _isAnchor: true });
      }
      const s = stationMap.get(key);
      s.visitCount++;
      s.totalDuration += station.durationMs || 0;
      mappingsMap.get(sid).push({ sessionId, stationId: station.id });
    }

    for (const edge of result.edges) {
      const sourceKey = idToKey.get(`${idx}:${edge.source}`);
      const targetKey = idToKey.get(`${idx}:${edge.target}`);
      if (!sourceKey || !targetKey || sourceKey === targetKey) continue;
      const edgeKey = `${sourceKey}→${targetKey}`;
      edgeMap.set(edgeKey, (edgeMap.get(edgeKey) || 0) + 1);
    }
  });

  // For each visible station, the canonical keys merged into it (for unmerge UI)
  const mergedFromFor = (targetKey) =>
    Object.keys(overrides)
      .filter((k) => overrides[k]?.mergedInto && k !== targetKey && resolveKey(k, overrides) === targetKey)
      .map((k) => ({ canonicalKey: k, label: overrides[k].customLabel || rawLabels.get(k) || k }));

  const stations = Array.from(stationMap.values()).map(({ _isAnchor, ...s }) => {
    const { actions, actionKeys } = applyActionOverrides(
      dedupeActions(actionsMap.get(s.canonicalKey) ?? s.actions),
      overrides[s.canonicalKey]?.actions
    );
    return {
    ...s,
    label: overrides[s.canonicalKey]?.customLabel || s.label,
    color: overrides[s.canonicalKey]?.color || null,
    actions,
    actionKeys,
    apis: apisMap.get(s.canonicalKey) ?? s.apis,
    durationMs: s.visitCount > 0 ? Math.round(s.totalDuration / s.visitCount) : 0,
    sessionMappings: mappingsMap.get(s.id) ?? [],
    mergedFrom: mergedFromFor(s.canonicalKey),
    };
  });

  const counts = Array.from(edgeMap.values());
  const maxCount = counts.length ? Math.max(...counts) : 1;
  const edges = Array.from(edgeMap.entries()).map(([key, count]) => {
    const [sourceKey, targetKey] = key.split('→');
    return { source: safeId(sourceKey), target: safeId(targetKey), count, weight: count / maxCount };
  });

  return { stations, edges, sessionCount: sessions.length };
}
