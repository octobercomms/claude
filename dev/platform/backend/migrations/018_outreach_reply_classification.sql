-- Outreach pass 4: reply classification + sending domain config.
--
-- When the IMAP poller picks up a reply, Claude classifies it
-- (interested / not_now / not_relevant / unsubscribe / auto_reply /
-- question) and writes a one-sentence summary. Replies that look like
-- unsubscribe / do_not_contact set the contact's status accordingly,
-- which the sender already uses to suppress future sends.

ALTER TABLE outreach_sends
  ADD COLUMN IF NOT EXISTS reply_text TEXT,
  ADD COLUMN IF NOT EXISTS reply_classification VARCHAR(40),
  ADD COLUMN IF NOT EXISTS reply_summary TEXT;
