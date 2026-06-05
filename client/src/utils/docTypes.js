// `icon` is an Icon component name (see components/Icon.jsx)
export const DOC_TYPES = [
  { value: 'prd',        label: 'PRD',         icon: 'prd' },
  { value: 'eng-design', label: 'Eng Design',  icon: 'eng-design' },
  { value: 'design',     label: 'Design',      icon: 'design' },
  { value: 'runbook',    label: 'Runbook',     icon: 'runbook' },
  { value: 'other',      label: 'Other',       icon: 'other' },
];

export const docMeta = (t) => DOC_TYPES.find((x) => x.value === t) ?? DOC_TYPES[4];

// "3d ago", "2mo ago", "just now"
export function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const s = Math.floor((Date.now() - then) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

// Highlight docs that are likely stale (older than ~6 months)
export function isStale(iso) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() > 1000 * 60 * 60 * 24 * 180;
}
