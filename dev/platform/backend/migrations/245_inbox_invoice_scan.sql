-- Email as a peer invoice source: per-mailbox toggle and match metadata.

-- Let each mailbox opt into invoice scanning independently of outreach toggles.
ALTER TABLE outreach_inboxes ADD COLUMN IF NOT EXISTS scan_invoices boolean NOT NULL DEFAULT false;

-- Track where a matched invoice came from (drive or email).
ALTER TABLE acct_invoice_matches ADD COLUMN IF NOT EXISTS source varchar(20) NOT NULL DEFAULT 'drive';

-- Email-sourced matches carry envelope metadata for deduplication and audit.
ALTER TABLE acct_invoice_matches ADD COLUMN IF NOT EXISTS email_message_id text;
ALTER TABLE acct_invoice_matches ADD COLUMN IF NOT EXISTS email_from text;
ALTER TABLE acct_invoice_matches ADD COLUMN IF NOT EXISTS email_subject text;

CREATE INDEX IF NOT EXISTS acct_inv_match_email_msg_idx ON acct_invoice_matches (email_message_id) WHERE email_message_id IS NOT NULL;

-- Deadline filing inference: store the payment amount when auto-detected from the ledger.
ALTER TABLE acct_tax_deadlines ADD COLUMN IF NOT EXISTS payment_amount numeric(12,2);
