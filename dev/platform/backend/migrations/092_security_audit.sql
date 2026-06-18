-- Security audit runs — backs the Settings → Security checklist. A daily cron
-- (and the "Run now" button) executes a battery of automated checks against the
-- running config + codebase and stores one row per run, so the dashboard can
-- show that every area was checked, when, and which items need attention.
-- See services/securityAudit.js.

CREATE TABLE IF NOT EXISTS security_audit_runs (
  id          SERIAL PRIMARY KEY,
  risk        TEXT NOT NULL,                 -- clean | hardening | action_needed
  pass_count  INTEGER NOT NULL DEFAULT 0,
  warn_count  INTEGER NOT NULL DEFAULT 0,
  fail_count  INTEGER NOT NULL DEFAULT 0,
  findings    JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{id, area, title, severity, status, detail, recommendation}]
  trigger     TEXT NOT NULL DEFAULT 'cron',  -- cron | manual
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_runs_created ON security_audit_runs (created_at DESC);
