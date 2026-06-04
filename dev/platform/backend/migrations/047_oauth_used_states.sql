-- One-time-use store for OAuth state tokens. Without this, a captured
-- state signature can be replayed within its 30-minute window — combined
-- with a fresh authorisation code from the provider, that's a path to
-- approving a connector flow against the wrong client. Rows are inserted
-- when a callback verifies; a second callback with the same state hash
-- gets rejected. Cleanup cron in scheduler.js purges rows older than 1h
-- (well past the 30-min state lifetime) so the table stays tiny.
CREATE TABLE IF NOT EXISTS oauth_used_states (
  state_hash CHAR(64) PRIMARY KEY,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_used_states_used_at
  ON oauth_used_states(used_at);
