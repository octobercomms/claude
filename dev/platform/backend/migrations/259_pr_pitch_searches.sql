-- Saved "who should I pitch this to" searches, per client.
--
-- Distinct from pr_coverage_searches (migration 072), which is the coverage
-- MONITOR: a standing query run on a cadence against Google News and Alerts
-- RSS, whose hits land in pr_editorial_log for review. This table is the
-- opposite direction — a pitch you ran by hand against your own contacts,
-- kept so you can run it again. Two tables with "searches" in the name is a
-- trap, so the names say which way each one points.
--
-- Only the query is stored, not the results. The whole reason to re-run one is
-- that the answer changes as the contact database learns new beats and
-- bylines, so a stored result set would be the stale half of the pair. Telling
-- an operator what is NEW since the last run needs a record of who came back
-- each time; that is a second table, and it can be added without touching this
-- one.

CREATE TABLE IF NOT EXISTS pr_pitch_searches (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label        VARCHAR(200)  NOT NULL DEFAULT '',
  url          VARCHAR(2000) NOT NULL DEFAULT '',
  brief        TEXT          NOT NULL DEFAULT '',
  created_by   VARCHAR(255),
  last_run_at  TIMESTAMPTZ,
  run_count    INTEGER       NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- The list the screen asks for: this client's, most recently run first so the
-- one being worked on is at the top rather than the oldest one.
CREATE INDEX IF NOT EXISTS pr_pitch_searches_client_idx
  ON pr_pitch_searches (client_id, COALESCE(last_run_at, created_at) DESC);

CREATE TRIGGER update_pr_pitch_searches_updated_at BEFORE UPDATE ON pr_pitch_searches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE pr_pitch_searches IS
  'Saved pitch-target searches (the Match screen). Not the coverage monitor — that is pr_coverage_searches.';
