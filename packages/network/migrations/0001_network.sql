-- Compatible with both Postgres and SQLite/D1. Separate from visitor identity storage.
CREATE TABLE jn_meta (id INTEGER PRIMARY KEY CHECK(id=1), revision BIGINT NOT NULL);
INSERT INTO jn_meta (id,revision) VALUES (1,0);
CREATE TABLE jn_tenants (
  id TEXT PRIMARY KEY, key_hash TEXT UNIQUE NOT NULL,
  evaluation INTEGER NOT NULL DEFAULT 0 CHECK(evaluation IN (0,1)),
  contribution INTEGER NOT NULL DEFAULT 0 CHECK(contribution IN (0,1)),
  training INTEGER NOT NULL DEFAULT 0 CHECK(training IN (0,1)),
  training_approved INTEGER NOT NULL DEFAULT 0 CHECK(training_approved IN (0,1)),
  retention_days INTEGER NOT NULL DEFAULT 30 CHECK(retention_days BETWEEN 1 AND 30),
  CHECK(training=0 OR (contribution=1 AND training_approved=1))
);
CREATE TABLE jn_samples (
  tenant_id TEXT NOT NULL REFERENCES jn_tenants(id) ON DELETE CASCADE,
  id TEXT NOT NULL, session_ref TEXT NOT NULL, observed_at BIGINT NOT NULL,
  features TEXT NOT NULL, cohort TEXT NOT NULL, training_allowed INTEGER NOT NULL CHECK(training_allowed IN (0,1)),
  expires_at BIGINT NOT NULL, PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,session_ref)
);
CREATE INDEX jn_sample_training ON jn_samples(tenant_id,training_allowed,observed_at DESC);
CREATE INDEX jn_sample_expiry ON jn_samples(expires_at);
CREATE TABLE jn_labels (
  tenant_id TEXT NOT NULL, sample_id TEXT NOT NULL,
  target TEXT NOT NULL CHECK(target IN ('assistant','abuse')), positive INTEGER NOT NULL CHECK(positive IN (0,1)),
  source TEXT NOT NULL, evidence_ref TEXT NOT NULL, confirmed_at BIGINT NOT NULL,
  disputed INTEGER NOT NULL CHECK(disputed IN (0,1)), PRIMARY KEY(tenant_id,sample_id,target),
  FOREIGN KEY(tenant_id,sample_id) REFERENCES jn_samples(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE jn_quotas (
  key TEXT NOT NULL, window_id BIGINT NOT NULL, used INTEGER NOT NULL, expires_at BIGINT NOT NULL, PRIMARY KEY(key,window_id)
);
CREATE INDEX jn_quota_expiry ON jn_quotas(expires_at);
CREATE TABLE jn_cache (key TEXT PRIMARY KEY, lease TEXT NOT NULL, expires_at BIGINT NOT NULL, result TEXT);
CREATE INDEX jn_cache_expiry ON jn_cache(expires_at);
CREATE TABLE jn_models (
  id TEXT PRIMARY KEY, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL, revision BIGINT NOT NULL,
  payload TEXT NOT NULL, target TEXT NOT NULL CHECK(target IN ('assistant','abuse')),
  status TEXT NOT NULL CHECK(status IN ('shadow','canary','retired')), canary INTEGER NOT NULL CHECK(canary BETWEEN 0 AND 100)
);
CREATE INDEX jn_model_current ON jn_models(status,revision,created_at DESC);
