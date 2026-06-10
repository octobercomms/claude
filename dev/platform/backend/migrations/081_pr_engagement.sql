-- Contacts intelligence phase 7: engagement nudges. The old PR trick — read a
-- key journalist's article and send a genuine "enjoyed your piece" note — done
-- for you: the platform surfaces fresh bylines from your priority journalists
-- (tier 1 / strong relationship) and offers a Claude-drafted, article-specific
-- note you approve and send. One row per surfaced article.

CREATE TABLE IF NOT EXISTS pr_engagement (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id    UUID REFERENCES outreach_contacts(id) ON DELETE CASCADE,
  article_url   VARCHAR(1000) NOT NULL DEFAULT '',
  article_title VARCHAR(600) NOT NULL DEFAULT '',
  article_date  VARCHAR(60) NOT NULL DEFAULT '',
  status        VARCHAR(20) NOT NULL DEFAULT 'new', -- new / sent / dismissed
  body_excerpt  TEXT NOT NULL DEFAULT '',           -- no-repeat memory
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS pr_engagement_status_idx ON pr_engagement (status);
CREATE INDEX IF NOT EXISTS pr_engagement_contact_idx ON pr_engagement (contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS pr_engagement_contact_url_idx ON pr_engagement (contact_id, article_url);
