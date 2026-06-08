import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalKey, safeId, aggregateResults, dedupeActions, actionSigKey } from '../services/aggregate.js';

test('canonicalKey groups stations by domain + normalized APIs', () => {
  const a = { domain: 'authentication', label: 'Admin Login', apis: ['POST /api/auth/login'] };
  const b = { domain: 'authentication', label: 'Login Form Entry', apis: ['POST /api/auth/login'] };
  // Different labels, same API → same key (this was the merge bug we fixed)
  assert.equal(canonicalKey(a), canonicalKey(b));
});

test('canonicalKey normalizes numeric ids in APIs', () => {
  const a = { domain: 'user', label: 'Profile', apis: ['GET /api/auth/profile/1'] };
  const b = { domain: 'user', label: 'Profile', apis: ['GET /api/auth/profile/2'] };
  assert.equal(canonicalKey(a), canonicalKey(b));
});

test('canonicalKey falls back to label when no APIs', () => {
  const a = { domain: 'content', label: 'Home Feed', apis: [] };
  assert.equal(canonicalKey(a), 'content:home-feed');
});

test('safeId strips non-alphanumerics', () => {
  assert.equal(safeId('authentication:POST /api/auth/login'), 'authentication_POST_api_auth_login');
});

test('aggregateResults merges same-endpoint stations across sessions', () => {
  const session = (sid, label) => ({
    sessionId: sid,
    result: {
      stations: [{ id: 's1', domain: 'authentication', label, apis: ['POST /api/auth/login'], durationMs: 100 }],
      edges: [],
    },
  });
  const out = aggregateResults([session('A', 'Admin Login'), session('B', 'Login Form Entry')]);
  assert.equal(out.stations.length, 1, 'two login stations merge into one');
  assert.equal(out.stations[0].visitCount, 2);
  assert.equal(out.stations[0].sessionMappings.length, 2);
  assert.equal(out.sessionCount, 2);
});

test('aggregateResults counts and weights edges', () => {
  const mk = (sid) => ({
    sessionId: sid,
    result: {
      stations: [
        { id: 'a', domain: 'authentication', label: 'Login', apis: ['POST /api/auth/login'] },
        { id: 'b', domain: 'content', label: 'Feed', apis: ['GET /api/stories'] },
      ],
      edges: [{ source: 'a', target: 'b' }],
    },
  });
  const out = aggregateResults([mk('A'), mk('B')]);
  assert.equal(out.edges.length, 1);
  assert.equal(out.edges[0].count, 2);
  assert.equal(out.edges[0].weight, 1); // only edge → max weight
});

test('aggregateResults applies a custom-label override', () => {
  const s = {
    sessionId: 'A',
    result: { stations: [{ id: 'a', domain: 'content', label: 'Feed', apis: ['GET /api/stories'] }], edges: [] },
  };
  const key = canonicalKey(s.result.stations[0]);
  const out = aggregateResults([s], { [key]: { customLabel: 'Home Feed (renamed)' } });
  assert.equal(out.stations[0].label, 'Home Feed (renamed)');
});

test('aggregateResults merges one station into another via override', () => {
  const sess = {
    sessionId: 'A',
    result: {
      stations: [
        { id: 'a', domain: 'content', label: 'Feed', apis: ['GET /api/stories'] },
        { id: 'b', domain: 'content', label: 'Stories', apis: ['GET /api/stories/v2'] },
      ],
      edges: [],
    },
  };
  const keyA = canonicalKey(sess.result.stations[0]);
  const keyB = canonicalKey(sess.result.stations[1]);
  const out = aggregateResults([sess], { [keyB]: { mergedInto: keyA } });
  assert.equal(out.stations.length, 1, 'B merged into A');
  assert.equal(out.stations[0].canonicalKey, keyA);
});

test('aggregateResults exposes mergedFrom on the target (for unmerge)', () => {
  const sess = {
    sessionId: 'A',
    result: {
      stations: [
        { id: 'a', domain: 'content', label: 'Feed', apis: ['GET /api/stories'] },
        { id: 'b', domain: 'content', label: 'Stories', apis: ['GET /api/stories/v2'] },
      ],
      edges: [],
    },
  };
  const keyA = canonicalKey(sess.result.stations[0]);
  const keyB = canonicalKey(sess.result.stations[1]);
  const out = aggregateResults([sess], { [keyB]: { mergedInto: keyA } });
  const target = out.stations.find((s) => s.canonicalKey === keyA);
  assert.equal(target.mergedFrom.length, 1);
  assert.equal(target.mergedFrom[0].canonicalKey, keyB);
  assert.equal(target.mergedFrom[0].label, 'Stories', 'recovers the original label of the merged station');
});

test('merged station keeps the TARGET identity even if the source was recorded first', () => {
  // Source "Stories" appears before target "Feed" in the data
  const sess = {
    sessionId: 'A',
    result: {
      stations: [
        { id: 'b', domain: 'content', label: 'Stories', apis: ['GET /api/stories/v2'] },
        { id: 'a', domain: 'content', label: 'Feed', apis: ['GET /api/stories'] },
      ],
      edges: [],
    },
  };
  const keyFeed = canonicalKey(sess.result.stations[1]);
  const keyStories = canonicalKey(sess.result.stations[0]);
  // Merge Stories INTO Feed → Feed should survive with label "Feed"
  const out = aggregateResults([sess], { [keyStories]: { mergedInto: keyFeed } });
  assert.equal(out.stations.length, 1);
  assert.equal(out.stations[0].canonicalKey, keyFeed);
  assert.equal(out.stations[0].label, 'Feed', 'target identity wins regardless of order');
  assert.equal(out.stations[0].visitCount, 2);
});

