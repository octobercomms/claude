-- Per-user interface preferences. First use is the type scale: a user's
-- overrides of the company default font sizes and weights, as
-- {"--fs-body": 15, "--fw-h1": 800}. Only the tokens the user has changed
-- are stored, so raising the company default still reaches everyone who has
-- not deliberately set that one token.
--
-- JSONB rather than a column per token: there are fifteen tokens today and
-- the set moves with the design system, which would otherwise mean a
-- migration per token.
ALTER TABLE users ADD COLUMN IF NOT EXISTS ui_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
