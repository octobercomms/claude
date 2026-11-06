-- Accounts classification uses Claude directly (web_search tool for supplier
-- lookup), so it bypasses callClaude and needs its own task budget entry.
-- Runs unattended on the Sunday 21:00 reconciliation cron.
--
-- Seeded with no cap so nothing changes until a number is entered.

INSERT INTO ai_task_budgets (task, label, features, monthly_cap_usd, note) VALUES
  ('accounts',
   'Accounts reconciliation',
   ARRAY['accounts_classify'],
   NULL,
   'Weekly bank line classification via Claude. Runs Sunday evenings; volume scales with transaction count, not client count.')
ON CONFLICT (task) DO NOTHING;
