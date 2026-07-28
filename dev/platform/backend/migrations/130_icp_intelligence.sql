-- AI Sniper funnel, Phase 1: the ICP Intelligence Pack.
-- One snapshot per client (like client_strategy): a data-first customer-research
-- pack the rest of the funnel consumes. The AM's raw inputs (transcripts /
-- win-loss notes / service description) are stored alongside the generated
-- output so a re-tailor never loses them.

CREATE TABLE IF NOT EXISTS client_icp_intelligence (
  client_id            UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  -- AM-entered raw material the pack is built from.
  inputs               JSONB,       -- { transcripts, notes, service_description }
  -- Generated snapshot.
  awareness_map        JSONB,       -- { stage, rationale, directness }
  sophistication_level INTEGER,     -- 1–5 (Schwartz market sophistication)
  sophistication_note  TEXT,
  voc                  JSONB,       -- { pains:[], desires:[], worldview:[] } (extracted, not invented)
  competitor_angle     TEXT,
  sources              JSONB,       -- [{ kind, label }] — what fed this pack
  sufficiency          JSONB,       -- { sufficient:bool, missing:[...] } — the garbage-in guardrail
  status               TEXT DEFAULT 'draft',  -- draft | insufficient | ready
  generated_at         TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);
