import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endpointKey, endpointKeyFromString } from '../services/endpoints.js';

test('endpointKey normalizes a full URL to METHOD + path', () => {
  assert.equal(endpointKey('GET', 'http://localhost:8000/api/stories'), 'GET /api/stories');
});

test('endpointKey replaces numeric ids with :id', () => {
  assert.equal(endpointKey('GET', 'http://localhost:8000/api/users/42'), 'GET /api/users/:id');
  assert.equal(endpointKey('GET', '/api/auth/profile/1'), 'GET /api/auth/profile/:id');
});

test('endpointKey only replaces id-shaped segments, not numbers inside words', () => {
  assert.equal(endpointKey('GET', '/api/v2/stories'), 'GET /api/v2/stories');
});

test('endpointKey uppercases the method and defaults to GET', () => {
  assert.equal(endpointKey('post', '/api/x'), 'POST /api/x');
  assert.equal(endpointKey(null, '/api/x'), 'GET /api/x');
});

test('endpointKeyFromString splits "METHOD path"', () => {
  assert.equal(endpointKeyFromString('POST /api/auth/login'), 'POST /api/auth/login');
  assert.equal(endpointKeyFromString('GET /api/users/7'), 'GET /api/users/:id');
});

test('endpointKeyFromString with no method defaults to GET', () => {
  assert.equal(endpointKeyFromString('/api/stories'), 'GET /api/stories');
});
