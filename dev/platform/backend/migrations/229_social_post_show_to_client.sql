-- Which posts in a batch the client is shown.
--
-- The same control Paid got in migration 222, for the same reason, asked for
-- in the same words: "Can I uncheck posts I don't want a client to see, and
-- also this filters the list that should appear on the next step?"
--
-- Half of that shipped. The tick on Shared's Review step filtered the next
-- step, but it lived in React state and was never written down, so the
-- approval link — a page the client opens from an email, in another browser,
-- days later — had no way to know about it and showed the whole batch.
-- Daniel, reading it back: "this didnt seem to removal from the client
-- approval link."
--
-- One tick, two effects, which is what was asked for: the column is what the
-- next step reads and what the approval page filters on.
--
-- Default true, because everything is shared today and a migration must not
-- silently hide work from a client already reviewing it.

ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS show_to_client BOOLEAN NOT NULL DEFAULT TRUE;

-- The approval page asks for one batch's shown posts and nothing else.
CREATE INDEX IF NOT EXISTS idx_social_posts_batch_shown
  ON social_posts (batch_id) WHERE show_to_client;

COMMENT ON COLUMN social_posts.show_to_client IS
  'Ticked on Shared > Refine. Filters the client approval link and what the next step acts on. Default true.';
