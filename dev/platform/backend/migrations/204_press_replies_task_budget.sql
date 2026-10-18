-- Put reply classification under a budget, and the rest of outreachAi under
-- one that can at least see it.
--
-- services/outreachAi.js constructs `new Anthropic()` directly rather than
-- going through callClaude, so none of its three calls is visible to the
-- global hard cap, the per-task cap, or the Pause switch. They record their
-- spend, which is the worst combination: the Settings screen shows the money
-- going out and nothing can stop it. That is the exact shape of the
-- outletResolve incident the budget guard was written for, and the guard did
-- not catch it because outreachAi.js was listed as human-triggered.
--
-- Two of its three calls really are human-triggered (a person clicks Write
-- sequence or Refine audience and waits). The third is not: classifyReply
-- runs inside pollReplies, on a */15 cron, once per matched reply, unattended
-- and forever.
--
-- press_replies is its own task rather than part of press_outreach, because
-- the two must be able to stop independently. Capping or pausing outbound
-- sending should not blind OMI to what comes back, and a flood of inbound
-- replies should not halt a release mid-send.

INSERT INTO ai_task_budgets (task, label, features, monthly_cap_usd, note) VALUES
  ('press_replies',
   'Reading press replies',
   ARRAY['outreach_classify_reply'],
   NULL,
   'A short summary and classification of each journalist reply, about half a penny each. Opt-out detection is NOT part of this: it is a deterministic keyword pass that runs whether or not this task has budget, so capping or pausing here can never leave someone on a list after they asked to come off.')
ON CONFLICT (task) DO NOTHING;

-- The two interactive calls belong with the pitch writing they are part of.
-- Uncapped like the rest of press_outreach, but now at least counted, so the
-- spend appears against a task instead of nowhere.
UPDATE ai_task_budgets
   SET features = ARRAY(
         SELECT DISTINCT unnest(features || ARRAY['outreach_write_sequence', 'outreach_refine_audience'])
       )
 WHERE task = 'press_outreach';
