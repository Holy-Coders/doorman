CREATE TABLE learning_sessions (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  observed_at BIGINT NOT NULL,
  signals_json JSONB NOT NULL,
  subject_id TEXT REFERENCES identity_subjects(id) ON DELETE CASCADE,
  verified_at BIGINT,
  disputed INTEGER NOT NULL DEFAULT 0,
  prediction_status TEXT NOT NULL,
  predicted_subject_id TEXT REFERENCES identity_subjects(id) ON DELETE CASCADE,
  prediction_score REAL
);
CREATE INDEX idx_learning_scope_verified ON learning_sessions(scope, verified_at DESC);
CREATE INDEX idx_learning_scope_expiry ON learning_sessions(scope, expires_at);
CREATE INDEX idx_learning_subject_verified ON learning_sessions(subject_id, verified_at DESC);
CREATE INDEX idx_learning_predicted_subject ON learning_sessions(predicted_subject_id);
