-- Client self-onboarding by email. An admin invites a client by email; the
-- client gets a one-time link to set their own password. We reuse the users
-- table: username = email, an unusable random password_hash until they set one,
-- and a one-time invite_token with an expiry.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email             TEXT,
  ADD COLUMN IF NOT EXISTS invite_token       TEXT,
  ADD COLUMN IF NOT EXISTS invite_expires_at  TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_invite_token ON users (invite_token) WHERE invite_token IS NOT NULL;
