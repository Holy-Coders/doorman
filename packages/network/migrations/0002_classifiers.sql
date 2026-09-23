CREATE TABLE jn_classifiers (
  id TEXT PRIMARY KEY,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revision BIGINT NOT NULL,
  target TEXT NOT NULL CHECK(target IN ('assistant','abuse')),
  status TEXT NOT NULL CHECK(status IN ('shadow','canary','retired')),
  canary INTEGER NOT NULL DEFAULT 0 CHECK(canary BETWEEN 0 AND 100),
  payload TEXT NOT NULL
);
CREATE INDEX jn_classifiers_active ON jn_classifiers(target,status,created_at DESC);
