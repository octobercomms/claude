-- Multi-coding support and transfer types for the supplier brain.
--
-- Problem: the brain stores one coding per supplier, but suppliers like
-- "Daniel Nelson" need different codings depending on context (dividends
-- vs PAYE). Transfers between own accounts (PayPal, Stripe payouts) need
-- a different type entirely: "transfer to [destination]" rather than an
-- expense account code.
--
-- Solution: a child table of codings per supplier, each with optional
-- trigger patterns that disambiguate when the full statement line text
-- is available. The supplier row's own account_code/vat_treatment remain
-- the default coding for backward compatibility.

-- 1. Add transfer fields to the main supplier table.
ALTER TABLE acct_suppliers
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'expense'
    CHECK (type IN ('expense', 'transfer'));

ALTER TABLE acct_suppliers
  ADD COLUMN IF NOT EXISTS destination_bank_account_id text;

ALTER TABLE acct_suppliers
  ADD COLUMN IF NOT EXISTS destination_bank_account_name text;

-- Allow null account_code for transfer-type records.
ALTER TABLE acct_suppliers ALTER COLUMN account_code DROP NOT NULL;

-- 2. Per-supplier codings for multi-coding support.
-- When trigger_patterns is empty, this is an alternative default.
-- When populated, patterns are matched against the full line text.
CREATE TABLE IF NOT EXISTS acct_supplier_codings (
  id                          bigserial PRIMARY KEY,
  supplier_id                 bigint NOT NULL REFERENCES acct_suppliers(id) ON DELETE CASCADE,
  type                        text NOT NULL DEFAULT 'expense' CHECK (type IN ('expense', 'transfer')),
  account_code                text,
  account_name                text,
  vat_treatment               text DEFAULT 'NONE',
  is_reverse_charge           boolean NOT NULL DEFAULT false,
  destination_bank_account_id   text,
  destination_bank_account_name text,
  trigger_patterns            text[] NOT NULL DEFAULT '{}',
  confidence_counter          int NOT NULL DEFAULT 0,
  auto_code                   boolean NOT NULL DEFAULT true,
  notes                       text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS acct_supplier_codings_supplier_idx
  ON acct_supplier_codings (supplier_id);

CREATE INDEX IF NOT EXISTS acct_supplier_codings_patterns_idx
  ON acct_supplier_codings USING gin (trigger_patterns);

-- 3. Bank accounts reference (populated from Xero).
CREATE TABLE IF NOT EXISTS acct_bank_accounts (
  id              bigserial PRIMARY KEY,
  xero_account_id text NOT NULL UNIQUE,
  name            text NOT NULL,
  code            text,
  currency        text DEFAULT 'GBP',
  bank_type       text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
