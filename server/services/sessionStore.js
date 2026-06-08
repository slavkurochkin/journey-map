import { randomUUID } from 'node:crypto';
import db from '../db.js';
import { extractScreenshots, dataUrlToBuffer } from './screenshots.js';
import { extractApiRequests } from './apiRequests.js';
import { extractFeatureFlags } from './featureFlags.js';
import { endpointKey } from './endpoints.js';

// Child tables that hang off a session — kept in sync on delete
export const CHILD_TABLES = [
  'screenshots', 'api_requests', 'station_services', 'feature_flags',
  'observability', 'incidents', 'test_coverage', 'station_docs',
];

// Persist a session + auto-extract screenshots and API requests from the recording
export function saveSession(recording, result) {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO sessions (id, title, timestamp, recording, result) VALUES (?, ?, ?, ?, ?)'
  ).run(id, result.title || 'Untitled', new Date().toISOString(), JSON.stringify(recording), JSON.stringify(result));

  if (result.stations?.length) {
    const matched = extractScreenshots(recording, result.stations);
    const insert = db.prepare(
      'INSERT INTO screenshots (id, session_id, station_id, data, source) VALUES (?, ?, ?, ?, ?)'
    );
    for (const { stationId, dataUrl, source } of matched) {
      insert.run(randomUUID(), id, stationId, dataUrlToBuffer(dataUrl), source);
    }

    const apiReqs = extractApiRequests(recording, result.stations);
    const insertReq = db.prepare(
      'INSERT INTO api_requests (id, session_id, station_id, data, endpoint, source) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const { stationId, data } of apiReqs) {
      insertReq.run(randomUUID(), id, stationId, JSON.stringify(data), endpointKey(data.method, data.url), 'recording');
    }

    const flags = extractFeatureFlags(recording, result.stations);
    const insertFlag = db.prepare(
      'INSERT INTO feature_flags (id, session_id, station_id, name, enabled, value, provider, scope, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const f of flags) {
      insertFlag.run(randomUUID(), id, f.stationId, f.name, f.enabled ? 1 : 0, f.value, f.provider, f.scope, 'recording');
    }
  }

  return id;
}

export function deleteSession(id) {
  for (const table of CHILD_TABLES) {
    db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(id);
  }
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}
