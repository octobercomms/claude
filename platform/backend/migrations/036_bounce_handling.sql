-- Hard bounce + complaint suppression. When SES (or a sync send) tells
-- us the recipient address is dead, mark the contact globally so no
-- client's future campaign drops fresh sends into the queue for them.
-- bounced_at + bounce_reason are global on the contact (a dead address
-- is dead for every client); per-client unsubscribe stays on the
-- membership row.

ALTER TABLE outreach_contacts
  ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bounce_reason TEXT;

-- Provider message ID lets us map an async SES bounce notification
-- back to the originating send row, which then identifies the contact.
ALTER TABLE outreach_sends
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_outreach_sends_pmid
  ON outreach_sends(provider_message_id)
  WHERE provider_message_id IS NOT NULL;
