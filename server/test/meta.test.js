import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMeta } from '../services/meta.js';

test('parseMeta prefers og:title over <title>', () => {
  const html = `<head><title>Fallback</title><meta property="og:title" content="Incident: stories 500s"></head>`;
  const m = parseMeta(html, 'http://x');
  assert.equal(m.title, 'Incident: stories 500s');
});

test('parseMeta falls back to <title>', () => {
  const m = parseMeta('<title>Just a title</title>', 'http://x');
  assert.equal(m.title, 'Just a title');
});

test('parseMeta decodes HTML entities', () => {
  const m = parseMeta('<title>Auth &amp; Login</title>', 'http://x');
  assert.equal(m.title, 'Auth & Login');
});

test('parseMeta extracts description and published date', () => {
  const html = `<meta name="description" content="A postmortem">
    <meta property="article:published_time" content="2026-01-15T10:00:00Z">`;
  const m = parseMeta(html, 'http://x');
  assert.equal(m.description, 'A postmortem');
  assert.equal(m.date, '2026-01-15T10:00:00Z');
});

test('parseMeta falls back to the url when no title', () => {
  const m = parseMeta('<div>no head tags</div>', 'http://example.com/x');
  assert.equal(m.title, 'http://example.com/x');
});
