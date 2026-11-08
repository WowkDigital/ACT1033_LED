-- One row per panel. Tokens are never stored, only their SHA-256 hashes (tokens are 256-bit random values).
-- The current image lives in the same row (one write per update; unchanged uploads are skipped).
CREATE TABLE panels (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  write_hash   TEXT NOT NULL,
  read_hash    TEXT NOT NULL,
  image        BLOB,
  content_type TEXT,
  etag         TEXT,
  size         INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER
);
CREATE INDEX panels_write_hash ON panels (write_hash);
CREATE INDEX panels_read_hash ON panels (read_hash);
