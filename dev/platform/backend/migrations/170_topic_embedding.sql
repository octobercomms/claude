-- Semantic matching. A journalist's topic profile (beats + coverage topics +
-- article-learned auto_topics + recent headlines) is embedded into a vector so
-- the best-contacts matcher can rank by MEANING, not just shared words —
-- "hotel interiors" matches a "hospitality design" writer even with no word in
-- common. Stored as a plain JSON array of floats (unit-normalised at write time
-- so similarity is a dot product); at the current scale we score in-process, so
-- no pgvector extension is required. embedding_at gates re-embedding to when the
-- profile has actually changed.
ALTER TABLE outreach_contacts
  ADD COLUMN IF NOT EXISTS topic_embedding JSONB,
  ADD COLUMN IF NOT EXISTS embedding_at TIMESTAMPTZ;
