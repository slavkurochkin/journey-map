// Recursive schema/shape diff between two parsed JSON values.
// Returns a flat list of changes, focused on structure over exact values.

function typeOf(val) {
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  return typeof val;
}

function diff(a, b, path, out) {
  const ta = typeOf(a);
  const tb = typeOf(b);

  if (ta !== tb) {
    out.push({ path, kind: 'type_changed', from: ta, to: tb });
    return;
  }

  if (ta === 'array') {
    // Array length is data, not shape — skip length comparison.
    // Compare schemas of first elements to catch structural changes inside arrays.
    if (a.length > 0 && b.length > 0 && typeOf(a[0]) === 'object') {
      diff(a[0], b[0], `${path}[0]`, out);
    }
    return;
  }

  if (ta === 'object') {
    const keysA = Object.keys(a);
    const keysB = new Set(Object.keys(b));
    for (const k of keysA) {
      const p = path ? `${path}.${k}` : k;
      if (!keysB.has(k)) {
        out.push({ path: p, kind: 'removed', valueType: typeOf(a[k]) });
      } else {
        diff(a[k], b[k], p, out);
        keysB.delete(k);
      }
    }
    for (const k of keysB) {
      const p = path ? `${path}.${k}` : k;
      out.push({ path: p, kind: 'added', valueType: typeOf(b[k]) });
    }
    return;
  }

  // Primitive value changes are data, not shape — ignore.
}

export function diffJson(a, b) {
  const out = [];
  diff(a, b, '', out);
  return out;
}

export function parseBody(str) {
  if (!str || str === 'null') return null;
  try { return JSON.parse(str); } catch { return str; }
}
