-- Per-call API cost log. Until now the only spend visibility was the nightly
-- usage_snapshots poll (a balance/total per provider) — fine for "is the
-- bill rising?" but useless for "what feature is burning through credits?".
--
-- Every paid API call appends a row here with: provider (anthropic /
-- dataforseo / serper / hunter / replicate / …), feature (a short label the
-- AM understands — 'chat', 'report_narrative', 'contact_tidy', etc.), the
-- estimated cost in USD, and optional client_id so cost can be attributed
-- per client. meta is a JSONB grab-bag for model / tokens / input bytes /
-- whatever else helps debug a surprise bill.

CREATE TABLE IF NOT EXISTS api_cost_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider    VARCHAR(40)  NOT NULL,
  feature     VARCHAR(80)  NOT NULL,
  cost_usd    NUMERIC(12, 6) NOT NULL DEFAULT 0,
  client_id   UUID REFERENCES clients(id) ON DELETE SET NULL,
  meta        JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS api_cost_events_ts_idx ON api_cost_events (ts DESC);
CREATE INDEX IF NOT EXISTS api_cost_events_provider_idx ON api_cost_events (provider, ts DESC);
CREATE INDEX IF NOT EXISTS api_cost_events_feature_idx ON api_cost_events (feature, ts DESC);
CREATE INDEX IF NOT EXISTS api_cost_events_client_idx ON api_cost_events (client_id, ts DESC) WHERE client_id IS NOT NULL;
