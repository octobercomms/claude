-- Contacts merge, phase 2: repoint the PR module onto the unified contacts
-- table (outreach_contacts) and drop pr_contacts.
--
-- The press contact data is disposable (the real list is a spreadsheet, to be
-- re-imported), so we don't migrate rows — we clear the journalist links and
-- thank history, repoint the three foreign keys that referenced pr_contacts,
-- then drop pr_contacts. pr_outlets stays as the Publications table.

BEGIN;

-- 1. Clear the disposable links so no row references a pr_contacts id once it's gone.
UPDATE pr_editorial_log SET contact_id = NULL;
TRUNCATE pr_sent_thanks, pr_thank_feedback;

-- 2. Repoint the foreign keys from pr_contacts → outreach_contacts (same ON DELETE).
ALTER TABLE pr_editorial_log DROP CONSTRAINT IF EXISTS pr_editorial_log_contact_id_fkey;
ALTER TABLE pr_editorial_log
  ADD CONSTRAINT pr_editorial_log_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES outreach_contacts(id) ON DELETE SET NULL;

ALTER TABLE pr_sent_thanks DROP CONSTRAINT IF EXISTS pr_sent_thanks_contact_id_fkey;
ALTER TABLE pr_sent_thanks
  ADD CONSTRAINT pr_sent_thanks_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES outreach_contacts(id) ON DELETE CASCADE;

ALTER TABLE pr_thank_feedback DROP CONSTRAINT IF EXISTS pr_thank_feedback_contact_id_fkey;
ALTER TABLE pr_thank_feedback
  ADD CONSTRAINT pr_thank_feedback_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES outreach_contacts(id) ON DELETE CASCADE;

-- 3. pr_contacts is now unreferenced — drop it (its trigger drops with it).
DROP TABLE IF EXISTS pr_contacts;

COMMIT;
