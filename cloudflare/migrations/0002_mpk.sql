-- manual_at: last change made by a person (drives the fast "burst" polling); automatic updates only touch updated_at.
-- mpk / mpk_enabled: per-panel public-transit departures job run by the Worker's cron trigger.
ALTER TABLE panels ADD COLUMN manual_at INTEGER;
ALTER TABLE panels ADD COLUMN mpk TEXT;
ALTER TABLE panels ADD COLUMN mpk_enabled INTEGER NOT NULL DEFAULT 0;
UPDATE panels SET manual_at = updated_at;
