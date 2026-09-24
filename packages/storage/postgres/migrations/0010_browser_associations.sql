CREATE TABLE IF NOT EXISTS browser_associations (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  visitor_id TEXT NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES identity_subjects(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES identity_subjects(id) ON DELETE CASCADE,
  seen_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  record JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_association_browser ON browser_associations(visitor_id,scope,expires_at DESC,id);
CREATE INDEX IF NOT EXISTS idx_association_subject ON browser_associations(subject_id);
CREATE INDEX IF NOT EXISTS idx_association_expiry ON browser_associations(scope,expires_at);
CREATE INDEX IF NOT EXISTS idx_association_actor ON browser_associations(actor_id);
