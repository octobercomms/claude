-- Phase 1 of the snov.io/overloop catch-up: email verification + per-client
-- multi-mailbox rotation. Both are pre-requisites for safe, scalable cold
-- outreach — verifying before send keeps the sender domain's reputation
-- intact, and rotating across N warmed mailboxes prevents any single
-- inbox from hitting daily provider limits.

-- ── Verification on every contact ────────────────────────────────────────
-- Verification status taxonomy:
--   pending     - never been checked
--   valid       - smtp + mx + syntax + role + catch-all all ok
--   risky       - smtp ok but catch-all / role-based: deliverable but flagged
--   invalid     - bounced syntax / no MX / hard 550 / disposable / typo
--   unknown     - verifier returned no signal (rate-limited, transient err)
-- score is 0..100 if the provider returns a confidence number; null otherwise
-- A NULL last_verified_at is the trigger for the pre-send re-check below.
ALTER TABLE outreach_contacts
  ADD COLUMN IF NOT EXISTS verification_status   VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verification_score    INTEGER,
  ADD COLUMN IF NOT EXISTS verification_provider VARCHAR(40),
  ADD COLUMN IF NOT EXISTS verification_detail   JSONB,
  ADD COLUMN IF NOT EXISTS last_verified_at      TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_outreach_contacts_verification
  ON outreach_contacts(verification_status);

-- ── Per-client mailboxes ─────────────────────────────────────────────────
-- A client can have N senders. Sender = a from-address with a daily cap
-- and a warm-up status. The sender service walks them round-robin and
-- skips any that have hit their cap or are in warm-up cooldown.
--
-- warm_up_status taxonomy:
--   cold     - new mailbox, low cap, climbs to target over warmup_days
--   warming  - in the ramp, cap < target_daily_cap
--   warm     - hit target_daily_cap, full throughput
--   paused   - manually paused, skip in rotation
--   error    - SMTP creds failing, skip until fixed
--
-- daily_sent_count + day_started_at let the sender enforce caps without
-- a full table scan over outreach_sends — reset to 0 when day_started_at
-- is more than 24h ago.
CREATE TABLE IF NOT EXISTS outreach_mailboxes (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  from_name           VARCHAR(255) NOT NULL,
  from_email          VARCHAR(320) NOT NULL,
  reply_to            VARCHAR(320),
  smtp_host           VARCHAR(255),
  smtp_port           INTEGER,
  smtp_username       VARCHAR(255),
  smtp_password_enc   TEXT,
  daily_cap           INTEGER NOT NULL DEFAULT 50,
  target_daily_cap    INTEGER NOT NULL DEFAULT 50,
  warm_up_status      VARCHAR(20) NOT NULL DEFAULT 'warm',
  warmup_days         INTEGER NOT NULL DEFAULT 0,
  warmup_started_at   TIMESTAMPTZ,
  daily_sent_count    INTEGER NOT NULL DEFAULT 0,
  day_started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at        TIMESTAMPTZ,
  error_message       TEXT,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, from_email)
);

CREATE INDEX IF NOT EXISTS idx_outreach_mailboxes_client
  ON outreach_mailboxes(client_id, active);

-- Track which mailbox actually sent each message so we can debug
-- deliverability problems by mailbox.
ALTER TABLE outreach_sends
  ADD COLUMN IF NOT EXISTS mailbox_id UUID REFERENCES outreach_mailboxes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_outreach_sends_mailbox
  ON outreach_sends(mailbox_id);
