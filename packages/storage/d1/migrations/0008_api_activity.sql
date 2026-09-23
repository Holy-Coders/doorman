CREATE TABLE IF NOT EXISTS api_activity_buckets (
  owner TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  route TEXT NOT NULL,
  requests INTEGER NOT NULL,
  denied INTEGER NOT NULL,
  client_errors INTEGER NOT NULL,
  server_errors INTEGER NOT NULL,
  duration_total_ms INTEGER NOT NULL,
  duration_max_ms INTEGER NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  short_gaps INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (owner, window_start, route)
);
CREATE INDEX IF NOT EXISTS idx_api_activity_expiry ON api_activity_buckets(expires_at);
CREATE TABLE IF NOT EXISTS api_activity_assessments (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  lease TEXT NOT NULL,
  next_at INTEGER NOT NULL,
  record TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_assessment_owner ON api_activity_assessments(owner);
CREATE INDEX IF NOT EXISTS idx_api_assessment_expiry ON api_activity_assessments(next_at);
