import {
  // observability
  LayoutDashboard, Radar, ScrollText, BellRing, TrendingUp,
  // doc types
  FileText, Ruler, Palette, BookText, Link2,
  // impact evidence
  Webhook, Server, ArrowDownRight, Flag, Flame, FlaskConical, FileClock,
  // misc
  Target, ThumbsUp, ThumbsDown, AlertTriangle,
  ExternalLink, Upload, RefreshCw, Square, CornerUpRight, Waypoints,
} from 'lucide-react';

const MAP = {
  // observability
  dashboard: LayoutDashboard,
  trace: Radar,
  logs: ScrollText,
  alert: BellRing,
  metric: TrendingUp,
  // doc types
  prd: FileText,
  'eng-design': Ruler,
  design: Palette,
  runbook: BookText,
  other: Link2,
  // impact evidence
  endpoint: Webhook,
  service: Server,
  downstream: ArrowDownRight,
  flag: Flag,
  incident: Flame,
  'coverage-gap': FlaskConical,
  'doc-stale': FileClock,
  // misc / actions
  target: Target,
  'thumbs-up': ThumbsUp,
  'thumbs-down': ThumbsDown,
  warning: AlertTriangle,
  'external-link': ExternalLink,
  import: Upload,
  refresh: RefreshCw,
  square: Square,
  move: CornerUpRight,
  map: Waypoints,
};

export default function Icon({ name, size = 14, strokeWidth = 2, className = '' }) {
  const C = MAP[name];
  if (!C) return null;
  return <C size={size} strokeWidth={strokeWidth} className={`inline-block shrink-0 ${className}`} />;
}
