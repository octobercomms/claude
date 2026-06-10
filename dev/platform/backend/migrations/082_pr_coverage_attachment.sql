-- pr_editorial_log gets two columns for storing a single attached PDF
-- (press cutout, magazine spread scan, embargoed advance copy, etc.) so the
-- AM can hold artifacts on coverage entries whose only "URL" is a printed
-- magazine page. attachment_url is the relative path under
-- /coverage-attachments served by the backend; attachment_filename is the
-- original filename for nice download UX. Both nullable — most entries are
-- still link-only and don't need an upload.

ALTER TABLE pr_editorial_log
  ADD COLUMN IF NOT EXISTS attachment_url      TEXT,
  ADD COLUMN IF NOT EXISTS attachment_filename TEXT;
