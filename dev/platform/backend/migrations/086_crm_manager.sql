-- CRM Manager — weekly autopilot that does the high-confidence pile of contact
-- maintenance without nagging the AM, queues fuzzier work for review, and
-- writes a digest row the dashboard can show.
--
-- One row per run; the JSONB columns are intentionally append-only summaries
-- (counts + ids of what was touched) so the digest can render and the AM can
-- spot-check what happened. The undo flow leans on outreach_contacts.merged_into
-- + outreach_contact_audit which already record the before-state — no extra
-- snapshot table needed.

CREATE TABLE IF NOT EXISTS crm_manager_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  status          VARCHAR(20) NOT NULL DEFAULT 'running',  -- running | done | failed
  trigger         VARCHAR(20) NOT NULL DEFAULT 'cron',     -- cron | manual
  merged_count    INT NOT NULL DEFAULT 0,
  tidied_count    INT NOT NULL DEFAULT 0,
  queued_dupes    INT NOT NULL DEFAULT 0,
  queued_tidies   INT NOT NULL DEFAULT 0,
  merged_ids      JSONB NOT NULL DEFAULT '[]',  -- [{loser, canonical}] — backs undo
  tidied_audit_ids JSONB NOT NULL DEFAULT '[]', -- outreach_contact_audit row ids — backs undo
  error           TEXT
);
CREATE INDEX IF NOT EXISTS crm_manager_runs_started_idx ON crm_manager_runs (started_at DESC);

-- Settings table for the autopilot kill switch + per-action toggles. Single
-- row, identified by id='global'. Defaults are intentionally conservative:
-- autopilot ON, merges ON, tidies ON — but the AM can flip any of them at
-- any time from Settings.
CREATE TABLE IF NOT EXISTS crm_manager_settings (
  id              VARCHAR(20) PRIMARY KEY DEFAULT 'global',
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  auto_merge      BOOLEAN NOT NULL DEFAULT TRUE,
  auto_tidy       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO crm_manager_settings (id) VALUES ('global') ON CONFLICT (id) DO NOTHING;
