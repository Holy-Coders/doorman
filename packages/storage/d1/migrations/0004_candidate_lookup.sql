-- Independent probes survive timezone, graphics, or screen/hardware drift.
-- Existing rows are indexed as-is. On a busy Postgres database, build these
-- indexes CONCURRENTLY outside a transaction before rolling out the new code.
CREATE INDEX IF NOT EXISTS idx_observation_screen_hardware ON observations(platform, browser, json_extract(signals_json, '$.screen.width'), json_extract(signals_json, '$.screen.height'), json_extract(signals_json, '$.hardware.hardwareConcurrency'), seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_observation_screen_timezone ON observations(platform, browser, json_extract(signals_json, '$.screen.width'), json_extract(signals_json, '$.screen.height'), timezone, seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_observation_graphics_timezone ON observations(platform, browser, webgl_renderer, timezone, seen_at DESC);
