-- A batch of videos: one template, many items, one review sheet.
--
-- Two tables rather than a column on `compositions`, for a reason worth
-- writing down: AN ITEM OF A BATCH MAY HAVE NO COMPOSITION. The pre-flight
-- blocks an item whose content is short — six photographs asked for, four
-- supplied — and a blocked item still has to appear on the review sheet,
-- saying what it needs, so the operator can go and fix it. A `batch_id` on
-- `compositions` cannot represent something that has no composition, and a
-- batch that silently contained twenty-six rows where thirty were submitted
-- is the exact failure the pre-flight exists to prevent.
--
-- So `composition_batch_items` is the sheet's own row, and it carries the
-- three things a composition cannot:
--
--   ref       where the item came from, untouched: a social_posts id, a
--             filename, an index. The sheet links a row back to its source.
--   problems  why it cannot run, as the pre-flight's own list, so the sheet
--             says "needs 6 photographs and has 4" rather than "failed".
--   verdict   approved, rejected, or not yet looked at. Nothing leaves for
--             Drive or Instagram unapproved.
--
-- What is deliberately NOT here is a status column. An item's live state is
-- its render's state, and a copy of it in a second table is a copy that goes
-- stale: the render row is updated by whatever is encoding, which has no
-- reason to know about batches. The read joins instead.

CREATE TABLE IF NOT EXISTS composition_batches (
  id          SERIAL PRIMARY KEY,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  template_id TEXT NOT NULL,
  -- The seed is what makes a batch reproducible on timing and treatment, so a
  -- re-run after fixing one item does not re-cut the twenty-nine that were
  -- fine. Stored, because a seed nobody recorded is a seed nobody can reuse.
  seed        TEXT NOT NULL DEFAULT '',
  brief       TEXT,
  -- What the operator was shown before committing. Kept so that "actual
  -- against estimate" is a real comparison afterwards rather than a guess,
  -- which is what stops the cost table quietly going stale.
  estimate_usd NUMERIC(10,4),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comp_batches_client
  ON composition_batches (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS composition_batch_items (
  id             SERIAL PRIMARY KEY,
  batch_id       INTEGER NOT NULL REFERENCES composition_batches(id) ON DELETE CASCADE,
  -- The item's place in the batch, which is also the variation index: item 7
  -- always gets item 7's pacing and camera move for a given seed.
  idx            INTEGER NOT NULL,
  ref            TEXT,
  -- NULL for an item the pre-flight blocked. ON DELETE SET NULL rather than
  -- CASCADE: deleting a composition should not delete the record that the
  -- batch once produced it.
  composition_id INTEGER REFERENCES compositions(id) ON DELETE SET NULL,
  render_id      INTEGER REFERENCES composition_renders(id) ON DELETE SET NULL,
  problems       JSONB NOT NULL DEFAULT '[]'::jsonb,
  verdict        TEXT NOT NULL DEFAULT 'pending'
                 CHECK (verdict IN ('pending', 'approved', 'rejected')),
  verdict_note   TEXT,
  verdict_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  verdict_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, idx)
);

CREATE INDEX IF NOT EXISTS idx_comp_batch_items_batch
  ON composition_batch_items (batch_id, idx);

-- The sheet's one filter that is worth an index: what still needs looking at.
CREATE INDEX IF NOT EXISTS idx_comp_batch_items_pending
  ON composition_batch_items (batch_id)
  WHERE verdict = 'pending';

-- Where a composition came from.
--
-- Not strictly needed — composition_batch_items already points at it — but the
-- editor opens a composition on its own, with no batch in hand, and a
-- composition that cannot say it belongs to a batch cannot offer to take you
-- back to the sheet. `template_id` is the same argument: the editor can say
-- which shape produced this timeline.
ALTER TABLE compositions
  ADD COLUMN IF NOT EXISTS batch_id    INTEGER REFERENCES composition_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_id TEXT;

CREATE INDEX IF NOT EXISTS idx_compositions_batch
  ON compositions (batch_id)
  WHERE batch_id IS NOT NULL;
