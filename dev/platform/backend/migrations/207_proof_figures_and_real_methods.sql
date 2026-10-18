-- The proof October actually has, and the rule about not overclaiming it.
--
-- Everything here comes from the October site redesign canvas, which carries a
-- stronger and better-disciplined proof library than OMI held. Three things
-- were missing, and the third is the important one.
--
-- 1. The counted record. "22 countries", "216 pieces of published coverage,
--    March 2023 to April 2026", each with its source named. These are the best
--    proof October has, because they are checkable and nobody else in the
--    sector publishes them, and none of them were in proof_items. A figure with
--    a cited source reads as a fact; the same claim in a sentence reads as
--    marketing, so proof_items gains `figure` and `source` columns and the
--    proposal renders the number large with the source under it.
--
-- 2. Named coverage. Two real pieces with outlet, project, client and date.
--    proof_items supports kind 'press' and held none.
--
-- 3. The evidence rule, which the redesign states in plain words on the Serious
--    Buyer page: "No outcome claims until a client has run the method." That is
--    a decision about honesty, and leaving it as something to remember means the
--    engine will eventually break it, because matchProof's job is to find the
--    most persuasive proof available and a case study from a different service
--    scores well. So it becomes a column on the method, and both the proof
--    matcher and the writing prompt read it.
--
-- The prices are also corrected, from the redesign's own pricing table rather
-- than from anywhere else: Earning Visibility basic £1,345, advanced £1,870
-- (carrying the "Most popular" badge), Serious Buyer £1,140. 205 seeded £2,500
-- and £1,800 from the constant in proposals.js, which predates the current
-- offer. USD and EUR stay empty because the pricing page still reads
-- "[Currency switcher: USD, GBP, EUR]": a price nobody has set is a blank the UI
-- flags, never a number this migration invents, because the figure in a
-- proposal is contractual the moment it is accepted.

ALTER TABLE proof_items
  ADD COLUMN IF NOT EXISTS figure TEXT,   -- "22", "216" — rendered large
  ADD COLUMN IF NOT EXISTS source TEXT;   -- "our editorial log, March 2023 to April 2026"

ALTER TABLE proposal_methods
  -- 'full' = case studies and outcome claims are fair game.
  -- 'no_outcome_claims' = a new service with no clients through it yet. The
  -- proposal may cite October's record and the testimonials, and may not imply
  -- a result this method has produced, because it has not produced one.
  ADD COLUMN IF NOT EXISTS evidence_policy TEXT NOT NULL DEFAULT 'full',
  -- The founding-cohort line. Honest scarcity: places are capped because
  -- delivery on the first clients has to be right, and the rate rises once the
  -- case studies exist.
  ADD COLUMN IF NOT EXISTS scarcity TEXT;

-- ── Correct the prices and commitments seeded in 205 ───────────────────────
-- The committed lists are derived from the redesign's own comparison table
-- (initiatives a quarter, plan of work rebuilt quarterly, reporting cadence,
-- which channels are active at each level), not written fresh here, so they
-- match what the website promises. Daniel can edit them in Settings.
UPDATE proposal_methods
   SET prices = '{"GBP": {"monthly": 1345, "setup": 0}}',
       blurb = 'The careful level: two initiatives a quarter, same method, same reporting.',
       kpis = '{"committed": ["Two active initiatives a quarter, across press, SEO and content",
                              "A written plan of work, rebuilt every quarter",
                              "Weekly reporting against the audit baseline"],
                "reported": ["Named-outlet coverage secured, and the referring links it carries",
                             "Positions for the project types you want to be found for",
                             "Citations in AI answers for your target queries",
                             "Branded and direct search volume, which is the only honest awareness number",
                             "Share of enquiries above your target project value"],
                "close": "If the second list is not moving by the end of the first quarter we change the tactics, not the invoice."}',
       includes = '["Quarterly visibility audit across search, AI answers, press and referral",
                    "Two active initiatives a quarter",
                    "Press outreach, SEO and content",
                    "A written plan of work, rebuilt every quarter",
                    "Weekly reporting against the audit baseline"]',
       updated_at = NOW()
 WHERE slug = 'basic' AND prices = '{"GBP": {"monthly": 1800, "setup": 0}}';

