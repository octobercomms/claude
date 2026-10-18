-- Let a reader improvement reach messages that were already scanned.
--
-- ooo_scanned_messages is a permanent watermark: ingestMessage returns early
-- on any message_key it has seen. That is right for not re-proposing the same
-- contact twice, and wrong the moment the reader itself gets better.
--
-- It got better on 18 Oct 2026 (mimeText, PR #1695). Before that, "the body"
-- was everything after the first blank line, so an auto-reply in the usual
-- multipart/alternative shape handed the extractor a boundary line, part
-- headers and, where the part was base64, nothing readable at all. The
-- extractor then found no contacts and the message was recorded with
-- was_auto_reply = TRUE and suggestion_id = NULL -- which reads as "an
-- auto-reply with no stand-in named", indistinguishable on the screen from a
-- plain "I'm away until Monday". Some of those were a failed read.
--
-- So: version the reader. A message scanned by an older reader than the one
-- running is eligible to be read again. The next improvement bumps the
-- constant in oooMailScan.js and costs nothing else.
--
-- Deliberately narrow, because a re-read is only worth it where the reader is
-- what decided the outcome:
--
--   * suggestion_id IS NOT NULL  -- already proposed. Pending, applied or
--     declined, it is on a screen and may have been acted on. Never touched.
--   * was_auto_reply = FALSE     -- decided from the SUBJECT and HEADERS
--     alone, which mimeText did not change. Re-reading every ordinary email
--     ever seen would be a great deal of work for a guaranteed identical
--     answer.
--
-- That leaves exactly the messages whose outcome depended on reading the body
-- and which produced nothing.

ALTER TABLE ooo_scanned_messages
  ADD COLUMN IF NOT EXISTS reader_version INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN ooo_scanned_messages.reader_version IS
  'Which body reader produced this verdict. Below oooMailScan.READER_VERSION and with no suggestion, the message is eligible for a re-read.';

-- Rows that already carry a suggestion are settled, whatever read them. Mark
-- them current so they are never reconsidered, and so the eligible set is
-- only ever "read the body, found nothing".
UPDATE ooo_scanned_messages
   SET reader_version = 2
 WHERE suggestion_id IS NOT NULL;

-- Likewise anything judged not an auto-reply: that verdict comes from headers.
UPDATE ooo_scanned_messages
   SET reader_version = 2
 WHERE was_auto_reply = FALSE;

CREATE INDEX IF NOT EXISTS idx_ooo_scanned_rereadable
  ON ooo_scanned_messages (reader_version)
  WHERE suggestion_id IS NULL AND was_auto_reply = TRUE;
