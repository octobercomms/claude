-- Process Rails — per-client manual completion overrides for the stepped
-- process navigation (see docs/omi/process-rails-plan.md). Status is
-- derived-first from real data; this table only stores manual "mark done"
-- overrides for steps that have no data signal to derive from.

CREATE TABLE IF NOT EXISTS client_suite_progress (
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  suite      VARCHAR(48) NOT NULL,   -- e.g. 'paid_advise'
  step_key   VARCHAR(48) NOT NULL,   -- e.g. 'competitors'
  done       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, suite, step_key)
);
