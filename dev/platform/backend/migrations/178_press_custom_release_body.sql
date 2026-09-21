-- Author-written FIRST email for a press campaign. When followups_ai is FALSE
-- (full author mode) and custom_release_body is set, the release/first email is
-- sent from this AM-written body (merge tags honoured) instead of an AI pitch.
-- This is what makes the flow usable for a plain invitation or announcement:
-- the AI pitch generator is hardwired to write "press release" framing, which
-- is wrong for an invite. Default empty keeps existing campaigns on the AI pitch.
ALTER TABLE outreach_press_releases
  ADD COLUMN IF NOT EXISTS custom_release_body TEXT;
