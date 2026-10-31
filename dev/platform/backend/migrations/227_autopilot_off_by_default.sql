-- The Shared autopilot is off until somebody turns it on.
--
-- It was kept rather than deleted (31 Oct review, after the explanation of
-- how it works), on one condition: no client is ever on it unless that is a
-- deliberate choice for that client. The column defaulted to false — not
-- paused, which is to say live — so every client created since migration 046
-- was on a cron that posts to Instagram, Facebook and LinkedIn without
-- anybody clicking go. That is the opposite of OMI's standing rule.
--
-- So the default flips, and every existing client is paused. The review has
-- never run the autopilot, so nothing that was deliberately live is being
-- switched off here. A client that should be on it is turned on from the
-- Schedule step, which is where the toggle lives.
--
-- The column keeps its name. Renaming it would touch the publisher's query,
-- two routes and the frontend to say the same thing the other way round.

ALTER TABLE clients
  ALTER COLUMN social_autopilot_paused SET DEFAULT true;

UPDATE clients SET social_autopilot_paused = true WHERE social_autopilot_paused = false;
