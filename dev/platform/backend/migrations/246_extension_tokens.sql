-- Extension API tokens for the Xero Brain Chrome extension.
-- Scoped bearer tokens stored in chrome.storage.local, used for
-- cross-origin requests from the extension to OMI's accounts API.

CREATE TABLE IF NOT EXISTS acct_extension_tokens (
  id          bigserial PRIMARY KEY,
  token_hash  text NOT NULL UNIQUE,
  label       text NOT NULL DEFAULT 'Xero Brain Extension',
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used   timestamptz,
  revoked_at  timestamptz
);

CREATE INDEX IF NOT EXISTS acct_ext_tokens_hash_idx
  ON acct_extension_tokens (token_hash) WHERE revoked_at IS NULL;

-- Pre-coding log: every transaction OMI writes to Xero on Daniel's behalf.
-- Shown in the Friday digest so he sees what went into his ledger.

CREATE TABLE IF NOT EXISTS acct_precode_log (
  id                  bigserial PRIMARY KEY,
  supplier_id         bigint REFERENCES acct_suppliers(id),
  supplier_name       text NOT NULL,
  account_code        text NOT NULL,
  vat_treatment       text NOT NULL,
  amount              numeric NOT NULL,
  currency            text NOT NULL DEFAULT 'GBP',
  xero_transaction_id text,
  invoice_match_id    bigint,
  invoice_filename    text,
  status              text NOT NULL DEFAULT 'written'
                      CHECK (status IN ('written', 'matched', 'rejected', 'error')),
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS acct_precode_log_created_idx
  ON acct_precode_log (created_at DESC);
