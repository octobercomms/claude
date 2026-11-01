-- Reading a mailbox without a password.
--
-- press@octobercomms.com stopped answering with AUTHENTICATIONFAILED on
-- 25 October. The cause was not a wrong password: Google has withdrawn app
-- passwords from the accounts October uses, so the field this table was built
-- around is a field that can no longer be filled. 3,605 journalists' replies
-- went unread for a week, and because unsubscribe detection lives inside the
-- same poll, their opt-outs went unactioned too.
--
-- So a mailbox now carries one of two kinds of credential. 'password' is the
-- original: an app password, still correct for every host that issues them.
-- 'google_oauth' holds a refresh token granted by the mailbox's own Google
-- account, which the poll exchanges for a short-lived access token and hands
-- to IMAP over XOAUTH2. Nothing about reading, parsing or matching changes;
-- only the two lines that authenticate the socket.

ALTER TABLE outreach_inboxes
  ADD COLUMN IF NOT EXISTS auth_type TEXT NOT NULL DEFAULT 'password',
  -- utils/encryption output, same treatment as password_enc: the refresh
  -- token, the last access token and its expiry, and the granted scope.
  ADD COLUMN IF NOT EXISTS oauth_enc JSONB,
  -- The address Google says the grant belongs to. Kept visible because a
  -- grant for the wrong account authenticates perfectly and reads the wrong
  -- mailbox, which is the one failure mode that looks like success.
  ADD COLUMN IF NOT EXISTS oauth_email TEXT,
  ADD COLUMN IF NOT EXISTS oauth_connected_at TIMESTAMPTZ;

-- An OAuth mailbox has no password to store, and NOT NULL here would force a
-- placeholder that later reads as a real credential.
ALTER TABLE outreach_inboxes ALTER COLUMN password_enc DROP NOT NULL;

-- A password mailbox must carry a password; the column is only nullable for
-- the sake of the other kind. An OAuth mailbox is allowed to exist before its
-- grant arrives, because the mailbox has to be on the list before there is
-- anything to attach a grant to — and a missing grant is not silent: the poll
-- records "has no grant stored. Connect it in Settings" against the row, which
-- is what the mailbox list shows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_inboxes_auth_shape'
  ) THEN
    ALTER TABLE outreach_inboxes ADD CONSTRAINT outreach_inboxes_auth_shape CHECK (
      auth_type = 'google_oauth'
      OR (auth_type = 'password' AND password_enc IS NOT NULL)
    );
  END IF;
END $$;
