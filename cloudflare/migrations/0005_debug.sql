-- Debug telemetry. last_seen_*: the last time the ESP asked for the image (written at most every 10 s per status).
-- panel_events: small per-panel ring buffer (pruned to the newest 200 rows) of meaningful events only (not every 304).
ALTER TABLE panels ADD COLUMN last_seen_at INTEGER;
ALTER TABLE panels ADD COLUMN last_seen_status INTEGER;
ALTER TABLE panels ADD COLUMN last_seen_ua TEXT;
CREATE TABLE panel_events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  panel_id TEXT NOT NULL,
  at       INTEGER NOT NULL,
  kind     TEXT NOT NULL,
  detail   TEXT
);
CREATE INDEX panel_events_panel ON panel_events (panel_id, id);
