-- Phase 14: press-release outreach.
--
-- Extends the existing outreach_press_releases shell with the fields
-- needed to fetch + render a press release from a downloadfor.press
-- URL, store the parsed content, and send a press-flavoured HTML
-- email to journalists.

ALTER TABLE outreach_press_releases
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS dateline VARCHAR(255),
  ADD COLUMN IF NOT EXISTS body_html TEXT,
  ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS contact_block TEXT,
  ADD COLUMN IF NOT EXISTS boilerplate TEXT,
  ADD COLUMN IF NOT EXISTS embargo_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMPTZ;

-- New: per-recipient personalised intro + 3 follow-ups Claude wrote.
-- One row per (press_release, contact). Keeps the Claude output cached
-- so re-opening the preview doesn't re-bill.
CREATE TABLE IF NOT EXISTS press_release_emails (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  press_release_id UUID NOT NULL REFERENCES outreach_press_releases(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES outreach_contacts(id) ON DELETE CASCADE,
  intro TEXT,
  follow_ups JSONB NOT NULL DEFAULT '[]', -- array of { subject, body }
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(press_release_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_press_release_emails_release ON press_release_emails(press_release_id);
