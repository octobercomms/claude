-- Which concepts the client is shown.
--
-- A batch of eight rarely goes to the client as eight. Two are weak, one
-- repeats an angle, and the AM wants to send the five that are worth a
-- decision. Until now there was no way to say so: the approval link shared
-- every concept in the batch, so trimming meant deleting work you might
-- want next month.
--
-- Daniel, on the Render step: "On this page I'd like to be able to uncheck
-- any ads I dont want the client to see."
--
-- Default true, because the existing behaviour is that everything is shared
-- and a migration should not silently hide work from a client who is already
-- reviewing it.

ALTER TABLE ad_creatives
  ADD COLUMN IF NOT EXISTS show_to_client BOOLEAN NOT NULL DEFAULT TRUE;

-- The approval page filters on this for every concept in a batch, which on a
-- 100-variant matrix is the difference between a sequential scan and an
-- index hit.
CREATE INDEX IF NOT EXISTS idx_ad_creatives_batch_shown
  ON ad_creatives (batch_id) WHERE show_to_client;