UPDATE proposal_methods
   SET prices = '{"GBP": {"monthly": 1870, "setup": 0}}',
       blurb = 'The level most practices take, and the one marked most popular on our pricing: three to four initiatives a quarter rather than two, paid support where it helps, and a live dashboard alongside the weekly report.',
       kpis = '{"committed": ["Three to four active initiatives a quarter, across press, SEO, content and paid",
                              "A written plan of work, rebuilt every quarter",
                              "Weekly reporting plus a live dashboard",
                              "A direct line for in-quarter changes"],
                "reported": ["Named-outlet coverage secured, and the referring links it carries",
                             "Positions for the project types you want to be found for",
                             "Citations in AI answers for your target queries",
                             "Branded and direct search volume, which is the only honest awareness number",
                             "Share of enquiries above your target project value"],
                "close": "If the second list is not moving by the end of the first quarter we change the tactics, not the invoice."}',
       includes = '["Everything in Basic",
                    "Three to four active initiatives a quarter",
                    "Paid support where it helps, with ad spend billed separately at cost",
                    "Weekly reporting plus a live dashboard",
                    "A direct line for in-quarter changes"]',
       updated_at = NOW()
 WHERE slug = 'advanced' AND prices = '{"GBP": {"monthly": 2500, "setup": 0}}';

-- Reporting is weekly on this method, not monthly. 205 carried the old
-- audit/priority/review stages across from the constant, which described a
-- monthly cadence.
UPDATE proposal_methods
   SET stages = jsonb_set(stages, '{2,text}',
         '"Reported weekly throughout and reviewed against the gap named in month one. What worked continues, what did not gets replaced by the next priority, and the cycle repeats, compounding each quarter."'),
       updated_at = NOW()
 WHERE slug IN ('advanced', 'basic') AND jsonb_array_length(stages) = 3;

-- ── The third method ───────────────────────────────────────────────────────
-- A new service, deliberately sold as one: capped cohort, founding rate, and no
-- claims about results until a client has run it.
INSERT INTO proposal_methods
  (slug, name, family, blurb, sort_order, evidence_policy, scarcity, prices, includes, objectives, kpis, strategy, tactics, stages)
VALUES
  ('serious-buyer', 'Serious Buyer Method', 'Serious Buyer Method',
   'For practices that get more enquiries than they have time to answer. The filtering moves to the first contact, so your hours go to people ready to commission.',
   3,
   'no_outcome_claims',
   'Places in the founding cohort are capped at two practices, so delivery on the first clients is right. The founding rate holds for the first three months and moves to the standard rate once the case studies exist.',
   '{"GBP": {"monthly": 1140, "setup": 0}}',
   '["Studio landing page and advice hub", "Paid ads on Meta, ad spend billed separately", "60-day nurture sequence", "Monthly reporting on enquiry quality", "Live within one to two weeks of sign-off"]',
   '{"short": "The landing page, advice hub and nurture sequence live, with the qualifying questions asked before the first call rather than at the proposal.",
     "mid": "Enquiry quality reported monthly, with the filtering adjusted on what the lead data shows.",
     "long": "Your hours going to people who are ready to commission, because the unready have filtered themselves out before they reach you."}',
   '{"committed": ["The landing page and advice hub live within one to two weeks of sign-off",
                   "A 60-day nurture sequence written and running",
                   "Meta ads built, managed and reported, with ad spend billed separately and at cost",
                   "A monthly report on enquiry quality by the fifth working day"],
     "reported": ["Enquiries received, and the share that answer the qualifying questions",
                  "Guide downloads and repeat views, from your own lead data",
                  "Replies to the nurture sequence, and where in the 60 days they come",
                  "Cost per enquiry that meets your budget, timing and location criteria"],
     "close": "This is a new service and we are not going to pretend otherwise. Every number above comes from your own lead data, and we make no claim about results until a client has run the method."}',
   '[{"title": "Filter at the front, not at the proposal", "text": "The expensive part of an unqualified enquiry is the hours it takes before you find out. Moving the budget, timing and location questions to the first contact means the unready filter themselves out while it still costs nothing."},
     {"title": "Advice does the qualifying", "text": "A hub of genuinely useful advice answers the questions a serious buyer has and bores a tyre-kicker. That asymmetry is the filter, and it works whether or not anyone fills a form."},
     {"title": "Paid reach, owned sequence", "text": "Ads buy the first click. The nurture sequence, which you own, does the rest over sixty days, so the cost of a qualified enquiry falls as the sequence improves rather than rising with the ad auction."}]',
   '[{"heading": "landing page and hub", "items": ["Studio landing page built and live", "Advice hub with the qualifying questions built in", "Enquiry form capturing budget, timing and location"]},
     {"heading": "paid", "items": ["Meta campaigns built and managed", "Ad spend billed separately and at cost", "Creative and audience iterated on enquiry quality, not clicks"]},
     {"heading": "nurture", "items": ["60-day sequence written and running", "Buyers filter themselves on budget, timing and location", "Replies routed to you, not to a queue"]},
     {"heading": "reporting", "items": ["Monthly report on enquiry quality", "Lead data shared in full, including what is not working"]}]',
   '[{"stage": "01", "when": "weeks one and two", "title": "build and launch", "text": "The landing page, the advice hub and the enquiry form go live, with the qualifying questions agreed with you first."},
     {"stage": "02", "when": "month one", "title": "reach and sequence", "text": "Ads start sending likely buyers to the page, and the 60-day sequence begins doing the filtering."},
     {"stage": "03", "when": "monthly", "title": "report and adjust", "text": "Enquiry quality reported against your own lead data, and the filtering tightened on what it shows."}]')
