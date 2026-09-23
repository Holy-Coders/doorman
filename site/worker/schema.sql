-- Application tables for the opt-in public demo. Library migrations run first.
CREATE TABLE IF NOT EXISTS playground_sessions (
  id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS playground_session_expiry ON playground_sessions(expires_at);
CREATE TABLE IF NOT EXISTS playground_visitors (
  session_id TEXT NOT NULL REFERENCES playground_sessions(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  PRIMARY KEY(session_id, visitor_id)
);
CREATE INDEX IF NOT EXISTS playground_visitor_owner ON playground_visitors(visitor_id);
CREATE TABLE IF NOT EXISTS playground_cache (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES playground_sessions(id) ON DELETE CASCADE,
  owner TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  result_json TEXT
);
CREATE INDEX IF NOT EXISTS playground_cache_expiry ON playground_cache(expires_at);
-- Never delete the lifetime counter during cleanup, deployment or user erasure.
CREATE TABLE IF NOT EXISTS playground_budget (
  id TEXT PRIMARY KEY,
  used INTEGER NOT NULL CHECK(used >= 0)
);
