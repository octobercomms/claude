-- Supplier brain: persistent supplier reference for the three-tier coding model.
--
-- Tier 1 (auto-code): pattern matched, same account code, amount in range.
-- Tier 2 (flag): pattern matched but deviation (amount, currency, cadence).
-- Tier 3 (unknown): no match, goes to Daniel, answer creates the record.
--
-- match_patterns is a text array because a single supplier can appear under
-- multiple bank statement descriptions (Wise renders payees inconsistently).
-- Keyed on patterns, not display names.

CREATE TABLE IF NOT EXISTS acct_suppliers (
  id                bigserial PRIMARY KEY,
  display_name      text NOT NULL,
  xero_contact_id   text,
  match_patterns    text[] NOT NULL DEFAULT '{}',
  account_code      text NOT NULL,
  account_name      text,
  vat_treatment     text NOT NULL DEFAULT 'NONE',
  is_reverse_charge boolean NOT NULL DEFAULT false,
  usual_currency    text DEFAULT 'GBP',
  expected_cadence  text CHECK (expected_cadence IN (
    'weekly', 'monthly', 'quarterly', 'annual', 'ad_hoc'
  )),
  invoice_source    text CHECK (invoice_source IN (
    'drive', 'email', 'xero_direct', 'not_required', 'unknown'
  )) DEFAULT 'unknown',
  confidence_counter int NOT NULL DEFAULT 0,
  auto_code         boolean NOT NULL DEFAULT true,
  last_seen         timestamptz,
  last_amount       numeric,
  amount_min        numeric,
  amount_max        numeric,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS acct_suppliers_patterns_idx
  ON acct_suppliers USING gin (match_patterns);
CREATE INDEX IF NOT EXISTS acct_suppliers_xero_idx
  ON acct_suppliers (xero_contact_id);
CREATE INDEX IF NOT EXISTS acct_suppliers_code_idx
  ON acct_suppliers (account_code);
