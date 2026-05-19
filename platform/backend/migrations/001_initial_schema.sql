-- Initial schema for October Performance Marketing Platform

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enum types
CREATE TYPE connector_type_enum AS ENUM (
  'ga4', 'google_search_console', 'google_ads', 'google_merchant_center',
  'meta_ads', 'instagram_insights', 'shopify', 'woocommerce',
  'klaviyo', 'brevo', 'shopify_email', 'amazon_seller', 'dataforseo'
);

CREATE TYPE connector_status_enum AS ENUM ('active', 'expired', 'error', 'disconnected');
CREATE TYPE report_type_enum AS ENUM ('monthly', 'weekly');
CREATE TYPE report_status_enum AS ENUM ('pending', 'generating', 'generated', 'sending', 'sent', 'failed');

-- Clients
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  briefing_field TEXT,
  monthly_focus TEXT,
  report_recipients JSONB NOT NULL DEFAULT '{"monthly": [], "weekly": []}',
  report_schedule JSONB NOT NULL DEFAULT '{"weekly_day": "monday", "weekly_time": "10:00", "monthly_day": 1}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Connectors
CREATE TABLE connectors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  connector_type connector_type_enum NOT NULL,
  credentials JSONB NOT NULL DEFAULT '{}',
  store_label VARCHAR(255),
  status connector_status_enum NOT NULL DEFAULT 'disconnected',
  last_checked TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_connectors_client_id ON connectors(client_id);
CREATE INDEX idx_connectors_type ON connectors(connector_type);

-- Reports
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  report_type report_type_enum NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status report_status_enum NOT NULL DEFAULT 'pending',
  generated_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  pdf_path TEXT,
  html_path TEXT,
  html_content TEXT,
  error_log TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reports_client_id ON reports(client_id);
CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_created_at ON reports(created_at DESC);

-- Monthly focus history
CREATE TABLE monthly_focus_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year SMALLINT NOT NULL,
  focus_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, month, year)
);

CREATE INDEX idx_monthly_focus_client_id ON monthly_focus_history(client_id);

-- SEO Keywords
CREATE TABLE seo_keywords (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  keyword VARCHAR(500) NOT NULL,
  target_url TEXT,
  device VARCHAR(10) NOT NULL DEFAULT 'desktop' CHECK (device IN ('desktop', 'mobile')),
  tag VARCHAR(100),
  location_code INT NOT NULL DEFAULT 2826,
  location_name VARCHAR(255) NOT NULL DEFAULT 'United Kingdom',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_seo_keywords_client_id ON seo_keywords(client_id);

-- SEO Rank History
CREATE TABLE seo_rank_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  keyword_id UUID NOT NULL REFERENCES seo_keywords(id) ON DELETE CASCADE,
  checked_at DATE NOT NULL DEFAULT CURRENT_DATE,
  position INT,
  url TEXT,
  UNIQUE(keyword_id, checked_at)
);

CREATE INDEX idx_seo_rank_history_keyword_id ON seo_rank_history(keyword_id);
CREATE INDEX idx_seo_rank_history_checked_at ON seo_rank_history(checked_at DESC);

-- Migrations tracking
CREATE TABLE schema_migrations (
  version VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_connectors_updated_at BEFORE UPDATE ON connectors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reports_updated_at BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
