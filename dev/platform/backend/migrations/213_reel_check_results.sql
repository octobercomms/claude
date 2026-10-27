-- What the reel checks said about a reel, recorded when the reel was made.
--
-- The seven checks in shared/reelChecks.mjs are rules from October's growth
-- plan, and the panel that shows them says on screen that they are reasoned
-- assumptions rather than measurements. They can only stop being assumptions if
-- what they said is written down at the time and put beside what the reel went
-- on to do. Until this table, the checks ran in the browser and were forgotten
-- on the next keystroke, so no amount of engagement data could ever test them.
--
-- One row per reel produced, not per keystroke. The check result is taken at
-- the moment of production, which is the last point at which the operator has
-- decided everything and the first at which the reel is a real thing.
--
-- rules_fingerprint is the load-bearing column. A recorded pass only means
-- something next to the rules that granted it, so adding one word to the hype
-- list splits the population in two. The learner pools one fingerprint at a
-- time and counts what it excluded; without this column it would silently
-- average across rule sets and report the result as a measurement.

CREATE TABLE IF NOT EXISTS reel_check_results (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- The reel this judged. Both are nullable and for different reasons: an
  -- asset row can be absent when the library write failed (assets.record never
  -- throws at its caller), and a post is absent when the reel was produced
  -- outside a post. A row with neither is still worth keeping as a record of
  -- what was produced; it simply cannot join to performance.
  asset_id      UUID REFERENCES client_assets(id) ON DELETE SET NULL,
  post_id       UUID REFERENCES social_posts(id) ON DELETE SET NULL,

  -- [{ key, pass }] for every check, where pass is true, false or null. Null is
  -- kept rather than dropped: "could not judge" is not "failed", and the
  -- learner must be able to tell them apart.
  checks        JSONB NOT NULL,
  passed        INT NOT NULL DEFAULT 0,
  unknown       INT NOT NULL DEFAULT 0,
  total         INT NOT NULL DEFAULT 0,

  rules_fingerprint TEXT NOT NULL,

  -- Carried for cuts the learner cannot make from the checks alone: whether a
  -- template was in use, how long the reel ran, how much was said.
  duration_s    NUMERIC(10,2),
  words         INT,
  template      TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One judgement per asset. A second render of the same asset replaces it,
-- rather than giving one reel two votes in a median.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reel_check_results_asset
  ON reel_check_results(asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reel_check_results_client
  ON reel_check_results(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reel_check_results_post
  ON reel_check_results(post_id) WHERE post_id IS NOT NULL;

COMMENT ON TABLE reel_check_results IS
  'The reel checks as they stood when a reel was produced, so the rules can be '
  'tested against what the reels did rather than trusted.';
