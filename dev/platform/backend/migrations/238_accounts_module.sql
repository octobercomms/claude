-- Accounts module: Xero integration, reconciliation, rules engine, VAT + year-end packs.
-- Single-tenant internal tool for October's own books.
-- All module tables prefixed acct_ to avoid collisions with existing OMI schema,
-- except xero_connections which is shared with the Xero connector.

-- Xero OAuth connection (one org, rotating tokens encrypted at rest).
CREATE TABLE IF NOT EXISTS xero_connections (
  id            serial PRIMARY KEY,
  tenant_id     text UNIQUE NOT NULL,
  tenant_name   text NOT NULL,
  access_token  jsonb NOT NULL,
  refresh_token jsonb NOT NULL,
  expires_at    timestamptz NOT NULL,
  scopes        text,
  last_sync_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- The learned memory. A rule hit is deterministic and needs no AI call.
-- payee_pattern is matched against the bank line description.
CREATE TABLE IF NOT EXISTS acct_rules (
  id              bigserial PRIMARY KEY,
  payee_pattern   text NOT NULL,
  match_type      text NOT NULL DEFAULT 'contains'
    CHECK (match_type IN ('contains', 'exact', 'starts_with', 'regex')),
  account_code    text NOT NULL,
  account_name    text,
  tax_rate        text,
  currency        text CHECK (currency IN ('GBP', 'USD', 'EUR', 'CAD')),
  confidence      numeric NOT NULL DEFAULT 1.0,
  times_confirmed int NOT NULL DEFAULT 1,
  last_seen       timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acct_rules_payee_idx ON acct_rules (lower(payee_pattern));

-- Reconciliation work queue. Populated by the poller, reviewed in the UI.
-- Must be created before acct_confirmations which references it.
CREATE TABLE IF NOT EXISTS acct_reconcile_queue (
  id              bigserial PRIMARY KEY,
  line_ref        text UNIQUE NOT NULL,
  bank_account    text,
  bank_account_id text,
  line_date       date,
  amount          numeric,
  currency        text,
  payee           text,
  description     text,
  reference       text,
  suggested_code  text,
  suggested_name  text,
  suggested_rate  text,
  confidence      numeric,
  match_source    text CHECK (match_source IN ('rule', 'ai', 'manual')),
  ai_reasoning    text,
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'written', 'skipped', 'error')),
  invoice_status  text DEFAULT 'not_checked'
    CHECK (invoice_status IN ('not_checked', 'matched', 'missing_amber', 'missing_red', 'not_required')),
  xero_line_data  jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acct_queue_status_idx ON acct_reconcile_queue (status);
CREATE INDEX IF NOT EXISTS acct_queue_date_idx ON acct_reconcile_queue (line_date DESC);
CREATE INDEX IF NOT EXISTS acct_queue_payee_idx ON acct_reconcile_queue (lower(payee));

-- Audit trail: every confirmation, whether from a rule or from AI.
CREATE TABLE IF NOT EXISTS acct_confirmations (
  id             bigserial PRIMARY KEY,
  queue_item_id  bigint REFERENCES acct_reconcile_queue(id),
  line_ref       text NOT NULL,
  bank_account   text,
  proposed_code  text,
  proposed_rate  text,
  confirmed_code text NOT NULL,
  confirmed_rate text,
  confirmed_name text,
  reasoning      text,
  source         text NOT NULL DEFAULT 'rule'
    CHECK (source IN ('rule', 'ai', 'manual')),
  rule_id        bigint REFERENCES acct_rules(id),
  confirmed_by   text DEFAULT 'daniel',
  confirmed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acct_confirmations_line_idx ON acct_confirmations (line_ref);
CREATE INDEX IF NOT EXISTS acct_confirmations_queue_idx ON acct_confirmations (queue_item_id);

-- VAT-pack exception flags raised for review before quarter filing.
CREATE TABLE IF NOT EXISTS acct_vat_exceptions (
  id          bigserial PRIMARY KEY,
  period      text NOT NULL,
  line_ref    text,
  amount      numeric,
  currency    text,
  payee       text,
  flag_reason text NOT NULL,
  resolution  text,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acct_vat_period_idx ON acct_vat_exceptions (period);
CREATE INDEX IF NOT EXISTS acct_vat_resolved_idx ON acct_vat_exceptions (resolved_at);

-- FX gain/loss tracking on foreign-currency settlement.
CREATE TABLE IF NOT EXISTS acct_fx_events (
  id             bigserial PRIMARY KEY,
  xero_txn_id    text,
  invoice_ref    text,
  currency       text NOT NULL,
  raise_rate     numeric,
  settle_rate    numeric,
  realised_gbp   numeric,
  account_code   text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acct_fx_txn_idx ON acct_fx_events (xero_txn_id);

-- Invoice matching: links Google Drive files to Xero transactions.
CREATE TABLE IF NOT EXISTS acct_invoice_matches (
  id              bigserial PRIMARY KEY,
  line_ref        text,
  xero_txn_id     text,
  xero_contact    text,
  invoice_date    date,
  amount          numeric,
  currency        text,
  drive_file_id   text UNIQUE,
  drive_file_name text,
  drive_file_url  text,
  mime_type       text,
  attached_to_xero boolean NOT NULL DEFAULT false,
  xero_attachment_id text,
  match_confidence numeric,
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'matched', 'attached', 'missing', 'manual')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acct_invoice_line_idx ON acct_invoice_matches (line_ref);
CREATE INDEX IF NOT EXISTS acct_invoice_xero_idx ON acct_invoice_matches (xero_txn_id);

-- Tax deadline awareness.
CREATE TABLE IF NOT EXISTS acct_tax_deadlines (
  id           bigserial PRIMARY KEY,
  tax_type     text NOT NULL CHECK (tax_type IN ('VAT', 'CT600', 'PAYE', 'SA', 'OTHER')),
  period_label text NOT NULL,
  due_date     date NOT NULL,
  filing_date  date,
  payment_date date,
  status       text NOT NULL DEFAULT 'upcoming'
    CHECK (status IN ('upcoming', 'in_progress', 'preparing', 'ready', 'filed', 'paid', 'overdue')),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tax_type, period_label)
);
CREATE INDEX IF NOT EXISTS acct_deadlines_due_idx ON acct_tax_deadlines (due_date);

-- Weekly digest log.
CREATE TABLE IF NOT EXISTS acct_digests (
  id           bigserial PRIMARY KEY,
  period_start date NOT NULL,
  period_end   date NOT NULL,
  summary      jsonb,
  items_reconciled int DEFAULT 0,
  items_pending    int DEFAULT 0,
  invoices_missing int DEFAULT 0,
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_start, period_end)
);
