-- Replace Mautic's segments + named lists with a single tag mechanism.
-- A journalist tagged ["topic-fashion", "target-lolo", "uk"] shows up in
-- every relevant view; no per-segment tables, no list/contact joins.
--
-- Unsubscribe — keep using outreach_contacts.status='unsubscribed' as
-- the source of truth (already set by the reply classifier today).
-- This migration just adds the timestamp so we can surface "when did
-- this person unsubscribe and which campaign was it from" later.

ALTER TABLE outreach_contacts
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ;

-- GIN index for fast `tags && ARRAY['…']` membership queries.
CREATE INDEX IF NOT EXISTS idx_outreach_contacts_tags ON outreach_contacts USING GIN (tags);
