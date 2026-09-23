CREATE TABLE IF NOT EXISTS protection_quotas (
  id TEXT PRIMARY KEY,
  used INTEGER NOT NULL,
  reset_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_protection_quota_expiry ON protection_quotas(reset_at);
CREATE TABLE IF NOT EXISTS evaluation_controls (
  id TEXT PRIMARY KEY,
  version BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  record JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evaluation_control_expiry ON evaluation_controls(expires_at);
