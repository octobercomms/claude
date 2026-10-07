-- Multiple audiences per press release.
--
-- One release, several named audiences (Workplace, Retail, Residential…), each
-- built from an uploaded list plus tags, each with its own subject lines, intro
-- and follow-ups. The release body and hero image stay shared, because it is
-- one press release.
--
-- Two deliberate choices about where things live.
--
-- 1. MEMBERSHIP IS THE DEDUPE. The audience a contact belongs to goes on
--    outreach_campaign_contacts, whose primary key is already
--    (campaign_id, contact_id). So a contact cannot be in two audiences on one
--    release — not because a screen checks, but because the row cannot exist
--    twice. Overlap is therefore resolved when a list is added (move them, or
--    leave them where they are), and a locked audience cannot quietly double up
--    later. A journalist receiving two different pitches for the same release,
--    24h apart because the frequency cap delays rather than drops the second,
--    is worse than receiving a duplicate; this makes it unrepresentable.
--
-- 2. THE COPY LIVES ON THE AUDIENCE, NOT ON NEW SEQUENCE ROWS. The obvious
--    design is outreach_sequences.segment_id, one sequence set per audience.
--    It is the wrong one here: that table has 46 call sites, 20 of them in the
--    cold-email system, which has nothing to do with press audiences, and the
--    send queue cross-joins every campaign sequence to every contact — so
--    per-audience sequences would hand a contact every audience's emails unless
--    all 46 are audited. Instead outreach_sequences stays exactly as it is: the
--    shared skeleton (how many emails, how many days apart, the default
--    subject). Each audience overlays its own copy at render time. The queue
--    keeps producing exactly one send per (contact × step), and the cold-email
--    sequence editor is untouched.
--
--    The cost of that choice: follow-up delays are shared across audiences.
--    Audiences are sent separately, and delays run from each send, so staggering
--    still works at the audience level.

CREATE TABLE IF NOT EXISTS outreach_campaign_segments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id   UUID NOT NULL REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  -- Display and send order in the UI.
  position      INT  NOT NULL DEFAULT 0,
  -- The tags this audience was built from. Provenance, not a live filter: once
  -- locked, membership is the rows in outreach_campaign_contacts, so retagging
  -- a journalist afterwards never moves them between audiences mid-release.
  tags          TEXT[] NOT NULL DEFAULT '{}',
  -- Set when the operator locks the audience: membership is then a snapshot and
  -- the copy can be written against a known list.
  locked_at     TIMESTAMPTZ,
  -- First send. After this the audience is frozen: no membership or copy edits,
  -- because some of these people have already had the email.
  sent_at       TIMESTAMPTZ,
  -- This audience's copy. NULL means fall back to the release-level copy, so an
  -- audience you have not tailored still sends the shared pitch.
  --   subjects: { "1": "…", "2": "…" } keyed by step_number, overriding the
  --             subject on the shared outreach_sequences row for that step.
  --   intro:    the first email's body for everyone in this audience.
  --   followups: [{ subject, body }, …] in step order from step 2.
  subjects      JSONB,
  intro         TEXT,
  followups     JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_segments_campaign
  ON outreach_campaign_segments(campaign_id, position);

-- Two audiences on one release may not share a name: the operator picks an
-- audience by name in the UI and in the dedupe prompt, so an ambiguous one is
-- a trap.
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_segments_name
  ON outreach_campaign_segments(campaign_id, lower(name));

-- Membership. NULL = attached to the campaign but in no audience, which is
-- every existing campaign and stays valid: such a contact sends the
-- release-level copy exactly as before.
ALTER TABLE outreach_campaign_contacts
  ADD COLUMN IF NOT EXISTS segment_id UUID
  REFERENCES outreach_campaign_segments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_contacts_segment
  ON outreach_campaign_contacts(segment_id);
