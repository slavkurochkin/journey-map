import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFeatureFlags, SESSION_SCOPE_STATION } from '../services/featureFlags.js';

const stations = [
  { id: 'login', label: 'Login', startTimestamp: 1000 },
  { id: 'search', label: 'Search', startTimestamp: 2000 },
];

test('bulk read at one timestamp is treated as session-scoped', () => {
  const rec = { featureFlags: [
    { type: 'flag', provider: 'LaunchDarkly', key: 'a', value: false, kind: 'eval', timestamp: 1500 },
    { type: 'flag', provider: 'LaunchDarkly', key: 'b', value: 'streamlined', kind: 'eval', timestamp: 1500 },
    { type: 'flag', provider: 'LaunchDarkly', key: 'c', value: true, kind: 'eval', timestamp: 1500 },
  ] };
  const out = extractFeatureFlags(rec, stations);
  assert.equal(out.length, 3);
  assert.ok(out.every((f) => f.scope === 'session' && f.stationId === SESSION_SCOPE_STATION));
});

test('explicit kind:bootstrap is session-scoped even when alone', () => {
  const rec = { featureFlags: [
    { type: 'flag', key: 'a', value: true, kind: 'bootstrap', timestamp: 1500 },
  ] };
  const out = extractFeatureFlags(rec, stations);
  assert.equal(out[0].scope, 'session');
});

test('distinct per-eval timestamps map to the station that owns the moment', () => {
  const rec = { featureFlags: [
    { type: 'flag', key: 'a', value: true, kind: 'eval', timestamp: 1200 },
    { type: 'flag', key: 'b', value: true, kind: 'eval', timestamp: 2300 },
  ] };
  const byKey = Object.fromEntries(extractFeatureFlags(rec, stations).map((f) => [f.name, f]));
  assert.equal(byKey.a.stationId, 'login');
  assert.equal(byKey.a.scope, 'station');
  assert.equal(byKey.b.stationId, 'search');
});

test('a change event maps to its station regardless of others', () => {
  const rec = { featureFlags: [
    { type: 'flag', key: 'x', value: false, kind: 'eval', timestamp: 1000 },
    { type: 'flag', key: 'x', value: true, previous: false, changed: true, kind: 'change', timestamp: 2100 },
  ] };
  const out = extractFeatureFlags(rec, stations);
  // session bootstrap-ish 'eval' at 1000 (alone, so station 'login') + the change on 'search'
  const change = out.find((f) => f.stationId === 'search');
  assert.ok(change, 'change event landed on the search station');
  assert.equal(change.enabled, true);
});

test('value maps to enabled: false/0/empty are off, variants/true are on', () => {
  const rec = { featureFlags: [
    { type: 'flag', key: 'off1', value: false, kind: 'eval', timestamp: 1100 },
    { type: 'flag', key: 'off2', value: 0, kind: 'eval', timestamp: 1100 },
    { type: 'flag', key: 'on1', value: true, kind: 'eval', timestamp: 1100 },
    { type: 'flag', key: 'on2', value: 'streamlined', kind: 'eval', timestamp: 1100 },
  ] };
  const byKey = Object.fromEntries(extractFeatureFlags(rec, stations).map((f) => [f.name, f]));
  assert.equal(byKey.off1.enabled, false);
  assert.equal(byKey.off2.enabled, false);
  assert.equal(byKey.on1.enabled, true);
  assert.equal(byKey.on2.enabled, true);
  assert.equal(byKey.on2.value, '"streamlined"', 'served value preserved as JSON');
});

test('dedupes a repeated key, preferring the changed eval', () => {
  const rec = { featureFlags: [
    { type: 'flag', key: 'k', value: false, kind: 'eval', timestamp: 1200 },
    { type: 'flag', key: 'k', value: true, changed: true, kind: 'change', timestamp: 1300 },
  ] };
  const out = extractFeatureFlags(rec, stations).filter((f) => f.name === 'k' && f.stationId === 'login');
  assert.equal(out.length, 1);
  assert.equal(out[0].enabled, true, 'kept the changed=true value');
});

test('no featureFlags array yields nothing', () => {
  assert.deepEqual(extractFeatureFlags({}, stations), []);
  assert.deepEqual(extractFeatureFlags({ featureFlags: [] }, stations), []);
});
