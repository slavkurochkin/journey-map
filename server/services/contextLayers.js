// Context-engineering experiment: treat the impact context as a stack of layers.
// L0 ("user journey") is the always-on baseline (what a step is + the graph);
// each later layer adds one enrichment dimension produced by gatherStationContext.
// `withLayers` returns a copy of that context with disabled layers stripped, so we
// can run the SAME eval set under progressively more context and watch the score
// move — context engineering made measurable, not asserted.

// Each layer maps to the station fields (and, where noted, context-level fields)
// it contributes. Order = the order they're added in the cumulative experiment.
export const LAYERS = [
  { id: 'journey',   label: 'User journey',         always: true, stationFields: ['id', 'label', 'domain', 'actions'] },
  { id: 'apis',      label: 'APIs',                 stationFields: ['apis'] },
  { id: 'services',  label: 'Services + coverage',  stationFields: ['services', 'testCoverage'] },
  { id: 'flags',     label: 'Feature flags',        stationFields: ['featureFlags'] },
  { id: 'incidents', label: 'Past incidents',       stationFields: ['pastIncidents'] },
  { id: 'traces',    label: 'Traces (ground truth)', stationFields: ['traces'] },
  { id: 'docs',      label: 'Design docs',          stationFields: ['observability', 'designDocs'], contextFields: ['journeyDocs'] },
];

// A field carries no information if it's null/undefined, an empty array, or an
// empty object. Stripping these matters for the experiment: otherwise an empty
// layer (e.g. `designDocs: []` on every station) still adds tokens and perturbs a
// stochastic model — a phantom "improvement" that's really just noise.
function isEmptyValue(v) {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

// Return { stations, edges, [journeyDocs] } with only the enabled layers' fields,
// dropping fields that hold no data. Unknown layer ids are ignored; the journey
// baseline is always kept.
export function withLayers(context, enabledLayerIds) {
  const enabled = new Set(enabledLayerIds);
  const keepStation = new Set();
  const keepContext = new Set(['stations', 'edges']); // the journey graph is the baseline
  for (const layer of LAYERS) {
    if (!layer.always && !enabled.has(layer.id)) continue;
    for (const f of layer.stationFields || []) keepStation.add(f);
    for (const f of layer.contextFields || []) keepContext.add(f);
  }

  const stations = (context.stations || []).map((st) => {
    const out = {};
    for (const k of Object.keys(st)) {
      if (keepStation.has(k) && !isEmptyValue(st[k])) out[k] = st[k];
    }
    return out;
  });

  const out = { stations, edges: context.edges || [] };
  for (const k of Object.keys(context)) {
    if (k === 'stations' || k === 'edges') continue;
    if (keepContext.has(k) && !isEmptyValue(context[k])) out[k] = context[k];
  }
  return out;
}

// Saturation stress-test: the full stack, then padded with increasing amounts of
// plausible-but-irrelevant filler. F1 should plateau while tokens (cost) keep rising —
// the "past N tokens you're just burning money" curve.
export const SATURATION_FACTORS = [1, 2, 3, 5, 8];
export function saturationConfigs() {
  return SATURATION_FACTORS.map((f) => ({ id: `${f}x`, label: `${f}× context`, factor: f }));
}

// Inflate a context to ~factor× its JSON size with irrelevant "reference material"
// chunks — noise the model must sift through, not new signal.
export function padContext(context, factor) {
  if (!factor || factor <= 1) return context;
  const base = JSON.stringify(context).length;
  const extra = Math.round(base * (factor - 1));
  const line = 'Archived internal reference: legacy module notes, closed ticket summaries, and historical configuration details not relevant to the current change. ';
  const chunks = [];
  let acc = 0, n = 0;
  while (acc < extra) {
    const target = Math.min(700, extra - acc);
    let chunk = '';
    while (chunk.length < target) chunk += line;
    chunk = `[ref-${n++}] ${chunk.slice(0, target)}`;
    chunks.push(chunk);
    acc += chunk.length;
  }
  return { ...context, referenceMaterial: chunks };
}

// Leave-one-out: the full stack, then the full stack MINUS each optional layer. The
// F1 drop when a layer is removed is its honest attribution — measured by ablation,
// not by asking the model what it "used".
export function leaveOneOutConfigs() {
  const all = LAYERS.map((l) => l.id);
  const optional = LAYERS.filter((l) => !l.always);
  const configs = [{ id: 'full', label: 'Full context', layers: [...all], removed: null }];
  for (const layer of optional) {
    configs.push({ id: layer, label: `− ${layer.label}`, layers: all.filter((l) => l !== layer.id), removed: layer.id });
  }
  return configs;
}

// The cumulative ladder: [L0], [L0,L1], [L0,L1,L2], … each step adding one layer.
// This is the "does more context help?" curve.
export function cumulativeConfigs() {
  const base = LAYERS.filter((l) => l.always).map((l) => l.id);
  const optional = LAYERS.filter((l) => !l.always);
  const configs = [{ id: 'journey', label: 'User journey', layers: [...base] }];
  let acc = [...base];
  for (const layer of optional) {
    acc = [...acc, layer.id];
    configs.push({ id: layer.id, label: `+ ${layer.label}`, layers: [...acc] });
  }
  return configs;
}
