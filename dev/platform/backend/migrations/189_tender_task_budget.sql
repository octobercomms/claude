-- Put tender web search under a task budget.
--
-- It bills Anthropic directly for web_search and runs unattended on a weekly
-- cron (Mondays 06:35), one search pass per market. At $0.64 a call it was the
-- second-largest Anthropic line after the outlet resolver, and it sat in no
-- task budget at all, so nothing could stop or even measure it against a cap.
--
-- It was also miscategorised as human-triggered in tests/budget-gating.test.js
-- when that guard shipped, which is why the guard passed while this was
-- unprotected. Both are corrected together: a guard that classifies wrongly is
-- worse than no guard, because it reads as assurance.
--
-- Seeded with no budget, like the others, so nothing changes until a number is
-- entered. tender_score is DeepSeek and costs pennies, but it belongs to the
-- same task so pausing tenders pauses the whole feature rather than half.

INSERT INTO ai_task_budgets (task, label, features, monthly_cap_usd, note) VALUES
  ('tenders',
   'Tender finding',
   ARRAY['tender_web_search', 'tender_score', 'tender_profile_learn', 'tender_chat', 'tender_add_url'],
   NULL,
   'Searching for public-sector tenders each week and scoring what it finds. The search is the paid part, about $0.64 a call; scoring runs on DeepSeek for pennies.')
ON CONFLICT (task) DO NOTHING;
