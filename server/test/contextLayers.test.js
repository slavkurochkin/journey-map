import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYERS, withLayers, cumulativeConfigs } from '../services/contextLayers.js';

const fullContext = {
  stations: [{
    id: 's1', label: 'Login', domain: 'authentication', actions: ['Enter email'],
    apis: ['POST /api/auth/login'],
    services: [{ name: 'auth-service', unitTestCoverage: 'covered' }],
    testCoverage: { unit: 'covered' },
    featureFlags: [{ name: 'new_login', enabled: true }],
    pastIncidents: [{ description: 'outage' }],
    observability: [{ type: 'dashboard', label: 'Grafana' }],
    designDocs: [{ type: 'rfc', title: 'Auth redesign' }],
    traces: { servicesObserved: ['auth-service', 'postgres'], p95Ms: 120 },
  }],
  edges: [{ source: 's1', target: 's2' }],
  journeyDocs: [{ type: 'prd', title: 'Login PRD' }],
};

test('journey layer keeps only the baseline fields + edges', () => {
  const out = withLayers(fullContext, ['journey']);
  assert.deepEqual(Object.keys(out.stations[0]).sort(), ['actions', 'domain', 'id', 'label']);
  assert.equal(out.edges.length, 1, 'edges (the graph) are part of the baseline');
  assert.ok(!('journeyDocs' in out), 'journeyDocs ride with the docs layer');
});

test('adding the apis layer reveals apis and nothing else', () => {
  const out = withLayers(fullContext, ['journey', 'apis']);
  assert.ok('apis' in out.stations[0]);
  assert.ok(!('services' in out.stations[0]));
  assert.ok(!('traces' in out.stations[0]));
});

test('traces layer exposes the ground-truth field', () => {
  const out = withLayers(fullContext, ['journey', 'traces']);
  assert.ok('traces' in out.stations[0]);
  assert.ok(!('apis' in out.stations[0]), 'only the enabled layer is added');
});

test('docs layer pulls in observability, designDocs and journeyDocs', () => {
  const out = withLayers(fullContext, ['journey', 'docs']);
  assert.ok('designDocs' in out.stations[0]);
  assert.ok('observability' in out.stations[0]);
  assert.ok('journeyDocs' in out, 'context-level journeyDocs return with the docs layer');
});

test('all layers enabled reproduces every station field', () => {
  const allIds = LAYERS.map((l) => l.id);
  const out = withLayers(fullContext, allIds);
  assert.deepEqual(Object.keys(out.stations[0]).sort(), Object.keys(fullContext.stations[0]).sort());
});

test('cumulativeConfigs builds a growing ladder starting at journey', () => {
  const configs = cumulativeConfigs();
  assert.equal(configs.length, LAYERS.length, 'one config per layer (baseline + each addition)');
  assert.deepEqual(configs[0].layers, ['journey']);
  // each step is a superset of the previous
  for (let i = 1; i < configs.length; i++) {
    assert.ok(configs[i].layers.length === configs[i - 1].layers.length + 1);
    assert.ok(configs[i - 1].layers.every((l) => configs[i].layers.includes(l)));
  }
  // last config contains every layer
  assert.deepEqual(configs.at(-1).layers.sort(), LAYERS.map((l) => l.id).sort());
});

test('an empty layer is a true no-op (no phantom fields or tokens)', () => {
  const sparse = {
    stations: [{ id: 's1', label: 'Login', domain: 'authentication', actions: ['x'], designDocs: [], observability: [], pastIncidents: [] }],
    edges: [],
    journeyDocs: [],
  };
  const withoutDocs = withLayers(sparse, ['journey']);
  const withDocs = withLayers(sparse, ['journey', 'docs', 'incidents']);
  // Empty enrichment fields are stripped, so enabling those layers changes nothing.
  assert.ok(!('designDocs' in withDocs.stations[0]));
  assert.ok(!('observability' in withDocs.stations[0]));
  assert.ok(!('pastIncidents' in withDocs.stations[0]));
  assert.ok(!('journeyDocs' in withDocs));
  assert.equal(JSON.stringify(withDocs).length, JSON.stringify(withoutDocs).length, 'no token cost for an empty layer');
});

test('context shrinks monotonically as layers are removed', () => {
  const configs = cumulativeConfigs();
  let prevSize = 0;
  for (const cfg of configs) {
    const size = JSON.stringify(withLayers(fullContext, cfg.layers)).length;
    assert.ok(size >= prevSize, 'more layers ⇒ at least as much context');
    prevSize = size;
  }
});
