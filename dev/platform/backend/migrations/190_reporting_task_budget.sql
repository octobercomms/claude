-- Put the remaining automated spenders under a task budget, so "cap every
-- automated run" is actually true rather than nearly true.
--
-- After migrations 185 and 189, three tasks covered the media researchers,
-- prospecting, press pitching and tenders. Six features that also run
-- unattended on crons were still in no budget at all:
--
--   ai_visibility_query / ai_visibility_sentiment  scheduler → aiVisibility.runAllClients
--   strategist_report / report_narrative           scheduler → runScheduledReports
--   serper_search / serper_news                    scheduler, via services/serper.js
--
-- On Daniel's log these ran to about $3.12 a week, so roughly $13 a month.
-- Not a runaway, but uncapped, and the point of the task budgets is that the
-- Settings screen tells the truth about what can and cannot be stopped.
--
-- Note on serper: it is not Anthropic, so the global AI hard cap never gated
-- it (that check lives inside callClaude). Its spend does count toward the
-- global month-to-date total, which means an unchecked serper could help
-- exhaust the global cap and block Claude calls elsewhere. A task budget is
-- the only thing that actually bounds it.
--
-- Seeded with no budget, like the others, so nothing changes until a number
-- is entered.

INSERT INTO ai_task_budgets (task, label, features, monthly_cap_usd, note) VALUES
  ('reporting',
   'Reports and visibility tracking',
   ARRAY['report_narrative', 'strategist_report', 'ai_visibility_query',
         'ai_visibility_sentiment', 'ai_visibility_prompt_generation',
         'ai_visibility_keyword_fanout', 'serper_search', 'serper_news'],
   NULL,
   'Scheduled client reports, the strategist write-up, and AI visibility tracking with its searches. Runs weekly and monthly per client, so it scales with how many clients you have rather than with anything you do.')
ON CONFLICT (task) DO NOTHING;
