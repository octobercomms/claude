-- Methods become data.
--
-- Until now the offer lived in a const in proposals.js: two tiers of one
-- product called the Earned Reach Method, priced in one currency, with the
-- GoCardless link read from an env var per tier. Daniel sells two methods
-- (Serious Buyer for lead generation, Earning Visibility for awareness, the
-- latter at two levels), in three currencies at fixed prices rather than
-- converted ones, and he wants to add and rename them without a deploy.
--
-- The bigger change is what a method now carries. The method defines the
-- objectives, the KPIs, the strategy and the tactics, so those stop being
-- generated per prospect and start being the product. Four blocks are still
-- written for the prospect (letter, situation, priority, covering email); the
-- rest is this table. That makes the proposal read the same way every time,
-- which is what makes it a method rather than bespoke consulting, and it means
-- improving the copy once improves every future proposal.
--
-- Prices and GoCardless links are JSONB keyed by currency code rather than
-- columns, so adding a fourth currency is data entry and not a migration.

CREATE TABLE IF NOT EXISTS proposal_methods (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug        TEXT NOT NULL UNIQUE,              -- stable key; what accepted_package stores
  name        TEXT NOT NULL,                     -- "Earning Visibility · Advanced"
  family      TEXT,                              -- "Earning Visibility Method" — groups the levels
  blurb       TEXT,                              -- the reassurance line under the price
  sort_order  INT NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,

  -- { "GBP": { "monthly": 2500, "setup": 0, "gocardless_url": "https://..." }, "USD": {...}, "EUR": {...} }
  prices      JSONB NOT NULL DEFAULT '{}',
  includes    JSONB NOT NULL DEFAULT '[]',       -- ["Quarterly visibility audit", ...]

  -- The fixed content this method supplies to every proposal that uses it.
  objectives  JSONB NOT NULL DEFAULT '{}',       -- { short, mid, long }
  kpis        JSONB NOT NULL DEFAULT '{}',       -- { committed: [string], reported: [string], close: string }
  strategy    JSONB NOT NULL DEFAULT '[]',       -- [{ title, text }]
  tactics     JSONB NOT NULL DEFAULT '[]',       -- [{ heading, items: [string] }]
  stages      JSONB NOT NULL DEFAULT '[]',       -- [{ stage, when, title, text }] — the "how we work" block

  -- Bumped whenever the content above changes, so a sent proposal can say which
  -- version of the method it was sent under. The proposal also keeps its own
  -- full snapshot (see 206), which is what actually guarantees an old proposal
  -- still reads as it was sent; this is for the label.
  version     INT NOT NULL DEFAULT 1,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS proposal_methods_active_idx ON proposal_methods (active, sort_order);

-- Seed the two packages that were hardcoded, so nothing in flight breaks and
-- there is something real to edit rather than an empty form. Prices carry the
-- old GBP figures; USD and EUR are left empty on purpose, because Daniel is
-- still working them out and an invented number in a document that becomes a
-- contract when it is signed is worse than a blank the UI can flag.
INSERT INTO proposal_methods (slug, name, family, blurb, sort_order, prices, includes, stages)
VALUES
  ('advanced', 'Earning Visibility · Advanced', 'Earning Visibility Method',
   'This is the level most practices at your stage take, because the press offer only works once there is something published to offer.',
   1,
   '{"GBP": {"monthly": 2500, "setup": 0}}',
   '["Everything in Basic", "Two initiatives running concurrently", "Priority press pitching", "Plan of work reviewed and adjusted monthly", "Direct line for in-quarter changes"]',
   '[{"stage": "01", "when": "month one", "title": "the audit", "text": "We check where the practice is visible right now across search, AI answers, press and referral networks, rather than assuming. This sets the baseline every quarter is measured against."},
     {"stage": "02", "when": "month two", "title": "the priority", "text": "The audit points to one lever that matters most right now. That becomes the plan of work, delivered in writing before the quarter starts, and it gets full attention."},
     {"stage": "03", "when": "month three", "title": "the review", "text": "Reported against the gap named in month one. What worked continues, what did not gets replaced by the next priority, and the cycle repeats, compounding each quarter."}]'),
  ('basic', 'Earning Visibility · Basic', 'Earning Visibility Method',
   'The careful option: one initiative at a time, same method, same reporting.',
   2,
   '{"GBP": {"monthly": 1800, "setup": 0}}',
   '["Quarterly visibility audit", "One initiative in focus (PR, SEO or content)", "Written plan of work each quarter", "Monitoring, tracking and maintenance", "Quarterly reporting on citations and recognition"]',
   '[{"stage": "01", "when": "month one", "title": "the audit", "text": "We check where the practice is visible right now across search, AI answers, press and referral networks, rather than assuming. This sets the baseline every quarter is measured against."},
     {"stage": "02", "when": "month two", "title": "the priority", "text": "The audit points to one lever that matters most right now. That becomes the plan of work, delivered in writing before the quarter starts, and it gets full attention."},
     {"stage": "03", "when": "month three", "title": "the review", "text": "Reported against the gap named in month one. What worked continues, what did not gets replaced by the next priority, and the cycle repeats, compounding each quarter."}]')
ON CONFLICT (slug) DO NOTHING;
