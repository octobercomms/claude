-- Subfolder discovery and include/exclude toggles for the Drive invoice scanner.
-- The scanner discovers subfolders under the root invoice folder and stores them
-- here so the user can control which ones are scanned.

CREATE TABLE IF NOT EXISTS acct_drive_subfolders (
  id              bigserial PRIMARY KEY,
  drive_folder_id text NOT NULL UNIQUE,
  parent_id       text,
  name            text NOT NULL,
  path            text NOT NULL,
  included        boolean NOT NULL DEFAULT true,
  file_count      integer,
  last_scanned_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS acct_drive_sub_parent_idx ON acct_drive_subfolders (parent_id);

-- Add folder path to invoice matches so we know which year folder a file came from.
ALTER TABLE acct_invoice_matches ADD COLUMN IF NOT EXISTS drive_folder_path text;
