-- October Accounting Support - initial schema.
-- Single-tenant internal tool. All money/tax state is auditable by design:
-- the rules table is the learned memory, confirmations are the audit trail.

CREATE TABLE IF NOT EXISTS xero_connections (
  tenant_id     text PRIMARY KEY,
  tenant_name   text NOT NULL,
  access_token  text NOT NULL,          -- encrypted at rest (AES-256-GCM)
  refresh_token text NOT NULL,          -- encrypted; rotates on every refresh
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- The learned memory. A rule hit is deterministic: no AI call.
CREATE TABLE IF NOT EXISTS rules (
  id              bigserial PRIMARY KEY,
  payee_pattern   text NOT NULL,        -- normalised match against the bank line
  match_type      text NOT NULL DEFAULT 'contains',  -- contains | exact | regex
  account_code    text NOT NULL,        -- Xero chart-of-accounts code
  tax_rate        text,                 -- Xero tax type, e.g. OUTPUT2 / INPUT2 / NONE
  currency        text,                 -- GBP | USD | EUR | null (any)
  confidence      numeric NOT NULL DEFAULT 1.0,
  times_confirmed int NOT NULL DEFAULT 1,
  last_seen       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rules_payee_idx ON rules (payee_pattern);

-- Every confirmation, for audit and for training the rules store.
CREATE TABLE IF NOT EXISTS confirmations (
  id             bigserial PRIMARY KEY,
  line_ref       text NOT NULL,         -- Xero bank transaction / statement line id
  proposed_code  text,
  proposed_rate  text,
  confirmed_code text NOT NULL,
  confirmed_rate text,
  reasoning      text,                  -- AI reasoning when the long tail proposed it
  source         text NOT NULL DEFAULT 'rule',  -- rule | ai
  confirmed_at   timestamptz NOT NULL DEFAULT now()
);

-- Work list surfaced in the review queue.
CREATE TABLE IF NOT EXISTS reconcile_queue (
  id             bigserial PRIMARY KEY,
  line_ref       text UNIQUE NOT NULL,
  bank_account   text,
  line_date      date,
  amount         numeric,
  currency       text,
  description    text,
  suggested_code text,
  suggested_rate text,
  confidence     numeric,
  status         text NOT NULL DEFAULT 'pending',  -- pending | confirmed | written
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- VAT-pack exceptions raised for review before the quarter is filed.
CREATE TABLE IF NOT EXISTS vat_exceptions (
  id          bigserial PRIMARY KEY,
  period      text NOT NULL,            -- e.g. 2026-Q2
  line_ref    text,
  flag_reason text NOT NULL,            -- reverse charge, no receipt, wrong rate, etc.
  resolution  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Realised FX gain/loss on foreign-currency settlement (GBP/USD/EUR).
CREATE TABLE IF NOT EXISTS fx_events (
  id             bigserial PRIMARY KEY,
  invoice_ref    text,
  currency       text,
  raise_rate     numeric,
  settle_rate    numeric,
  realised_gbp   numeric,
  account_code   text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
