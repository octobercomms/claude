-- What a proposal remembers about how it was made.
--
-- method_id       which method was selected on the draft screen
-- method_snapshot the method's content as it was at that moment. This, not the
--                 version number, is what makes an old proposal still read as
--                 it was sent: improving a method must never silently rewrite a
--                 proposal somebody has already signed.
-- currency        the code (GBP/USD/EUR). Assigned by hand, never converted,
--                 because the prices are fixed per market rather than derived.
-- call_input      the raw thing Daniel pasted: plain notes or a whole call
--                 transcript. Kept so a re-draft does not need it typed again.
-- extraction      the facts pass one pulled out of call_input, plus what it
--                 could not find. Pass two writes from this rather than from
--                 the raw transcript, so nothing said in confidence on a call
--                 can be paraphrased into a document the prospect can forward.
--                 It also means pressing re-draft costs a fraction, because the
--                 transcript is read once and not on every regeneration.

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS method_id       UUID REFERENCES proposal_methods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS method_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS currency        VARCHAR(3) NOT NULL DEFAULT 'GBP',
  ADD COLUMN IF NOT EXISTS call_input      TEXT,
  ADD COLUMN IF NOT EXISTS extraction      JSONB;

CREATE INDEX IF NOT EXISTS proposals_method_idx ON proposals (method_id);

-- The two-pass draft gets its own budget line. Both calls are human-triggered
-- (Daniel presses draft and waits), so it is uncapped like the rest of the
-- interactive work, but counted, so a 10,000-token transcript paste shows up
-- against proposals rather than against nothing. The reason it is not folded
-- into a press task: capping press work must never stop a proposal going out,
-- and a proposal is worth four figures a month where a pitch is worth pennies.
INSERT INTO ai_task_budgets (task, label, features, monthly_cap_usd, note) VALUES
  ('proposal_draft',
   'Drafting proposals',
   ARRAY['pipeline_proposal', 'pipeline_proposal_extract', 'pipeline_call_brief'],
   NULL,
   'Two calls per draft: one cheap pass that reads the notes or transcript and pulls out the facts, and one Opus pass that writes the four blocks written for the prospect. About 17p a proposal, and a re-draft costs only the second pass because the extraction is stored.')
ON CONFLICT (task) DO NOTHING;
