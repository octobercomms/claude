-- Per-recipient STOP flag for a campaign (the Mautic pattern). When an AM marks
-- a journalist "stop follow-ups" for a campaign (e.g. they replied "not for
-- me"), we set stopped_at on their campaign membership. The send loop checks it
-- before EVERY send, so it durably blocks all remaining follow-ups — including
-- any that get re-queued later — without unsubscribing them from the client.
-- Reversible: clearing stopped_at puts them back in the sequence.
ALTER TABLE outreach_campaign_contacts
  ADD COLUMN IF NOT EXISTS stopped_at TIMESTAMPTZ;
