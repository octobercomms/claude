-- OMI Selective Outreach ("Prospecting") — multi-tenant outbound module.
-- The approval queue is the product: nothing sends unreviewed. See
-- docs/platform/outreach/PLAN.md. Namespaced `prospecting_*` to avoid colliding
-- with the existing outreach_* / leads features.

-- A campaign scopes an ICP, its scoring/disqualifier rules, a sending identity,
-- and a sequence. Org-level per client (client_id), agency-staff managed.
CREATE TABLE IF NOT EXISTS prospecting_campaigns (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID REFERENCES clients(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft',      -- draft | active | paused
  icp             TEXT,                               -- free-text ICP description
  disqualifiers   TEXT,                               -- e.g. "is a PR/marketing agency"
  sender_identity_id UUID,                            -- FK set below (nullable until configured)
  booking_url     TEXT,                               -- the sender's REAL Cal.com/Calendly link
  daily_cap       INT NOT NULL DEFAULT 20,            -- max sends/day for this campaign
  sequence        JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{step, wait_days, angle}]
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A dedicated sending identity: one real person on one dedicated (non-primary)
-- domain. auth_ok gates sending until SPF/DKIM/DMARC are verified on the box.
CREATE TABLE IF NOT EXISTS prospecting_identities (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     UUID REFERENCES clients(id) ON DELETE CASCADE,
  from_name     TEXT NOT NULL,
  from_email    TEXT NOT NULL,                        -- on a dedicated domain, never the primary
  postal_address TEXT,                                -- required in every message (CAN-SPAM/PECR)
  smtp_json     JSONB,                                -- optional per-identity SMTP creds; else default transport
  auth_ok       BOOLEAN NOT NULL DEFAULT false,       -- SPF/DKIM/DMARC verified — required to send
  warmed        BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE prospecting_campaigns
  ADD CONSTRAINT prospecting_campaigns_identity_fk
  FOREIGN KEY (sender_identity_id) REFERENCES prospecting_identities(id) ON DELETE SET NULL;

-- One row per prospect. source = auto (AI-sourced) | csv | manual — provenance
-- always visible. fit_score + reasoning are stored, never hidden.
CREATE TABLE IF NOT EXISTS prospecting_prospects (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id   UUID NOT NULL REFERENCES prospecting_campaigns(id) ON DELETE CASCADE,
  company       TEXT,
  contact_name  TEXT,
  email         TEXT,
  role          TEXT,
  website       TEXT,
  source        TEXT NOT NULL DEFAULT 'manual',       -- auto | csv | manual
  source_url    TEXT,                                 -- where the AI found them (provenance)
  fit_score     INT,                                  -- 0-100
  fit_verdict   TEXT,                                 -- fit | maybe | disqualified
  fit_reasoning TEXT,
  one_fact      TEXT,                                 -- the specific detail drafting should use
  state         TEXT NOT NULL DEFAULT 'new',          -- new|approved|dismissed|sequenced|replied|opted_out|booked
  dismiss_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prospecting_prospects_campaign ON prospecting_prospects (campaign_id, state);

-- Every message — outbound draft/sent and inbound replies + their AI-drafted
-- responses. Nothing sends until state = approved → sent by a human action.
CREATE TABLE IF NOT EXISTS prospecting_messages (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prospect_id   UUID NOT NULL REFERENCES prospecting_prospects(id) ON DELETE CASCADE,
  direction     TEXT NOT NULL,                        -- out | in
  step          INT,                                  -- sequence step for outbound
  subject       TEXT,
  body          TEXT,
  state         TEXT NOT NULL DEFAULT 'pending',      -- pending|approved|sent|skipped|received
  approved_by   TEXT,
  scheduled_at  TIMESTAMPTZ,                          -- when an approved message is due to send
  sent_at       TIMESTAMPTZ,
  content_hash  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prospecting_messages_prospect ON prospecting_messages (prospect_id);
CREATE INDEX IF NOT EXISTS idx_prospecting_messages_due ON prospecting_messages (state, scheduled_at);

-- Permanent suppression — checked at BOTH scoring and send. Opt-outs, existing
-- clients, and disqualifying-category entities can never be contacted.
CREATE TABLE IF NOT EXISTS prospecting_suppression (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,
  value       TEXT NOT NULL,                          -- email or domain (lowercased)
  kind        TEXT NOT NULL DEFAULT 'email',          -- email | domain
  reason      TEXT,                                   -- opted_out | client | manual | disqualified
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, value)
);

-- Append-only audit of every consequential action.
CREATE TABLE IF NOT EXISTS prospecting_audit (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   UUID,
  actor       TEXT,
  action      TEXT NOT NULL,                          -- approve|send|skip|dismiss|opt_out|source|...
  entity      TEXT,                                   -- prospect|message|campaign
  entity_id   UUID,
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prospecting_audit_client ON prospecting_audit (client_id, created_at DESC);

-- Public opt-out tokens (the List-Unsubscribe / "don't email me again" link).
CREATE TABLE IF NOT EXISTS prospecting_optout_tokens (
  token       TEXT PRIMARY KEY,
  prospect_id UUID NOT NULL REFERENCES prospecting_prospects(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
