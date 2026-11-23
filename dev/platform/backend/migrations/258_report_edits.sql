-- Let a human edit a generated report before it reaches the client.
--
-- A report is an ordered array of typed sections, resolved by
-- templateRenderer and stored on the row. That array drives BOTH renderers:
-- the A4 PDF (pdfService.renderResolvedSection) and the email body
-- (emailService.renderEmailSection). So edits belong on the sections, not on
-- the rendered html_content: edit the structure once and both surfaces agree.
-- Editing the HTML would have meant hand-edited markup in a client email with
-- no sanitiser in the project, and an attached PDF that still said the old
-- thing.
--
-- The generated original is never overwritten. summary.sections keeps what the
-- machine wrote; edited_sections holds the human version, or NULL when nobody
-- has touched it. Two columns rather than one mutable array, because the only
-- way to answer "did we change this before it went out, and to what" after the
-- fact is to still have both.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS edited_sections JSONB,
  ADD COLUMN IF NOT EXISTS edited_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edited_by       TEXT;

COMMENT ON COLUMN reports.edited_sections IS
  'Human-edited copy of summary.sections. NULL means untouched; the generated original always stays in summary.sections.';
COMMENT ON COLUMN reports.edited_by IS
  'Email of the user who last saved edits, for the audit trail the client-facing change needs.';
