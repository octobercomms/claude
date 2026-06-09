-- Press-release authoring + sign-off (native to the PR module). Write a release
-- from a brief, have Claude draft the body, then send a token-gated approval
-- link the client can sign off without logging in. Distinct from the
-- outreach_press_releases distribution table — this is the authoring/sign-off
-- stage that precedes pitching journalists.

CREATE TABLE IF NOT EXISTS pr_press_releases (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title         VARCHAR(500) NOT NULL DEFAULT '',
  brand         VARCHAR(120) NOT NULL DEFAULT '',
  angle         TEXT NOT NULL DEFAULT '',
  key_facts     TEXT NOT NULL DEFAULT '',
  body_html     TEXT NOT NULL DEFAULT '',
  status        VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft / in_review / approved / sent
  review_token  TEXT UNIQUE,
  approved_at   TIMESTAMPTZ,
  approved_by   VARCHAR(200) NOT NULL DEFAULT '',
  embargo_at    TIMESTAMPTZ,
  url           VARCHAR(1000) NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pr_press_releases_client_idx ON pr_press_releases (client_id);
CREATE INDEX IF NOT EXISTS pr_press_releases_token_idx ON pr_press_releases (review_token);

CREATE TRIGGER update_pr_press_releases_updated_at BEFORE UPDATE ON pr_press_releases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
