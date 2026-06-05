import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractScreenshots, dataUrlToBuffer } from '../services/screenshots.js';

const stations = [
  { id: 'login', label: 'Login', startTimestamp: 1000 },
  { id: 'feed', label: 'Feed', startTimestamp: 2000 },
];

test('extractScreenshots assigns each shot to the last station started before it', () => {
  const rec = { steps: [
    { type: 'screenshot', timestamp: 1500, dataUrl: 'data:image/png;base64,AAA' },
    { type: 'screenshot', timestamp: 2500, dataUrl: 'data:image/png;base64,BBB' },
    { type: 'click', timestamp: 1600 },
  ] };
  const out = extractScreenshots(rec, stations);
  assert.equal(out.length, 2);
  assert.equal(out[0].stationId, 'login');
  assert.equal(out[1].stationId, 'feed');
});

test('extractScreenshots ignores non-screenshot steps and missing dataUrl', () => {
  const rec = { steps: [
    { type: 'screenshot', timestamp: 1500 }, // no dataUrl
    { type: 'click', timestamp: 1600 },
  ] };
  assert.deepEqual(extractScreenshots(rec, stations), []);
});

test('dataUrlToBuffer strips the data-url prefix and decodes base64', () => {
  const buf = dataUrlToBuffer('data:image/png;base64,' + Buffer.from('hello').toString('base64'));
  assert.equal(buf.toString(), 'hello');
});
