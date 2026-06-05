import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLcov } from '../services/lcov.js';

const SAMPLE = `TN:
SF:src/auth-service/login.js
DA:1,1
LF:10
LH:9
end_of_record
SF:src/stories-service/feed.js
LF:20
LH:10
end_of_record`;

test('parseLcov extracts per-file hit/found', () => {
  const files = parseLcov(SAMPLE);
  assert.equal(files.length, 2);
  assert.deepEqual(files[0], { file: 'src/auth-service/login.js', hit: 9, found: 10 });
  assert.deepEqual(files[1], { file: 'src/stories-service/feed.js', hit: 10, found: 20 });
});

test('parseLcov returns empty for non-lcov text', () => {
  assert.deepEqual(parseLcov('not a coverage file'), []);
});

test('parseLcov ignores incomplete records (no end_of_record)', () => {
  const files = parseLcov('SF:src/x.js\nLF:5\nLH:5');
  assert.equal(files.length, 0);
});
