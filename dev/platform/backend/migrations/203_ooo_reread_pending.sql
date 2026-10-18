-- Re-read pending suggestions too, and pick up the charset fix.
--
-- Migration 202 versioned the out-of-office reader so an improvement could
-- reach messages already scanned. It excluded every row carrying a suggestion,
-- on the grounds that one might have been applied or declined. Half right: an
-- applied or dismissed row IS a decision, and upsertSuggestion overwrites
-- alt_contacts unconditionally, so re-reading one would rewrite what somebody
-- already acted on.
--
-- A suggestion still PENDING is different. Nothing has been done to it, the
-- tick boxes are browser state rather than stored, and its quote and names
-- came from whichever reader produced them -- which is why rows raised before
-- the MIME fix still showed a boundary line spliced mid-sentence on the review
-- screen. The reply catch-up refreshes its pending rows for exactly this
-- reason (migration 201 and replyCatchup.consider); not carrying the same rule
-- across was an oversight, not a judgement.
--
-- 202 stamped version 2 on those pending rows, so they need putting back to
-- eligible. Applied and dismissed rows keep version 2 and stay settled.
UPDATE ooo_scanned_messages m
   SET reader_version = 1
  FROM ooo_suggestions s
 WHERE s.id = m.suggestion_id
   AND s.status = 'pending';

-- READER_VERSION is now 3 (charset: us-ascii and iso-8859-1 read as
-- windows-1252, so Outlook curly quotes survive; abbreviated and possessive
-- titles no longer land in a contact name). Rows read by version 2 that found
-- nothing are eligible on that count alone and need no change here.

-- The partial index from 202 assumed suggestion_id IS NULL. Pending rows are
-- eligible now, so it no longer covers the query.
DROP INDEX IF EXISTS idx_ooo_scanned_rereadable;
CREATE INDEX IF NOT EXISTS idx_ooo_scanned_rereadable
  ON ooo_scanned_messages (reader_version)
  WHERE was_auto_reply = TRUE;
