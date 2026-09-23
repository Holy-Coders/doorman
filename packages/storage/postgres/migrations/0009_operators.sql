CREATE TABLE operator_windows (
  account_key TEXT NOT NULL,
  id TEXT NOT NULL,
  browser_key TEXT,
  session_key TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  ended_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  status TEXT NOT NULL,
  lease TEXT NOT NULL,
  record JSONB NOT NULL,
  PRIMARY KEY (account_key, id)
);
CREATE INDEX idx_operator_account_seen ON operator_windows(account_key, started_at DESC, id);
CREATE INDEX idx_operator_browser ON operator_windows(account_key, browser_key);
CREATE INDEX idx_operator_session ON operator_windows(account_key, session_key);
CREATE INDEX idx_operator_expiry ON operator_windows(expires_at);
