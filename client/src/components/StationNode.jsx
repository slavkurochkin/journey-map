import { Handle, Position } from '@xyflow/react';
import { useTheme } from '../theme.jsx';

const DOMAIN = {
  authentication: { bg: '#DBEAFE', border: '#3B82F6', text: '#1D4ED8', dtext: '#93C5FD' },
  content:        { bg: '#DCFCE7', border: '#22C55E', text: '#15803D', dtext: '#86EFAC' },
  user:           { bg: '#F3E8FF', border: '#A855F7', text: '#7E22CE', dtext: '#D8B4FE' },
  navigation:     { bg: '#FEF3C7', border: '#F59E0B', text: '#B45309', dtext: '#FCD34D' },
  other:          { bg: '#F1F5F9', border: '#94A3B8', text: '#475569', dtext: '#A9B6C8' },
};

// Hex → a soft palette derived from a single base color (for custom-colored nodes)
function customPalette(hex, dark) {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  const mix = (t) => `rgb(${Math.round(r + (255 - r) * t)}, ${Math.round(g + (255 - g) * t)}, ${Math.round(b + (255 - b) * t)})`;
  const deep = `rgb(${Math.round(r * 0.55)}, ${Math.round(g * 0.55)}, ${Math.round(b * 0.55)})`;
  // Light mode: pastel badge + deep text. Dark mode: keep a bright legible subtitle.
  return { bg: mix(0.82), border: hex, text: deep, dtext: mix(0.55) };
}

const COVERAGE_LENSES = new Set(['e2e', 'contract', 'integration', 'unit-frontend', 'service-unit']);

function resolveLensStatus(lens, data) {
  if (COVERAGE_LENSES.has(lens)) {
    const raw = lens === 'service-unit' ? data.serviceUnit : data.coverage?.[lens];
    return raw || 'unset';
  }
  switch (lens) {
    case 'incidents':
      return data.incidentCount > 0 ? 'none' : 'unset';
    case 'missing-docs':
      return data.docCount === 0 ? 'none' : 'unset';
    case 'stale-docs':
      return data.docCount && data.hasStaleDocs ? 'partial' : 'unset';
    case 'feature-flags':
      return data.flagCount > 0 ? 'partial' : 'unset';
    case 'no-observability':
      return data.obsCount === 0 ? 'none' : 'unset';
    default:
      return 'unset';
  }
}

// Lens status → accent color + whether to dim the node
const LENS = {
  covered: { accent: '#10B981', dim: false, label: 'covered' },
  partial: { accent: '#F59E0B', dim: false, label: 'partial' },
  none:    { accent: '#EF4444', dim: false, label: 'not covered' }, // explicitly marked uncovered
  unset:   { accent: '#CBD5E1', dim: true,  label: 'not set' },      // no coverage recorded yet
};

export default function StationNode({ data, selected }) {
  const { dark } = useTheme();
  const surface = dark ? '#222b3c' : '#ffffff';
  const titleColor = dark ? '#f3f4f6' : '#111827';
  const baseC = data.color ? customPalette(data.color, dark) : (DOMAIN[data.domain] ?? DOMAIN.other);
  const subtitleColor = dark ? (baseC.dtext ?? baseC.text) : baseC.text;

  // A "service:<name>" lens highlights stations that call that backend service
  // (from trace + manual data) and dims the rest — a journey-scoped service map.
  const serviceLens = typeof data.lens === 'string' && data.lens.startsWith('service:') ? data.lens.slice('service:'.length) : null;
  let lens;
  if (serviceLens) {
    const match = (data.services || []).some((s) => s.toLowerCase() === serviceLens.toLowerCase());
    lens = match
      ? { accent: '#14B8A6', dim: false, label: serviceLens }
      : { accent: '#CBD5E1', dim: true, label: '—' };
  } else {
    const lensStatus = data.lens ? resolveLensStatus(data.lens, data) : null;
    lens = lensStatus ? LENS[lensStatus] : null;
  }
  const accent = lens ? lens.accent : baseC.border;
  const dim = lens?.dim && !selected;

  return (
    <div
      className={data.pulse ? 'station-pulse' : undefined}
      style={{
        background: surface,
        border: `1.5px solid ${selected ? '#6366F1' : accent + (dark ? 'cc' : '66')}`,
        boxShadow: selected
          ? '0 0 0 3px rgba(79,70,229,0.18), 0 8px 24px rgba(16,24,40,0.12)'
          : lens && !dim
          ? `0 0 0 1.5px ${accent}55, 0 4px 12px rgba(16,24,40,0.06)`
          : '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.06)',
        borderRadius: 14,
        width: 168,
        cursor: 'pointer',
        transition: 'box-shadow 0.18s ease, border-color 0.18s ease, opacity 0.18s ease',
        userSelect: 'none',
        position: 'relative',
        overflow: 'hidden',
        opacity: dim ? 0.4 : 1,
      }}
    >
      {/* Accent strip — domain/custom color, or coverage status under a lens */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: accent }} />

      {data.visitCount > 0 && (
        <div style={{
          position: 'absolute',
          top: 6,
          right: 6,
          background: baseC.bg,
          color: baseC.text,
          borderRadius: 9999,
          fontSize: 10,
          fontWeight: 700,
          padding: '1px 7px',
          lineHeight: 1.7,
        }}>
          {data.visitCount}
        </div>
      )}

      <Handle
        type="target"
        position={Position.Left}
        style={{ background: accent, width: 7, height: 7, border: '2px solid #fff' }}
      />

      <div style={{ padding: '11px 13px 11px 15px' }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: titleColor, lineHeight: 1.3, paddingRight: data.visitCount > 0 ? 18 : 0 }}>
          {data.label}
        </div>
        <div style={{ fontSize: 10.5, color: lens ? accent : subtitleColor, fontWeight: 600, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.03em', opacity: dark ? 1 : 0.85 }}>
          {data.lens ? lens.label : data.domain}
          {!data.lens && data.apis?.length > 0 && ` · ${data.apis.length} API${data.apis.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{ background: accent, width: 7, height: 7, border: '2px solid #fff' }}
      />
    </div>
  );
}
