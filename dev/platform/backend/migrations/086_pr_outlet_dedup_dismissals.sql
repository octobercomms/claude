-- Outlet dedup dismissals. When the Find Duplicates scan suggests two
-- publications are the same and the AM says "no, they're different country
-- editions of Vogue", remember that decision so the scan doesn't surface the
-- same pair again. Without this every scan re-suggests every false-positive
-- the AM already rejected.
--
-- Pair stored in canonical (lower, higher) order so the lookup is symmetric
-- regardless of which side appeared as the suggested canonical.

CREATE TABLE IF NOT EXISTS pr_outlet_dedup_dismissals (
  outlet_a       UUID NOT NULL REFERENCES pr_outlets(id) ON DELETE CASCADE,
  outlet_b       UUID NOT NULL REFERENCES pr_outlets(id) ON DELETE CASCADE,
  dismissed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dismissed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (outlet_a, outlet_b),
  CHECK (outlet_a < outlet_b)
);

CREATE INDEX IF NOT EXISTS pr_outlet_dedup_dismissals_b_idx ON pr_outlet_dedup_dismissals (outlet_b);
