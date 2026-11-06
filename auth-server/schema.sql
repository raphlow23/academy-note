-- This database contains authentication only. No student/payment/booking data.
CREATE TABLE IF NOT EXISTS oauth_attempts (
 state_hash TEXT PRIMARY KEY, challenge TEXT NOT NULL, verifier_cipher TEXT NOT NULL,
 return_to TEXT NOT NULL, ip_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_rate ON oauth_attempts(ip_hash,created_at);
CREATE TABLE IF NOT EXISTS auth_accounts (
 sub TEXT PRIMARY KEY, email TEXT NOT NULL, refresh_cipher TEXT NOT NULL,
 access_cipher TEXT NOT NULL, access_expires INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_handoffs (
 code_hash TEXT PRIMARY KEY, state_hash TEXT NOT NULL, challenge TEXT NOT NULL,
 sub TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
 session_hash TEXT PRIMARY KEY, sub TEXT NOT NULL, created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_account ON auth_sessions(sub);

CREATE TABLE IF NOT EXISTS auth_code_limits(bucket_key TEXT PRIMARY KEY,n INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS code_limits_expiry ON auth_code_limits(expires_at);
