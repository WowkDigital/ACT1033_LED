-- Web admin login: the password hash and the session-signing secret live here (never the password itself).
CREATE TABLE admin_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Failed-login counter per client IP (brute-force lock-out).
CREATE TABLE login_attempts (
  ip           TEXT PRIMARY KEY,
  fails        INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);
