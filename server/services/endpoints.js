// Normalize "METHOD + path" into a stable endpoint key (numeric ids → :id)
export function endpointKey(method, urlOrPath) {
  let path = urlOrPath || '';
  try { path = new URL(path).pathname; } catch { /* already a relative path */ }
  path = path.replace(/\/\d+(?=\/|$)/g, '/:id');
  return `${(method || 'GET').toUpperCase()} ${path}`;
}

// Normalize a station's API string like "GET /api/auth/profile/1"
export function endpointKeyFromString(s) {
  const sp = s.indexOf(' ');
  if (sp === -1) return endpointKey('GET', s);
  return endpointKey(s.slice(0, sp), s.slice(sp + 1));
}
