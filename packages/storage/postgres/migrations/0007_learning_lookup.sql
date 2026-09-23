-- Bounded learning retrieval: no scan of the most recent people in the application.
CREATE INDEX IF NOT EXISTS idx_learning_scope_language ON learning_sessions (scope, (signals_json #>> '{languages,0}'), verified_at DESC, id DESC) WHERE subject_id IS NOT NULL AND disputed = 0;
CREATE INDEX IF NOT EXISTS idx_learning_scope_timezone ON learning_sessions (scope, (signals_json ->> 'timezone'), verified_at DESC, id DESC) WHERE subject_id IS NOT NULL AND disputed = 0;
