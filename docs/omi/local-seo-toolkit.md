# Local SEO toolkit

Status: **shipped**. Five on-demand Claude tools in the SEO suite's new
**Local SEO** tab, built from the five local-SEO prompt ideas in the
`SEO_ideas` brief. Each is a paste-input → Claude → structured-result flow with
a per-tool history rail; every run is persisted so any past result re-opens
without a re-run.

## The five tools

| Tool | Tab | Input | Output |
|---|---|---|---|
| Competition Gap Killer | Competition gap | up to 3 competitor URLs (defaults to the client's `competitor_domains`) | content gaps, topics to create, trust gaps + briefing |
| Full Schema Audit | Schema audit | a page URL | existing schema graded useful/weak/broken, missing types by priority, **generated JSON-LD** for high-priority fixes |
| Buyer-Intent Keyword Sniper | Buyer-intent keywords | service + city | 20 high-intent local keywords, intent-tagged, with why each converts |
| Business vs Competitor X-Ray | Competitor X-ray | your URL (defaults to client domain) + up to 3 competitors | services/locations/USPs/trust signals per business, side-by-side comparison, advantages to exploit |
| GBP Post Generator | GBP posts | service + city + optional competitor URL | 10 ready Google Business Profile posts (local keyword + landmark + urgency CTA) + competitor gaps |

## Moving parts

| Piece | Location |
|---|---|
| Service (5 runners + history) | `backend/src/services/localSeo.js` |
| Routes (`/api/seo/clients/:clientId/local-seo/:tool`) | `backend/src/routes/seoSuite.js` (Local SEO section) |
| Storage | migration `088_local_seo.sql` — `local_seo_runs` (one row per run, input+output JSONB) |
| Methodology playbooks | `backend/src/data/marketingPlaybooks/schema.md`, `local-seo.md` |
| UI panel (all five tools) | `frontend/src/components/organic/LocalSeoPanel.jsx` |
| Tab wiring | `frontend/src/pages/ClientSEOPage.jsx` (new `local` top-group + 5 sub-tabs) |

## How it works

- Pages are fetched through the stealth-aware `fetchRenderedHtml` seam (axios →
  FlareSolverr fallback) behind the `assertPublicHttpUrl` SSRF guard, so
  WAF-protected competitor pages still read and internal hosts are refused.
- The schema audit extracts `<script type="application/ld+json">` blocks +
  `<title>`/meta server-side and asks Claude to grade them and generate valid
  JSON-LD (placeholders for anything not derivable from the page — no guessing).
- All Claude calls use `claude-sonnet-4-6` via `claude.callClaude`, grounded
  with the `local-seo` / `schema` / `seo-audit` / `copywriting` playbooks, and
  return strict JSON. Costs are logged per-tool via the existing `recordClaudeCost`.

## Routes

- `GET    /api/seo/clients/:clientId/local-seo/:tool` — history (40 most recent)
- `POST   /api/seo/clients/:clientId/local-seo/:tool` — run (body = the tool's inputs)
- `DELETE /api/seo/clients/:clientId/local-seo/:tool/:runId` — delete a run

`:tool` ∈ `competition_gap | schema_audit | buyer_intent | competitor_xray | gbp_posts`.

## Attribution

The methodology playbooks are distilled from the MIT-licensed
coreyhaines31/marketingskills `schema`, `seo-audit` and `ads` skills, consistent
with the in-platform mining approach in `external-integrations-plan.md`.
