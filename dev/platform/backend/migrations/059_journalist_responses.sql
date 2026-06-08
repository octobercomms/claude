-- Journalist responses — Featured / Qwoted / SourceOfSources queries the
-- AM responds to in the client's voice. The Promote step in the Organic
-- Pipeline calls this earned-link tactic "digital PR" — every accepted
-- response becomes a natural backlink from a real news outlet.
--
-- No public API exists for these platforms, so the workflow is paste-
-- and-draft: AM pastes a query, Claude writes a response grounded in
-- the brand briefing + assets, AM edits and sends from their own
-- inbox. We just track the queries + drafts + outcomes per client.

CREATE TABLE IF NOT EXISTS journalist_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source VARCHAR(32) NOT NULL DEFAULT 'manual',  -- featured | qwoted | sos | manual | other
  query_text TEXT NOT NULL,
  journalist_name VARCHAR(255),
  outlet VARCHAR(255),
  deadline TIMESTAMPTZ,
  response_md TEXT,                              -- Claude-drafted response, AM-editable
  status VARCHAR(20) NOT NULL DEFAULT 'draft',   -- draft | sent | won | rejected | skipped
  external_url TEXT,                             -- if the response was published, the live article URL
  notes TEXT,
  claude_model VARCHAR(64),
  tokens_used INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journalist_responses_client
  ON journalist_responses(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_journalist_responses_deadline
  ON journalist_responses(deadline)
  WHERE status = 'draft' AND deadline IS NOT NULL;
