# Marketing playbooks

Distilled, prompt-ready marketing methodology fragments. Each `*.md` here is a
**condensed** version of one skill from
[coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)
(**MIT License**) — trimmed to what's useful inside a system prompt without
bloating the token budget. The full skills are also installed at
`.claude/skills/` in the repo for human/editor use; these are the runtime
fragments.

Loaded by `src/services/playbooks.js` (`getPlaybook(name)` /
`getPlaybooks([names])`) and injected into the Claude-backed services' system
prompts. See `docs/omi/external-integrations-plan.md` → Integration 3 for
the service → playbook mapping and which slice wires each one.

## Current fragments (first batch)

| Playbook | Source skill | Wired into (planned) |
|---|---|---|
| `copywriting.md` | copywriting, copy-editing | contentDraft, socialCaptions |
| `content-strategy.md` | content-strategy | contentDraft, programmaticBriefs |
| `ads.md` | ads, ad-creative, analytics | strategistReport |
| `meta-audiences.md` | October house methodology (`docs/anothercountry-meta-targeting`) | strategistReport, AudiencesPanel |
| `eeat.md` | claude-seo + seranking/seo-skills (`docs/omi/seo-skills-integration-plan`) | contentAudit, contentDraft |
| `sxo.md` | claude-seo + seranking/seo-skills (`docs/omi/seo-skills-integration-plan`) | seoSxo |
| `cro.md` | cro, popups, signup | siteAudit, ctrBoost |
| `cold-email.md` | cold-email, prospecting | outreachAi, backlinkProspect |
| `seo-audit.md` | seo-audit, ai-seo, schema | seoFanout, contentAudit |
| `trust-brokering.md` | 2026 Edelman Trust Barometer (public findings) | contentAudit, strategistReport, strategyTemplates |

## Adding a playbook

1. Distil the relevant `.claude/skills/<name>/SKILL.md` into a concise fragment
   (keep it imperative and short — it's appended to a prompt, not read by a
   human). Lead with the `<!-- Distilled from … (MIT) -->` attribution comment.
2. Drop it in this folder as `<name>.md`.
3. Reference it from the relevant service via `getPlaybook('<name>')`.

Keep fragments lean: methodology and decision rules, not exhaustive checklists.
