-- Integration A — E‑E‑A‑T + CITE content rubric.
--
-- Extends the Claude-graded content audit with a structured E‑E‑A‑T
-- (Experience / Expertise / Authoritativeness / Trust) + CITE
-- (citation-readiness) assessment, a deterministic rubric-weighted overall
-- grade, and a publish verdict. Methodology mined (MIT) from
-- AgriciDaniel/claude-seo + seranking/seo-skills — see
-- docs/omi/seo-skills-integration-plan.md.

ALTER TABLE content_audits
  ADD COLUMN IF NOT EXISTS eeat_json JSONB,          -- { factors: {experience,expertise,authoritativeness,trust,cite:{grade,note}}, signals: {...} }
  ADD COLUMN IF NOT EXISTS content_grade VARCHAR(2), -- overall A / B+ / B / C+ / C / F (rubric-weighted)
  ADD COLUMN IF NOT EXISTS publish_verdict VARCHAR(10); -- publish | revise | rework
