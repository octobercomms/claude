-- A media list: the journalists you picked for one story, kept.
--
-- Called a media list rather than a saved search because Earned already has
-- saved searches, two rows away in the same section: pr_coverage_searches,
-- the coverage monitor, a standing query run on a cadence against the open
-- web. One section with two meanings for one phrase makes "re-run the saved
-- search" ambiguous for everyone who works here. Media list is the industry's
-- own word and does not collide with "audience", which in OMI means a list
-- attached to a release and locked for sending.
--
-- Two tables, because a list is two different things at once.
--
-- The QUERY is what makes re-running meaningful: the answer changes as the
-- contact database learns new beats and bylines, and that change is the whole
-- point of opening a list again in March.
--
-- The MEMBERS are a record, not a cache. You pitched those twelve people, and
-- who you pitched must not change retroactively because the database learned
-- something after you sent it. Keeping them is also what lets a re-run say
-- what is new since last time, which is the question a PR person actually has
-- and which a stored query alone cannot answer.

CREATE TABLE IF NOT EXISTS media_lists (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name          VARCHAR(200)  NOT NULL DEFAULT '',
  -- How the story was given, so a re-run reproduces the same search. A list
  -- built from a release in OMI keeps the id as well as the text, so it can
  -- say which release it came from after the text has been edited.
  release_id    UUID,
  source_url    VARCHAR(2000) NOT NULL DEFAULT '',
  source_text   TEXT          NOT NULL DEFAULT '',
  -- 'semantic' or 'keyword' at the time it was built. A list made before an
  -- OpenAI key was added was ranked a different way, and its fit figures mean
  -- something different, so the mode travels with it.
  mode          VARCHAR(20),
  created_by    VARCHAR(255),
  last_run_at   TIMESTAMPTZ,
  run_count     INTEGER       NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Most recently run first: the list being worked on, not the oldest one.
CREATE INDEX IF NOT EXISTS media_lists_client_idx
  ON media_lists (client_id, COALESCE(last_run_at, created_at) DESC);

CREATE TABLE IF NOT EXISTS media_list_members (
  list_id     UUID NOT NULL REFERENCES media_lists(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES outreach_contacts(id) ON DELETE CASCADE,
  rank        INTEGER,
  fit         INTEGER,
  reason      TEXT,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (list_id, contact_id)
);

CREATE INDEX IF NOT EXISTS media_list_members_list_idx ON media_list_members (list_id);

CREATE TRIGGER update_media_lists_updated_at BEFORE UPDATE ON media_lists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE media_lists IS
  'Saved Match results: the journalists picked for one story. Not the coverage monitor, which is pr_coverage_searches.';
COMMENT ON TABLE media_list_members IS
  'Who was on the list when it was saved. A record of what was sent, not a cache of the query.';
