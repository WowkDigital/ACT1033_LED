-- mpk_state: what the stored countdown GIF was generated from (departure times, generation time) so the cron job can decide
--            whether a regeneration is needed. fresh_at: last automatic regeneration (drives a short fast-poll window).
ALTER TABLE panels ADD COLUMN mpk_state TEXT;
ALTER TABLE panels ADD COLUMN fresh_at INTEGER;
