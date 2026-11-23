-- Hold a generated report for review before it reaches the client.
--
-- generateReport has always called sendReport itself, so a scheduled report
-- was written, rendered and delivered in one pass with no point at which
-- anybody could read it. For a client whose numbers need a sentence of context
-- ("traffic dipped because the Meta account was paused for a week"), the only
-- options were to let it go out bare or to turn scheduling off.
--
-- Per client rather than global, because the judgement differs: a long-standing
-- client on a steady retainer can have reports go straight out, and a new one,
-- or one mid-crisis, should not.
--
-- Defaults to false, so nothing changes for any existing client until somebody
-- turns it on.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS review_before_send BOOLEAN NOT NULL DEFAULT FALSE;

-- The status a held report sits in is the existing 'generated'. It already
-- means "rendered, not delivered", which is exactly the state wanted, so no
-- new enum value: a second status meaning the same thing would be a second
-- place for the Reports page and the resend route to disagree about what is
-- safe to send.
COMMENT ON COLUMN clients.review_before_send IS
  'When true, a generated report stops at status=generated and the reviewer is emailed instead of the client.';
