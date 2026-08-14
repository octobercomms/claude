-- Unified cross-PESO Strategist briefing: one weekly per-client report with a
-- per-pillar expert analysis (Paid / Earned / Shared / Owned) plus a synthesis
-- and a single prioritised task list tagged by pillar. Generalises the ads-only
-- strategist_reports into a whole-client briefing. See services/strategist/.

CREATE TABLE IF NOT EXISTS strategist_briefings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_start  DATE,
  period_end    DATE,
  status        TEXT NOT NULL DEFAULT 'generating', -- generating | completed | failed
  trigger       TEXT,                                -- manual | weekly_cron
  synthesis     TEXT,                                -- client-level briefing (markdown)
  sections      JSONB NOT NULL DEFAULT '[]',         -- [{pillar,title,markdown,ok,error}]
  data_snapshot JSONB,                               -- the data each pillar used
  error_message TEXT,
  read_at       TIMESTAMPTZ,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_strat_briefings_client
  ON strategist_briefings (client_id, generated_at DESC);

-- One prioritised task list across the whole account, each item tagged by the
-- pillar it belongs to (so the UI can filter to just Owned, etc.) and by
-- priority (crucial vs nice-to-have). AM ticks them off; the next briefing can
-- grade follow-through.
CREATE TABLE IF NOT EXISTS strategist_briefing_recommendations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  briefing_id UUID NOT NULL REFERENCES strategist_briefings(id) ON DELETE CASCADE,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  pillar      TEXT NOT NULL,                    -- paid | earned | shared | owned | cross
  priority    TEXT NOT NULL DEFAULT 'nice',     -- crucial | nice
  position    INTEGER NOT NULL DEFAULT 0,
  text        TEXT NOT NULL,
  done        BOOLEAN NOT NULL DEFAULT false,
  done_at     TIMESTAMPTZ,
  done_by     UUID,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_strat_brief_recs
  ON strategist_briefing_recommendations (briefing_id, pillar, position);

-- Weekly-email opt-out: clients set inactive are skipped by the Monday cron.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS strategist_active BOOLEAN NOT NULL DEFAULT true;