test('aggregateResults unions actions across merged stations', () => {
  const sess = {
    sessionId: 'A',
    result: {
      stations: [
        { id: 'a', domain: 'content', label: 'Feed', apis: ['GET /api/stories'], actions: ['Load feed'] },
        { id: 'b', domain: 'content', label: 'Stories', apis: ['GET /api/stories/v2'], actions: ['Scroll stories', 'Load feed'] },
      ],
      edges: [],
    },
  };
  const keyFeed = canonicalKey(sess.result.stations[0]);
  const keyStories = canonicalKey(sess.result.stations[1]);
  const out = aggregateResults([sess], { [keyStories]: { mergedInto: keyFeed } });
  const s = out.stations[0];
  assert.deepEqual(s.actions, ['Load feed', 'Scroll stories'], 'unioned + deduped');
  assert.ok(s.apis.includes('GET /api/stories') && s.apis.includes('GET /api/stories/v2'), 'apis unioned too');
});

test('dedupeActions collapses differently-phrased duplicates of the same step', () => {
  const out = dedupeActions([
    "Click the 'Log In' button to submit credentials for admin@instaverse.com",
    "Click the 'Log In' button to submit credentials",
    "Click 'Log In' button",
    'Click Login button',
    "Enter email 'admin@instaverse.com' into email field",
    'Enter email',
    'Enter password into password field',
    'Enter password',
  ]);
  // One representative per real step (click login / enter email / enter password)
  assert.equal(out.length, 3);
  assert.ok(out.some((a) => /Click/.test(a)));
  assert.ok(out.some((a) => /email field/.test(a)), 'keeps the descriptive email phrasing');
  assert.ok(out.some((a) => /password field/.test(a)), 'keeps the descriptive password phrasing');
});

test('dedupeActions keeps genuinely distinct actions', () => {
  const out = dedupeActions(['Enter email', 'Enter password', 'Click Save button', 'Click Cancel button']);
  assert.equal(out.length, 4);
});

test('aggregateResults dedupes near-duplicate actions on merged stations', () => {
  const mk = (sid, action) => ({
    sessionId: sid,
    result: { stations: [{ id: 'a', domain: 'authentication', label: 'Login', apis: ['POST /api/auth/login'], actions: [action] }], edges: [] },
  });
  const out = aggregateResults([
    mk('A', 'Click Login button'),
    mk('B', "Click the 'Log In' button to submit credentials"),
  ]);
  assert.equal(out.stations.length, 1);
  assert.equal(out.stations[0].actions.length, 1, 'two phrasings of the same click collapse to one');
});

test('aggregateResults exposes a stable actionKey per visible action', () => {
  const s = {
    sessionId: 'A',
    result: { stations: [{ id: 'a', domain: 'authentication', label: 'Login', apis: ['POST /api/auth/login'], actions: ['Click Login button'] }], edges: [] },
  };
  const out = aggregateResults([s]);
  assert.equal(out.stations[0].actionKeys.length, out.stations[0].actions.length);
  assert.equal(out.stations[0].actionKeys[0], actionSigKey('Click Login button'));
});

test('aggregateResults hides an action via override (delete), surviving re-aggregation', () => {
  const mk = (sid, action) => ({
    sessionId: sid,
    result: { stations: [{ id: 'a', domain: 'authentication', label: 'Login', apis: ['POST /api/auth/login'], actions: [action] }], edges: [] },
  });
  const sessions = [mk('A', 'Click Login button'), mk('B', 'Enter email')];
  const key = canonicalKey(mk('A', 'x').result.stations[0]);
  const overrides = { [key]: { actions: { hidden: [actionSigKey('Click Login button')], renames: {} } } };
  const out = aggregateResults(sessions, overrides);
  assert.equal(out.stations[0].actions.length, 1);
  assert.equal(out.stations[0].actions[0], 'Enter email', 'the hidden action is gone, the other remains');
});

test('aggregateResults renames an action via override (edit), keyed by signature', () => {
  const verbose = "Click the 'Log In' button to submit credentials";
  const s = {
    sessionId: 'A',
    result: { stations: [{ id: 'a', domain: 'authentication', label: 'Login', apis: ['POST /api/auth/login'], actions: [verbose] }], edges: [] },
  };
  const key = canonicalKey(s.result.stations[0]);
  const overrides = { [key]: { actions: { hidden: [], renames: { [actionSigKey(verbose)]: 'Sign in' } } } };
  const out = aggregateResults([s], overrides);
  assert.equal(out.stations[0].actions[0], 'Sign in', 'edit replaces the displayed text');
  // The exposed key stays the ORIGINAL signature, so a follow-up edit still matches.
  assert.equal(out.stations[0].actionKeys[0], actionSigKey(verbose));
});

test('aggregateResults averages duration across visits', () => {
  const mk = (sid, ms) => ({
    sessionId: sid,
    result: { stations: [{ id: 'a', domain: 'content', label: 'Feed', apis: ['GET /api/stories'], durationMs: ms }], edges: [] },
  });
  const out = aggregateResults([mk('A', 100), mk('B', 300)]);
  assert.equal(out.stations[0].durationMs, 200);
});
