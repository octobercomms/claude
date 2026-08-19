-- Turn CanadaBuys on — October wants Canadian PR/comms tenders (e.g. Destination
-- Canada media relations). SAM.gov (US) stays off until a SAM_API_KEY is set.
-- Idempotent: only flips the flag if the row exists.
UPDATE tender_sources SET enabled = true WHERE name = 'CanadaBuys';
