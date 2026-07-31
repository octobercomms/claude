-- Give drafts a real SEO title + slug of their own, distinct from the H1.
-- Until now the draft's meta_description was mechanically truncated from the
-- first paragraph and there was no meta_title or slug at all — so the polished
-- meta the strategist wrote in the brief was thrown away. The draft generator
-- now carries brief.meta_title / meta_description / slug straight onto the draft.

ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS meta_title TEXT;
ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS slug TEXT;
