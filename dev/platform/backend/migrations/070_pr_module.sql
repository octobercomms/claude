-- PR module (native) — editorial log, media database (outlets + journalists),
-- owned by the platform so it runs without the WordPress plugin. Coverage is
-- linked to a client by FK (clients.id), not a free-text name.

CREATE TABLE IF NOT EXISTS pr_outlets (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(300) NOT NULL,
  canonical_name  VARCHAR(300) NOT NULL DEFAULT '',
  aliases         JSONB NOT NULL DEFAULT '[]',
  domain          VARCHAR(255) NOT NULL DEFAULT '',
  tier            VARCHAR(50) NOT NULL DEFAULT '',
  region          VARCHAR(100) NOT NULL DEFAULT '',
  summary         TEXT NOT NULL DEFAULT '',
  status          VARCHAR(30) NOT NULL DEFAULT 'active',
  merged_into     UUID REFERENCES pr_outlets(id) ON DELETE SET NULL,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pr_outlets_name_idx ON pr_outlets (lower(name));
CREATE INDEX IF NOT EXISTS pr_outlets_status_idx ON pr_outlets (status);

CREATE TABLE IF NOT EXISTS pr_contacts (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name           VARCHAR(120) NOT NULL DEFAULT '',
  last_name            VARCHAR(120) NOT NULL DEFAULT '',
  email                VARCHAR(255) NOT NULL DEFAULT '',
  outlet_id            UUID REFERENCES pr_outlets(id) ON DELETE SET NULL,
  segment              VARCHAR(20) NOT NULL DEFAULT 'media',
  beats                JSONB NOT NULL DEFAULT '[]',
  location             VARCHAR(200) NOT NULL DEFAULT '',
  bio_link             VARCHAR(500) NOT NULL DEFAULT '',
  photo_url            VARCHAR(500) NOT NULL DEFAULT '',
  availability_status  VARCHAR(30) NOT NULL DEFAULT 'active',
  available_from       DATE,
  last_contacted       DATE,
  notes                TEXT NOT NULL DEFAULT '',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pr_contacts_name_idx ON pr_contacts (lower(first_name), lower(last_name));
CREATE INDEX IF NOT EXISTS pr_contacts_email_idx ON pr_contacts (lower(email));
CREATE INDEX IF NOT EXISTS pr_contacts_outlet_idx ON pr_contacts (outlet_id);

CREATE TABLE IF NOT EXISTS pr_editorial_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  story_title     VARCHAR(500) NOT NULL DEFAULT '',
  contact_id      UUID REFERENCES pr_contacts(id) ON DELETE SET NULL,
  outlet_id       UUID REFERENCES pr_outlets(id) ON DELETE SET NULL,
  country         VARCHAR(100) NOT NULL DEFAULT '',
  status          VARCHAR(40) NOT NULL DEFAULT 'pitched',
  pitch_request   TEXT NOT NULL DEFAULT '',
  request_date    DATE,
  interview_date  DATE,
  issue_date      DATE,
  story_url       VARCHAR(1000) NOT NULL DEFAULT '',
  notes_outcome   TEXT NOT NULL DEFAULT '',
  source          VARCHAR(30) NOT NULL DEFAULT 'manual',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pr_editorial_log_client_idx ON pr_editorial_log (client_id);
CREATE INDEX IF NOT EXISTS pr_editorial_log_status_idx ON pr_editorial_log (status);
CREATE INDEX IF NOT EXISTS pr_editorial_log_contact_idx ON pr_editorial_log (contact_id);
CREATE INDEX IF NOT EXISTS pr_editorial_log_outlet_idx ON pr_editorial_log (outlet_id);

CREATE TRIGGER update_pr_outlets_updated_at BEFORE UPDATE ON pr_outlets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_pr_contacts_updated_at BEFORE UPDATE ON pr_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_pr_editorial_log_updated_at BEFORE UPDATE ON pr_editorial_log
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
