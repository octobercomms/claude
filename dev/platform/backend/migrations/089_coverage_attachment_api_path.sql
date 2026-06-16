-- Repoint existing coverage-entry attachment URLs to the /api-prefixed path.
--
-- Attachments were served from the bare /coverage-attachments path, which
-- depends on its own nginx location block. That proved unreliable in
-- production (a miss falls through to the SPA → blank screen). They're now
-- served under /api/coverage-attachments, which rides the same always-proxied
-- path as every other API call. New uploads already store the /api prefix;
-- this rewrites the rows uploaded before the change. Idempotent — only touches
-- rows still on the bare prefix.

UPDATE pr_editorial_log
SET attachment_url = '/api' || attachment_url
WHERE attachment_url LIKE '/coverage-attachments/%';
