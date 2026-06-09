-- Journalist thank-you engine: what was sent (no-repeat memory + audit) and the
-- approve/edit/reject feedback signal (drives the future auto-send ramp).

CREATE TABLE IF NOT EXISTS pr_sent_thanks (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id        UUID REFERENCES pr_contacts(id) ON DELETE CASCADE,
  editorial_log_id  UUID REFERENCES pr_editorial_log(id) ON DELETE CASCADE,
  tone              VARCHAR(60) NOT NULL DEFAULT '',
  body_excerpt      TEXT NOT NULL DEFAULT '',
  confidence        NUMERIC(4,3) NOT NULL DEFAULT 0,
  sent_by           UUID,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pr_sent_thanks_contact_idx ON pr_sent_thanks (contact_id);
CREATE INDEX IF NOT EXISTS pr_sent_thanks_entry_idx ON pr_sent_thanks (editorial_log_id);

CREATE TABLE IF NOT EXISTS pr_thank_feedback (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  editorial_log_id  UUID REFERENCES pr_editorial_log(id) ON DELETE CASCADE,
  contact_id        UUID REFERENCES pr_contacts(id) ON DELETE CASCADE,
  claude_confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
  decision          VARCHAR(20) NOT NULL DEFAULT '',
  decided_by        UUID,
  decided_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pr_thank_feedback_entry_idx ON pr_thank_feedback (editorial_log_id);
