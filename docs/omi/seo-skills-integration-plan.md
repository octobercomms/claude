# SEO Skills Integration Plan — claude-seo + seranking/seo-skills

Decision record + build spec for mining two open-source SEO skill libraries into
the **October Marketing Intelligence** Owned (SEO) suite. Companion to
`external-integrations-plan.md` (which covered camofox, claude-ads,
marketingskills) — same house pattern, new source material.

- Date: 2026-07-07
- Branch: `claude/peaceful-franklin-drpsew-2ppmnt`
- Status: **spec — awaiting sign-off before build** (this doc is the plan; no
  code ships with it)

---

## Candidates reviewed

| Project | Licence | Verdict | Reason |
|---|---|---|---|
| [AgriciDaniel/claude-seo](https://github.com/AgriciDaniel/claude-seo) | MIT | ✅ **Mine the knowledge** | 25 sub-skills / 18 agents; deep, primary-source-grounded SEO rubrics (E‑E‑A‑T, technical, schema, GEO). The durable value is the checks + methodology, not the agent code. |
| [seranking/seo-skills](https://github.com/seranking/seo-skills) | MIT | ✅ **Mine the knowledge** | 26 skills over the SE Ranking MCP. Overlaps claude-seo heavily (it even credits it) but adds sharper framings: **E‑E‑A‑T + CITE** content rubric with publish verdicts, **SXO** persona scoring, drift severity coding, a technical-audit priority formula. |

Both are **Claude Code / Agent skills** — the identical situation to claude-ads
and marketingskills. We do **not** install or run them; they orchestrate
external APIs (SE Ranking MCP, DataForSEO, Google APIs, Firecrawl) that either
duplicate connectors we already have or aren't ours to depend on. We lift the
**MIT-licensed knowledge** — the rubrics, checks, thresholds, and methodology —
into the platform's existing panels and playbooks, where it improves every
automated run for every client.

(Consistent with the claude-ads / marketingskills decisions: **in-platform
mining only**. Installing either as a standalone Claude Code skill for the team
is out of scope this round.)

---

## What we already have (≈80% overlap — do not rebuild)

Verified against the current suite. These map onto existing OMI features and
need **no** work — listed so the overlap isn't re-litigated:

| Repo skill(s) | Already in OMI |
|---|---|
| content-brief, keyword-cluster | Build → Brief (single / cluster / programmatic); `keywordClusters.js` |
| competitor-gap, competitor-pages, page-level verdict | Build → Find (URL gap, competitor gaps), Quick wins, Keyword footprint |
| backlinks-profile, backlink-gap | Search → Backlinks, Authority (Moz) |
| local, maps | Localise (GBP, X-ray, NAP, ranking playbook, outliers, GBP posts) — richer than either repo |
| ai-search / geo / **share-of-voice across 5 engines** | AI Visibility (`aiVisibility.js`: Claude + Google AIO always-on, ChatGPT/Gemini/Perplexity via DataForSEO), AI Overviews tracking, AI keyword targets |
| schema (detect/validate/generate) | Localise → Schema audit; `schema` playbook |
| sitemap, google (GSC/GA4) | Search → Search Console (queries/pages/devices/sitemaps) |
| programmatic | Build → Brief → programmatic (`programmaticBriefs`) |
| plan | Strategy templates (`strategyTemplates.js`) |
| ads | Paid suite + Strategist (claude-ads rubric already mined) |

## Gap analysis — what's worth mining

Verified absent (or only heuristic) in OMI today:

| # | Gap | In the repos | In OMI today | Mining type |
|---|---|---|---|---|
| 1 | **E‑E‑A‑T + CITE content rubric** | ✅ both (seranking: 60-item E‑E‑A‑T + 30-item CITE, publish verdict) | ❌ Content Audit is free-form; the **only** rubric file is `adAuditRubric.json` | Pure knowledge → rubric JSON + playbook |
| 2 | **Real Core Web Vitals** (CrUX / PageSpeed field data; LCP subparts, INP, CLS) | ✅ both (Google PSI/CrUX) | ⚠️ only a Lighthouse-*inspired heuristic* (`agentReadiness.js`) | Knowledge + a Google PSI API build |
| 3 | **Hreflang / international audit** | ✅ both | ❌ none | Knowledge + a checker |
| 4 | **Image SEO** (alt quality, WebP/AVIF, srcset/sizes, lazy-load + LCP) | ✅ both | ⚠️ alt-text only, inside site audit | Knowledge → extend `siteAudit.js` |
| 5 | **SEO drift / regression baselining** ("Git for SEO") | ✅ both (severity-coded) | ⚠️ rank history only, not full-site baselines | Knowledge + a snapshot/diff service |
| 6 | **SXO** — SERP-backwards page-type mismatch, persona scoring | ✅ both | ❌ none | Knowledge + a Claude-backed analyser |

---

## Integration A — E‑E‑A‑T + CITE content rubric (into Content Audit) · **first**

The highest leverage-to-effort item, and the exact analogue of the claude-ads
work: turn a free-form Claude output into a deterministic, scored rubric.

**What we take:** the E‑E‑A‑T factor breakdown (Experience, Expertise,
Authoritativeness, Trustworthiness — Trust weighted heaviest, per QRG) and the
CITE citation-readiness checklist, distilled to the checks that apply to a page
we can fetch. **What we don't:** the repos' page-render/agent plumbing — we
already fetch pages via `fetchRenderedHtml`.

**Where it lives:**
- `dev/platform/backend/src/data/contentAuditRubric.json` — categories, weights,
  check ids, thresholds, MIT attribution (crediting both repos).
- `dev/platform/backend/src/data/marketingPlaybooks/eeat.md` — a prompt-ready
  methodology fragment (Trust signals, author credentials / `knowsAbout`,
  citation density, Who/How/Why heuristic), wired into `contentAudit.js` and the
  `contentDraft.js` prompt so drafts are written *to* the rubric.
- Scoring reuses the `adAudit.js` pattern: a pure `scoreContent()` that grades
  the fetched page and returns `{ grade, categories, findings }`, surfaced in
  `ContentAuditPanel.jsx` as an A–F scorecard with a publish verdict
  (publish / revise / rework).

**PR slices:** (1) rubric JSON + `eeat` playbook + pure scorer with fixtures;
(2) wire into `contentAudit.js` + panel scorecard; (3) ground `contentDraft.js`
in the `eeat` playbook so the Draft step writes to the standard.

## Integration B — real Core Web Vitals (CrUX / PageSpeed)

**What we take:** the CWV thresholds and the LCP-subpart / INP / CLS framing.
**What we build:** a real data source — `agentReadiness.js` today infers CLS
from missing media dimensions; this replaces inference with Google field data.

**Where it lives:**
- `dev/platform/backend/src/services/pageSpeed.js` — thin PSI/CrUX client
  (`PAGESPEED_API_KEY` added to `SETTINGS_KEYS`, Tier-0 API-key-only, same
  Settings pattern as existing keys). Field data (CrUX) preferred, lab
  (Lighthouse via PSI) as fallback.
- Surfaced in the **Optimise → Site audit** panel as a CWV block (LCP/INP/CLS,
  field vs lab), and folded into the site-audit score. `agentReadiness.js` keeps
  its agentic-browsing heuristics but cedes CWV to real data where available.

**PR slices:** (1) `pageSpeed.js` client + settings key + "Test PageSpeed"
button; (2) CWV block in Site audit + score contribution.

## Integration C — hreflang / international audit

**What we take:** bidirectional-link validation, self-reference checks,
x-default handling, and the machine-translation-quality flag.

**Where it lives:** a new check group in `siteAudit.js` (new issue categories
`hreflang_missing_return`, `hreflang_no_self`, `hreflang_invalid_code`),
rendered in the Site audit issues list. Relevant for multi-region clients (e.g.
Falcon's separate US / UK GSC properties). A short `international-seo.md`
playbook grounds any Claude summary.

**PR slice:** one — checks + categories + rendering.

## Integration D — image SEO

**What we take:** alt-text *quality* (not just presence), modern-format
(WebP/AVIF) coverage, `srcset`/`sizes` responsiveness, lazy-loading, and
LCP-image signals.

**Where it lives:** extend `siteAudit.js`'s per-page pass (it already parses
`<img>` for alt presence) into an image-SEO sub-report, plus new issue
categories. Ties into Integration B (the LCP image is a CWV lever).

**PR slice:** one — extend the site-audit image pass + categories.

## Integration E — SEO drift / regression baselining

**What we take:** the "baseline → compare → history" model and severity coding
across authority, traffic, keywords, backlinks, and page fingerprint.

**Where it lives:** a new `seoDrift.js` service that snapshots the signals OMI
already computes (ranks, site-audit result, backlinks/authority, key page
hashes) to a `seo_drift_baselines` table, then diffs on demand with a
severity-coded report. New **Search → Drift** (or Optimise) tab. This
generalises the rank-history we have into a full-site regression guard.

**PR slices:** (1) baseline capture + storage; (2) compare + severity report +
tab.

## Integration F — SXO (search-experience optimisation)

**What we take:** "read the SERP backwards" — infer the page-type Google is
rewarding for a query, score the client's page against it from a small set of
personas, and recommend the winning page-type wireframe.

**Where it lives:** a new Claude-backed `seoSxo.js` (SERP via DataForSEO +
Claude analysis, grounded in a `sxo.md` playbook), surfaced in Build → Find as a
fifth mode ("From the SERP") so it feeds the Brief step like the other Find
modes. Lowest-certainty item — schedule last.

**PR slices:** (1) `seoSxo.js` + `sxo` playbook; (2) Find-mode UI + hand-off to
Brief (reuses the `buildFromKeyword` seed path shipped in #943).

---

## Suggested build order

1. **A — E‑E‑A‑T rubric** (pure knowledge, no infra, biggest quality lift; mirrors claude-ads).
2. **C — hreflang** and **D — image SEO** (both small extensions of `siteAudit.js`; can share a PR).
3. **B — Core Web Vitals** (needs the PSI API key + client; real field data).
4. **E — SEO drift** (new table + service; medium build).
5. **F — SXO** (new analyser; lowest certainty — validate the framing first).

Each slice is independently mergeable against `main`, and every one follows the
established pattern: mine MIT knowledge → a rubric/playbook/check → wire into an
existing panel. No new agent runtime, no dependency on the source repos.

## Explicitly out of scope (this round)

- Installing claude-seo or seranking/seo-skills as standalone Claude Code skills
  (in-platform knowledge mining only).
- The SE Ranking MCP, Firecrawl, Ahrefs, Profound, and Bing extensions — OMI
  already has DataForSEO + GSC + Moz connectors covering the same data.
- Parasite-SEO / expired-domain / SSRF-suite detection and Speculation-Rules /
  bfcache checks — niche technical items with little OMI client relevance.
- Deep e-commerce schema generators (ProductGroup variants, MerchantReturnPolicy)
  — deferred until an e-commerce client needs them.
- Multi-engine AI share-of-voice — **already shipped** in `aiVisibility.js`; noted
  here only so it isn't mistaken for a gap.

## Licensing & attribution

Both repos are MIT. Any mined rubric/playbook file carries an attribution header
crediting the source(s), matching the convention already used for
`adAuditRubric.json` (claude-ads) and the `marketingPlaybooks/` fragments
(marketingskills). seranking/seo-skills itself credits AgriciDaniel/claude-seo;
where a check exists in both, we credit both.
