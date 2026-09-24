-- Per-task AI budgets.
--
-- Until now the only spend control was AI_MONTHLY_HARD_CAP_USD: one global
-- cap checked inside callClaude. That has two holes.
--
--   1. One runaway background job consumes the whole allowance, and every
--      other AI feature in OMI stops with it — chat, report narratives,
--      press pitches. A cap meant as a backstop becomes an outage.
--   2. The media researchers (journalistScout, pressMediaResearch,
--      prospecting/research) call the Anthropic SDK directly, because they
--      need the web_search tool that callClaude does not expose. They record
--      their spend but never check the cap, so the features most likely to
--      run away are the ones the cap does not cover.
--
-- This table fixes the first. A task is a named group of cost-log features
-- with its own monthly allowance. When a task reaches its cap it stops and
-- nothing else is affected; the next calendar month it resumes on its own,
-- because spend is always measured from date_trunc('month', now()).
--
-- The global cap stays as the outer wall. A task cap can only ever be
-- smaller than the global one in effect, so background work can never
-- starve interactive work.

CREATE TABLE IF NOT EXISTS ai_task_budgets (
  task             VARCHAR(60) PRIMARY KEY,
  label            TEXT        NOT NULL,
  -- Cost-log feature labels this task pays for. Matched against
  -- api_cost_events.feature, so a task spans several features and a feature
  -- belongs to at most one task (enforced in code, not by a constraint —
  -- overlapping tasks would double-count).
  features         TEXT[]      NOT NULL,
  -- NULL = no cap, run freely. A number = stop at that many dollars of
  -- month-to-date spend across `features`.
  monthly_cap_usd  NUMERIC(10, 2),
  -- FALSE pauses the task outright, whatever the cap says. This is the
  -- switch to use when you want work to stop now rather than at a number.
  enabled          BOOLEAN     NOT NULL DEFAULT TRUE,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seeded off, with no cap set. Nothing changes until an operator sets a
-- number in Settings → AI models → Task budgets. Seeding the rows rather
-- than creating them on first use means the Settings screen has something
-- to show on day one, and the feature lists live in one reviewable place.
INSERT INTO ai_task_budgets (task, label, features, monthly_cap_usd, note) VALUES
  ('media_research',
   'Media database research',
   ARRAY['media_db_research', 'press_beat_learn', 'press_byline_mining', 'press_outlet_resolve', 'contact_tidy'],
   NULL,
   'Finding new journalists, keeping existing contacts current, and filling in outlet and contact location. Runs in the background and is the one task most likely to run away, so give it a number.'),
  ('prospecting',
   'New business prospecting',
   ARRAY['outreach_research', 'snapshot_draft', 'snapshot_refine', 'lead_scoring', 'lead_scrape', 'hunter_domain_search', 'hunter_verify_email'],
   NULL,
   'Researching inbound leads and prospects for the biz dev pipeline.'),
  ('press_outreach',
   'Press pitches and follow-ups',
   ARRAY['press_pitch', 'press_followups', 'press_match', 'press_match_embed', 'press_audience'],
   NULL,
   'Per-recipient pitch writing. Scales with how much you send, so a cap here stops a large release mid-send. Usually better left uncapped.')
ON CONFLICT (task) DO NOTHING;
