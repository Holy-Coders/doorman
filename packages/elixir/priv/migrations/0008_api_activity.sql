CREATE TABLE IF NOT EXISTS api_activity_buckets (
  owner TEXT NOT NULL,
  window_start BIGINT NOT NULL,
  route TEXT NOT NULL,
  requests BIGINT NOT NULL,
  denied BIGINT NOT NULL,
  client_errors BIGINT NOT NULL,
  server_errors BIGINT NOT NULL,
  duration_total_ms BIGINT NOT NULL,
  duration_max_ms BIGINT NOT NULL,
  first_seen_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  short_gaps BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY (owner, window_start, route)
);
CREATE INDEX IF NOT EXISTS idx_api_activity_expiry ON api_activity_buckets(expires_at);
CREATE TABLE IF NOT EXISTS api_activity_assessments (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  lease TEXT NOT NULL,
  next_at BIGINT NOT NULL,
  record JSONB
);
CREATE INDEX IF NOT EXISTS idx_api_assessment_owner ON api_activity_assessments(owner);
CREATE INDEX IF NOT EXISTS idx_api_assessment_expiry ON api_activity_assessments(next_at);
