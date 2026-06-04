-- Lightweight in-house error log. Process crashes (unhandledRejection,
-- uncaughtException) and frontend ErrorBoundary catches both land here
-- so we have a forensic trail without depending on Sentry / Datadog /
-- etc. A daily digest cron rolls up the last 24h and emails it; rows
-- older than 30 days get pruned.
--
-- fingerprint groups duplicate errors so a single broken endpoint that
-- fires 5,000 times doesn't bury the actual long-tail of one-offs.

CREATE TABLE IF NOT EXISTS error_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source VARCHAR(40) NOT NULL,           -- 'backend' | 'frontend' | 'cron' | 'webhook'
  fingerprint VARCHAR(64) NOT NULL,      -- sha256 of (message + first stack frame)
  message TEXT NOT NULL,
  stack TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,   -- url, user_id, route, etc.
  user_agent TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_log_occurred_at ON error_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_fingerprint ON error_log(fingerprint, occurred_at DESC);
