-- Share a finished reel with a client, on the approval machinery that already
-- exists.
--
-- `027_video_audio_approval.sql` is literally named for this and has carried
-- social posts and ad creatives since. What stopped a reel going through it
-- was two columns, not a system: the brief's decision 9 recorded Share as "a
-- backend story. Do not ship the button ahead of the thing", which was wrong
-- on the facts. `routes/approvals.js` is a live token-gated client view with
-- per-item approve, request-changes and comment, and its public file proxy
-- already streams `uploads/<client>/…` to a logged-out reviewer — which is
-- exactly where `compositionRenderRunner` writes `render-<comp>-<render>.mp4`.
--
-- What a link carries is RENDERS, not compositions, and the distinction is
-- the point. A composition keeps being edited; a render is the file that was
-- actually made. Sharing the composition would mean the thing the client
-- approved on Tuesday is not the thing they see on Thursday, with no record
-- of the difference. `composition_renders` rows are immutable once done, so a
-- link means "these files", for good.
--
-- `post_ids` could not be reused: it is UUID[] and `compositions.id` and
-- `composition_renders.id` are SERIAL.

ALTER TABLE approval_links
  ADD COLUMN IF NOT EXISTS render_ids INTEGER[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN approval_links.render_ids IS
  'composition_renders ids when scope = render_list. The scope column has no CHECK, so render_list needed no constraint change.';

-- A decision against one reel. Nullable like its two siblings, and for the
-- same reason: one responses table serves every scope, and a row names
-- exactly one of post_id, ad_creative_id or composition_render_id.
ALTER TABLE approval_responses
  ADD COLUMN IF NOT EXISTS composition_render_id INTEGER
    REFERENCES composition_renders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_approval_responses_render
  ON approval_responses(composition_render_id)
  WHERE composition_render_id IS NOT NULL;
