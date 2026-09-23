CREATE TABLE IF NOT EXISTS application_events (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  digest TEXT NOT NULL,
  subject_id TEXT REFERENCES identity_subjects(id) ON DELETE CASCADE,
  session_id TEXT,
  actor_id TEXT REFERENCES identity_subjects(id) ON DELETE CASCADE,
  visitor_id TEXT REFERENCES visitors(id) ON DELETE CASCADE,
  action TEXT,
  occurred_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  record JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_subject_time ON application_events(subject_id,scope,occurred_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_events_session_time ON application_events(session_id,scope,occurred_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_events_actor_time ON application_events(actor_id,scope,occurred_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_events_subject_action ON application_events(subject_id,scope,action,occurred_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_events_session_action ON application_events(session_id,scope,action,occurred_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_events_actor_action ON application_events(actor_id,scope,action,occurred_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_events_expiry ON application_events(scope,expires_at);
CREATE INDEX IF NOT EXISTS idx_events_visitor ON application_events(visitor_id);
CREATE TABLE IF NOT EXISTS device_links (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  digest TEXT NOT NULL,
  subject_id TEXT NOT NULL REFERENCES identity_subjects(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  retire_at BIGINT NOT NULL,
  record JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_links_subject ON device_links(subject_id,scope,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_device_links_visitor ON device_links(visitor_id);
CREATE INDEX IF NOT EXISTS idx_device_links_retire ON device_links(scope,retire_at);
