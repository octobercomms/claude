-- A journalist suggestion may have no confirmed email. We guess one from the
-- pattern other contacts at the same outlet use (first.last@domain, etc.) and
-- store it separately so the UI can show it in red as UNCONFIRMED — never
-- conflated with a real, found address.
ALTER TABLE pr_journalist_suggestions
  ADD COLUMN IF NOT EXISTS guessed_email TEXT;
