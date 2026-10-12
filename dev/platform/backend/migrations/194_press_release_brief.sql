-- The release writing surface: a fact sheet, and the checker's last reading.
--
-- The fact sheet is one JSONB blob rather than twenty columns because it is a
-- form the editorial standard owns, not a schema the database owns: the six
-- moves, the quote slots, the fact sheet and the asset list all move together
-- when the standard changes.
ALTER TABLE pr_press_releases
  ADD COLUMN IF NOT EXISTS brief_json          JSONB,
  ADD COLUMN IF NOT EXISTS humanity_json       JSONB,
  ADD COLUMN IF NOT EXISTS humanity_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN pr_press_releases.brief_json IS
  'Fact sheet: news hook, the six moves, named quotes, dates/dimensions/materials/cost/location/credits, assets. Slots, never prose.';
COMMENT ON COLUMN pr_press_releases.humanity_json IS
  'Last reading from shared/humanity.mjs, recomputed server-side on save. Advisory: nothing blocks on it.';

-- The two Claude calls this surface makes (building the fact sheet, and the
-- optional semantic fact check) get their own monthly allowance so they can
-- never become a surprise. The deterministic checker costs nothing and is not
-- listed here because it never bills.
INSERT INTO ai_task_budgets (task, label, features, monthly_cap_usd, note)
VALUES (
  'press_writing',
  'Press release writing',
  ARRAY['press_brief', 'press_factcheck'],
  10.00,
  'Building a release fact sheet and checking its claims. One call per button press, never on typing. Change or pause in Settings → AI models.'
)
ON CONFLICT (task) DO NOTHING;