ON CONFLICT (slug) DO NOTHING;

-- ── The counted record ─────────────────────────────────────────────────────
-- Four figures, each with its source, from the editorial log. These are the
-- proof block's strongest material and the reason a proposal can be credible
-- before a single case study exists.
INSERT INTO proof_items (kind, title, body, figure, source, sector_tags, problem_tags, active) VALUES
  ('credential', 'Countries where client work has been published',
   'On six continents, from Wallpaper*, Monocle and the Financial Times to Domus, Elle Decor Spain and Times of Malta.',
   '22', 'October''s editorial log, March 2023 to April 2026',
   ARRAY['architecture','interiors','furniture','design','hospitality','culture'], ARRAY['press','trust'], true),
  ('credential', 'Pieces of published coverage',
   'Secured for clients between March 2023 and April 2026, across national newspapers, trade titles and design press.',
   '216', 'October''s editorial log, March 2023 to April 2026',
   ARRAY['architecture','interiors','furniture','design','hospitality','culture'], ARRAY['press','trust'], true),
  ('credential', 'Outlets placed in',
   'From national newspapers to trade and design titles in each market.',
   '150', 'October''s editorial log, March 2023 to April 2026',
   ARRAY['architecture','interiors','furniture','design','hospitality','culture'], ARRAY['press','trust'], true),
  ('credential', 'Clients with published coverage',
   'From furniture makers to architecture practices and festivals.',
   '18', 'October''s editorial log, March 2023 to April 2026',
   ARRAY['architecture','interiors','furniture','design','retail','culture'], ARRAY['press','trust'], true),
  ('credential', 'Published in',
   'Wallpaper*, Monocle, Financial Times, The Times, The Observer, Dwell, Dezeen, Domus, Travel + Leisure, Evening Standard, Designboom, Architectural Record, The Architects'' Journal, Livingetc, Ideal Home, HOLA!, Elle Decoration, Azure and Hole & Corner.',
   NULL, 'October''s editorial log, March 2023 to April 2026',
   ARRAY['architecture','interiors','furniture','design','hospitality','property','culture'], ARRAY['press','trust'], true)
ON CONFLICT DO NOTHING;

-- ── Named coverage ─────────────────────────────────────────────────────────
INSERT INTO proof_items (kind, title, body, attribution, sector_tags, problem_tags, active) VALUES
  ('press', 'Wallpaper*: Arcade at Battersea Power Station',
   'Exclusive feature in Wallpaper* for Red Deer, July 2023.',
   'Red Deer, July 2023',
   ARRAY['architecture','interiors','retail','property'], ARRAY['press','positioning'], true),
  ('press', 'Dezeen: Cutwork modular housing',
   'Cutwork designs modular housing for long-term living or emergency shelter. Dezeen, January 2024.',
   'Cutwork Studio, January 2024',
   ARRAY['architecture','design','residential'], ARRAY['press','positioning'], true)
ON CONFLICT DO NOTHING;
