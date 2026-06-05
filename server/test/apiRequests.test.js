import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractApiRequests } from '../services/apiRequests.js';

const stations = [
  { id: 'login', label: 'Login', startTimestamp: 1000 },
  { id: 'feed', label: 'Feed', startTimestamp: 2000 },
];

test('extractApiRequests skips OPTIONS preflight', () => {
  const rec = { networkRequests: [
    { method: 'OPTIONS', url: 'http://x/api/auth/login', status: 204, timestamp: 1100 },
    { method: 'POST', url: 'http://x/api/auth/login', status: 200, responseBody: '{"token":"a"}', timestamp: 1100 },
  ] };
  const out = extractApiRequests(rec, stations);
  assert.equal(out.length, 1);
  assert.equal(out[0].data.method, 'POST');
});

test('extractApiRequests assigns each request to the last station started before it', () => {
  const rec = { networkRequests: [
    { method: 'POST', url: 'http://x/api/auth/login', status: 200, responseBody: 'x', timestamp: 1500 },
    { method: 'GET', url: 'http://x/api/stories', status: 200, responseBody: 'y', timestamp: 2500 },
  ] };
  const out = extractApiRequests(rec, stations);
  const byStation = Object.fromEntries(out.map((o) => [o.data.method, o.stationId]));
  assert.equal(byStation.POST, 'login');
  assert.equal(byStation.GET, 'feed');
});

test('extractApiRequests dedupes same endpoint per station, keeping richest body', () => {
  const rec = { networkRequests: [
    { method: 'GET', url: 'http://x/api/stories', status: 304, responseBody: '', timestamp: 2100 },
    { method: 'GET', url: 'http://x/api/stories', status: 200, responseBody: '{"stories":[1,2,3]}', timestamp: 2200 },
  ] };
  const out = extractApiRequests(rec, stations);
  assert.equal(out.length, 1);
  assert.equal(out[0].data.responseBody, '{"stories":[1,2,3]}', 'keeps the 200 over the empty 304');
});

test('extractApiRequests returns empty when no stations have timestamps', () => {
  const rec = { networkRequests: [{ method: 'GET', url: '/api/x', status: 200, timestamp: 1 }] };
  assert.deepEqual(extractApiRequests(rec, [{ id: 'a', label: 'A' }]), []);
});
