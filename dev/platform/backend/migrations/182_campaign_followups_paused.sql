-- Campaign-level "hold all follow-ups" switch. When an AM wants to stop every
-- follow-up (steps 2+) going out — e.g. they realise the sequence is firing on
-- an unexpected schedule — we stamp followups_paused_at on the campaign. The
-- send loop excludes step > 1 sends while it's set, so the first email can keep
-- finishing but no follow-up leaves. Reversible: clearing it resumes them (their
-- pending rows are still there, dated in the past, so they flow again).
ALTER TABLE outreach_campaigns
  ADD COLUMN IF NOT EXISTS followups_paused_at TIMESTAMPTZ;
