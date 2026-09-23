CREATE TABLE visitors (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE TABLE observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  seen_at INTEGER NOT NULL,
  platform TEXT,
  browser TEXT,
  timezone TEXT,
  webgl_renderer TEXT,
  signals_json TEXT NOT NULL
);
CREATE INDEX idx_observation_platform_browser ON observations(platform, browser, seen_at DESC);
CREATE INDEX idx_observation_webgl_renderer ON observations(webgl_renderer, seen_at DESC);
CREATE INDEX idx_observation_timezone_browser ON observations(timezone, browser, seen_at DESC);
CREATE INDEX idx_observation_visitor_seen ON observations(visitor_id, seen_at DESC, id DESC);
CREATE INDEX idx_observation_seen ON observations(seen_at);
CREATE INDEX idx_visitor_seen ON visitors(last_seen_at);
