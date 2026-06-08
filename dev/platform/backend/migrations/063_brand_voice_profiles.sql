-- Brand voice profile — Claude-extracted structured analysis of a
-- client's existing best-performing content. AM supplies 3–10 URLs of
-- pages that read 'like the brand'; the service crawls them, extracts
-- text, asks Claude to surface tone, sentence structure, vocabulary
-- patterns, reading level, do/don't examples.
--
-- One active profile per client (UNIQUE). Re-running creates a new
-- row and marks the previous one inactive, so historical profiles are
-- retained for audit. Both the cluster brief generator and the full-
-- post drafter read the active profile and inject its structured
-- fields into their Claude prompts.

CREATE TABLE IF NOT EXISTS brand_voice_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(20) NOT NULL DEFAULT 'running',  -- running | complete | failed
  source_urls JSONB NOT NULL DEFAULT '[]',        -- URLs the analysis was based on
  -- Structured Claude output
  voice_summary TEXT,                             -- 2-3 sentence narrative
  tone_descriptors JSONB,                         -- ["confident", "no-nonsense", "warm"]
  reading_level VARCHAR(20),                      -- "Grade 8" / "Grade 12" / etc
  avg_sentence_length_words INT,
  avg_paragraph_length_sentences INT,
  vocabulary_patterns JSONB,                      -- ["uses British spellings", "prefers active verbs"]
  signature_phrases JSONB,                        -- phrases the brand favours
  avoid_phrases JSONB,                            -- phrases the brand never uses
  do_examples JSONB,                              -- short example sentences to imitate
  dont_examples JSONB,                            -- short example sentences to avoid
  -- Bookkeeping
  claude_model VARCHAR(64),
  tokens_used INT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_brand_voice_profiles_client
  ON brand_voice_profiles(client_id, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_brand_voice_profiles_active
  ON brand_voice_profiles(client_id)
  WHERE active = TRUE;
