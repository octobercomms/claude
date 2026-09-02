-- Beat intelligence: what a journalist ACTUALLY writes about, learned nightly
-- from the real articles the RSS pipeline attributes to them (pr_outlet_articles),
-- not just the handful of stories we've logged as coverage.
--
-- Kept in its OWN lane so it never clobbers human curation: `beats` stays the
-- hand-set / coverage-derived tags, `auto_topics` is the article-learned view.
-- The press-release matcher reads both. auto_topics_at also gates the learner —
-- we only re-read a journalist when new bylines have landed since last time,
-- so nightly cost tracks new activity, not database size.
ALTER TABLE outreach_contacts
  ADD COLUMN IF NOT EXISTS auto_topics JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS auto_topics_at TIMESTAMPTZ;
