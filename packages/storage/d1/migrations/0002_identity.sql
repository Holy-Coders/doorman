CREATE TABLE identity_subjects (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('person', 'agent')),
  record TEXT NOT NULL
);
CREATE TABLE identity_keys (
  digest TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES identity_subjects(id) ON DELETE CASCADE,
  record TEXT NOT NULL
);
CREATE INDEX idx_identity_keys_subject ON identity_keys(subject_id);
CREATE TABLE identity_delegations (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES identity_subjects(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES identity_subjects(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  record TEXT NOT NULL
);
CREATE INDEX idx_identity_delegations_expiry ON identity_delegations(expires_at);
CREATE INDEX idx_identity_delegations_principal ON identity_delegations(principal_id);
CREATE INDEX idx_identity_delegations_actor ON identity_delegations(actor_id);
