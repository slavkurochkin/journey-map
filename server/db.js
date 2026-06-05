import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endpointKey } from './services/endpoints.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, 'sessions.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    recording TEXT NOT NULL,
    result TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS screenshots (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    station_id TEXT NOT NULL,
    data BLOB NOT NULL,
    source TEXT NOT NULL DEFAULT 'recording'
  );
`);

// Migrations: add columns that may be missing from older DB files
const migrate = (sql) => { try { db.exec(sql); } catch { /* column exists */ } };
migrate(`ALTER TABLE screenshots ADD COLUMN source TEXT NOT NULL DEFAULT 'recording'`);
migrate(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)`);
migrate(`CREATE TABLE IF NOT EXISTS api_requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  data TEXT NOT NULL
)`);
migrate(`ALTER TABLE api_requests ADD COLUMN endpoint TEXT`);
migrate(`ALTER TABLE api_requests ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'`);
migrate(`CREATE TABLE IF NOT EXISTS station_services (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  name TEXT NOT NULL
)`);
migrate(`ALTER TABLE station_services ADD COLUMN coverage TEXT`);
migrate(`CREATE TABLE IF NOT EXISTS feature_flags (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
)`);
migrate(`ALTER TABLE feature_flags ADD COLUMN rollout TEXT`);
migrate(`ALTER TABLE feature_flags ADD COLUMN description TEXT`);
migrate(`CREATE TABLE IF NOT EXISTS observability (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  url TEXT
)`);
migrate(`CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  description TEXT NOT NULL,
  url TEXT,
  occurred_at TEXT,
  severity TEXT
)`);
migrate(`CREATE TABLE IF NOT EXISTS test_coverage (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  url TEXT
)`);
// Journey-level docs (PRD, Eng Design, etc.) — global, shared across all sessions
migrate(`CREATE TABLE IF NOT EXISTS journey_docs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`);
// Station-level design/doc links — scoped to a station
migrate(`CREATE TABLE IF NOT EXISTS station_docs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`);
// Feedback on impact-analysis concerns — measures precision over time
migrate(`CREATE TABLE IF NOT EXISTS concern_feedback (
  id TEXT PRIMARY KEY,
  change_text TEXT,
  station_label TEXT,
  level TEXT,
  confidence TEXT,
  vote TEXT NOT NULL,
  created_at TEXT NOT NULL
)`);
// Eval cases — a change + the stations that SHOULD be flagged (ground truth),
// used to measure impact-analysis recall before prompt/model changes.
migrate(`CREATE TABLE IF NOT EXISTS eval_cases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  change_text TEXT NOT NULL,
  expected TEXT NOT NULL,
  last_recall INTEGER,
  last_precision INTEGER,
  last_run_at TEXT,
  created_at TEXT NOT NULL
)`);
// User corrections to station identity in the aggregate map: merge a canonical
// key into another, and/or give it a custom label.
migrate(`CREATE TABLE IF NOT EXISTS station_overrides (
  canonical_key TEXT PRIMARY KEY,
  merged_into TEXT,
  custom_label TEXT
)`);
migrate(`ALTER TABLE station_overrides ADD COLUMN color TEXT`);
// App-level result memoization: skip the model entirely on exact repeats.
// Keyed on a hash of (label + provider + model + query + context), so any change
// to the change text, the station context, or the model naturally misses.
migrate(`CREATE TABLE IF NOT EXISTS impact_cache (
  key TEXT PRIMARY KEY,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL
)`);
// Saved/shareable impact reports — a change + its full analysis result (+ test
// plan), persisted so it can be reopened or shared via ?report=<id>.
migrate(`CREATE TABLE IF NOT EXISTS impact_reports (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  change_text TEXT NOT NULL,
  result TEXT NOT NULL,
  test_plan TEXT,
  created_at TEXT NOT NULL
)`);

// ---- Data migrations / cleanup (run once at startup) ----

// Backfill endpoint signature for api_requests uploaded before the column existed
(() => {
  const rows = db.prepare('SELECT id, data FROM api_requests WHERE endpoint IS NULL').all();
  const upd = db.prepare('UPDATE api_requests SET endpoint = ? WHERE id = ?');
  for (const row of rows) {
    try {
      const d = JSON.parse(row.data);
      upd.run(endpointKey(d.method, d.url), row.id);
    } catch { /* skip malformed */ }
  }
})();

// Remove orphaned child rows from sessions deleted before cascade-delete existed
(() => {
  const tables = ['screenshots', 'api_requests', 'station_services', 'feature_flags',
                  'observability', 'incidents', 'test_coverage', 'station_docs'];
  let removed = 0;
  for (const t of tables) {
    const r = db.prepare(`DELETE FROM ${t} WHERE session_id NOT IN (SELECT id FROM sessions)`).run();
    removed += r.changes ?? 0;
  }
  if (removed) console.log(`Cleaned up ${removed} orphaned child rows from deleted sessions`);
})();

export default db;
