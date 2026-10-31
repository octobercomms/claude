-- The subreddits a client's buyers gather in, stored.
--
-- Claude's suggestions were a row of chips that filled a text box and were
-- gone on the next reload, so the first real action on the Reddit screen
-- ("without knowing the subreddit, it's hard to know where to start") cost a
-- Claude call every time anyone wanted to see it again. Stored, they are a
-- table you configure: a focus and a window per row, and a research run
-- against the row rather than against a typed string.
--
-- The unique index on the lowercased name is what makes a second suggest a
-- no-op rather than eight duplicates.

CREATE TABLE IF NOT EXISTS client_subreddits (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  why           TEXT,
  focus         TEXT,
  time_window   TEXT NOT NULL DEFAULT 'month',
  source        TEXT NOT NULL DEFAULT 'manual',
  researched_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_subreddits_unique
  ON client_subreddits (client_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_client_subreddits_client
  ON client_subreddits (client_id, created_at);
