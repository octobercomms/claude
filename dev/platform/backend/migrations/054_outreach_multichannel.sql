-- Phase 2: multichannel sequences (overloop parity).
-- The sequence engine grows beyond email-only steps. Each step now
-- declares its channel (email, linkedin_*, manual_task) and a
-- step_type controlling how the sender / AM-task queue executes it.
-- A per-prospect state machine sits on top so cross-channel events —
-- a LinkedIn reply, a manual task completion — can short-circuit the
-- email cadence, the way overloop handles it.

-- ── Sequence step types ──────────────────────────────────────────────────
-- channel values:
--   email             - existing behaviour, sender delivers via SES/SMTP
--   linkedin_visit    - assign a task: "visit Jane's profile"
--   linkedin_connect  - assign a task: "send connection request"
--   linkedin_message  - assign a task: "send message" (or auto via
--                       the LinkedIn connector when wired)
--   manual_task       - free-form AM task ("call Jane")
--
-- step_type stays at 'send' for now; reserved so future patches can
-- add 'wait_until', 'branch', etc. without a schema migration.
ALTER TABLE outreach_sequences
  ADD COLUMN IF NOT EXISTS channel   VARCHAR(40) NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS step_type VARCHAR(40) NOT NULL DEFAULT 'send';

CREATE INDEX IF NOT EXISTS idx_outreach_sequences_channel
  ON outreach_sequences(channel);

-- ── Per-prospect state machine ───────────────────────────────────────────
-- One row per (campaign, contact) tracks where the prospect is in the
-- sequence and what has happened to them across all channels. The
-- sender reads this before scheduling the next step; the reply
-- classifier writes to this when a reply / connection / DM lands.
--
-- state taxonomy:
--   enrolled      - active in the cadence
--   replied       - reply on any channel; sequence paused
--   bounced       - hard bounce; sequence ended
--   unsubscribed  - opted out; sequence ended
--   completed     - finished every step
--   paused        - manually paused by the AM
CREATE TABLE IF NOT EXISTS outreach_prospect_state (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id         UUID NOT NULL REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
  contact_id          UUID NOT NULL REFERENCES outreach_contacts(id) ON DELETE CASCADE,
  current_step        INTEGER NOT NULL DEFAULT 1,
  state               VARCHAR(40) NOT NULL DEFAULT 'enrolled',
  last_channel_event  VARCHAR(40),
  last_event_at       TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_prospect_state_campaign
  ON outreach_prospect_state(campaign_id, state);

CREATE INDEX IF NOT EXISTS idx_prospect_state_contact
  ON outreach_prospect_state(contact_id);

-- ── Manual task queue (LinkedIn + free-form) ─────────────────────────────
-- Steps with a non-email channel land here as a row in the AM's
-- daily queue. Once the AM marks the row done, the per-prospect state
-- advances to the next step exactly as if an email had been sent.
CREATE TABLE IF NOT EXISTS outreach_tasks (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id    UUID NOT NULL REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
  contact_id     UUID NOT NULL REFERENCES outreach_contacts(id) ON DELETE CASCADE,
  sequence_id   UUID REFERENCES outreach_sequences(id) ON DELETE SET NULL,
  channel        VARCHAR(40) NOT NULL,
  task_type      VARCHAR(40) NOT NULL,
  prompt         TEXT,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending',
  assigned_to    UUID REFERENCES users(id) ON DELETE SET NULL,
  due_at         TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  completed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outreach_tasks_pending
  ON outreach_tasks(assigned_to, status, due_at);

CREATE INDEX IF NOT EXISTS idx_outreach_tasks_campaign
  ON outreach_tasks(campaign_id, status);
