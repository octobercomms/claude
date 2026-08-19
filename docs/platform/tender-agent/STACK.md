# Tender Agent — stack, discovery & build status

A background agent that finds public-sector tenders matching October's niche
(arts/culture/design/heritage/destination **PR & communications** work),
deduplicates and normalises them, then (later phases) scores, briefs, emails and
drafts. Build brief: the OMI Tender Agent brief (18 Aug 2026).

---

## 0. Discovery (brief §0) — the brief assumed Next.js; OMI is not

The brief was written stack-agnostic but defaulted to a Next.js/Prisma/Vercel
world. OMI is different, so everything is translated onto its real stack:

| # | Brief asks | OMI reality (what we build on) |
|---|------------|--------------------------------|
| 1 | Next.js version / router / TS | **Not Next.js.** Node + **Express** (CommonJS) backend, **React 18 + Vite** frontend. Hosted on a Hetzner VPS (PM2 + nginx), SSH auto-deploy on merge to `main`. |
| 2 | Prisma / Drizzle / Mongoose | **None** — raw **`pg` Pool** + numbered, forward-only SQL migrations (`backend/migrations/NNN_*.sql`). Data model = `144_tender_agent.sql`. |
| 3 | Auth / tenancy | JWT httpOnly cookie; multi-tenant per client. The tender agent is **org-level** (October bids for itself) → agency-staff only (`authenticate` + `agencyOnly`, blocking the read-only `client` role), no `client_id`. |
| 4 | Existing email | **nodemailer** via `services/emailService.js`. Reuse for the Phase-2 digest. |
| 5 | LLM client | `@anthropic-ai/sdk` via `services/claude.js` `callClaude({feature})`, routed per-feature by `aiModels.js`. Phase-2 scoring/drafting register as features (`tender_score`, `tender_draft`) rather than hardcoding model IDs. |
| 6 | Job runner (brief §15 Q1) | **In-process node-cron** (`services/scheduler.js`, `TZ=Europe/London`). **Not** Vercel Cron. |

## Product decisions (brief §15, from Daniel)

- **Markets, day one:** UK + Canada + EU + US (all four).
- **Minimum contract value:** no hard minimum — surface everything that fits the
  niche, sorted by value; value-less notices come through flagged.
- **`watch`-tier (score 50–74):** in-app list only, not in the email.

---

## Data model (Phase 1)

`migrations/144_tender_agent.sql`:

- **`tender_sources`** — one row per feed/endpoint (`kind` rss|api|scrape,
  `market`, `endpoint`, `config` JSONB, `enabled`, `last_polled_at`,
  `last_status`). Seeded with the four sources below.
- **`tender_notices`** — one row per notice, **UNIQUE (source_id, external_ref)**.
  `content_hash` over title+description+closing date distinguishes a genuine
  amendment (re-score later) from an identical re-publish (skip). `closing_at`
  is a real timestamp or NULL; NULL + `needs_manual_check = true` means "deadline
  couldn't be parsed — a human should look", never a guess.

Later phases add `tender_scores`, `tender_briefs`, `opportunities`,
`bid_documents`, `tender_chat_messages`, `org_profile`, `profile_facts`,
`rejected_notices`, `tender_llm_usage` (brief §4).

## Sources

| Source | Market | Access | Status |
|--------|--------|--------|--------|
| D3 Tenders | UK (all 4 UK portals) | RSS feeds (79 business, 92 cultural) + OCDS JSON enrichment | **Live** |
| TED | EU | v3 notices search API by CPV | **Live** (field names to confirm against the live API on first deploy) |
| CanadaBuys | Canada | Tender-notices RSS (open-data CSV = later enrichment) | Adapter built, **disabled** until live-validated |
| SAM.gov | US | Opportunities API (needs free `SAM_API_KEY`) | Adapter built, **disabled**; low-yield per the 17 Aug scan |

All fetches go through `services/tender/http.js`: descriptive user agent, ≥1
request/second per host, exponential backoff, public records only (never a login
or paywall) — the brief's guardrails, enforced in one place. Enable a disabled
source by flipping `tender_sources.enabled`.

## Ingest (Phase 1)

`services/tender/ingest.js` → `run()`:
1. For each enabled source, resolve its adapter (`config.resolveAdapter`) and
   `fetch()` → normalised notices.
2. Per notice: **drop if already closed** (`closing_at` in the past — the brief's
   hard rule); else upsert on `(source_id, external_ref)` — insert new, update on
   changed `content_hash`, skip on identical.
3. Record `last_polled_at` + a `last_status` line per source; return a run
   summary (seen / inserted / updated / skipped / expired per source).

- **Cron:** daily at 06:30 (`services/scheduler.js`). We poll daily even though
  the digest is twice weekly, so a mid-week notice with a short window isn't
  missed.
- **Manual run:** `POST /api/tender/ingest/run` (optionally `{ source_id }`).
- **Admin API:** `GET /api/tender/sources`, `GET /api/tender/notices`
  (filters: `market`, `upcoming`, `needs_check`, `limit`/`offset`).
- **UI:** Settings → Templates & tools → **Tenders** (next to Leads —
  org-level, agency-staff only). `components/TendersPanel.jsx` lists the source
  feeds with their last-poll status + a "Run scan now" button, and the open
  notices with a relevance selector (Creative-sector PR / All PR-comms /
  Everything) and market filter. Also reachable at `/tenders`.

## Relevance prefilter (brief §6 Stage 1 — shipped early)

The feeds carry the whole of CPV div 79/92, so the raw list is mostly noise
(fit-out, CCTV, resurfacing, catering, fireworks…). `services/tender/classify.js`
`prefilter(notice)` is the cheap deterministic Stage-1 pass: it needs a
comms/PR/marketing **service** term AND a **creative-sector** signal, minus an
exclusion list, and returns a tier — `match` (creative-sector PR, the default
view), `maybe` (PR/comms, sector not yet visible), or `noise`. `GET /notices`
classifies in-process and filters by `?relevance=match|comms|all`, returning
per-tier counts. Term lists live in `classify.js` for now (they move to a config
table so Daniel can tune them without a deploy). The LLM Stage-2 scorer (grounded
in the golden set) is still to come and refines the `maybe`/`match` set.

Note: buyer/value/closing columns come from the OCDS enrichment, which needs
live-feed validation on the box — until then many rows show only the RSS title
(and so land in `maybe`/`noise` when the sector lives only in the buyer name).

Adapters normalise via `services/tender/normalise.js` (content hash, date
parsing incl. ISO + RFC-822, value parsing, expired check). Keyword/CPV config in
`services/tender/config.js` (moves to a config table in Phase 2 so Daniel can
tune it without a deploy).

## Golden set

`services/tender/fixtures/golden-set.json` — the six reference cases from the
brief (3 true positives, 3 near-misses to reject). Phase 2 runs this as the
scorer regression on every prompt change; if any of the six flips, it doesn't
ship.

---

## Build order & acceptance (brief §13)

- **Phase 1 — ingest (this PR).** Poll ≥ the two D3 feeds + TED, correct
  `closing_at` on ~95% of rows, re-run produces zero duplicates. _Live-run
  acceptance validates on deploy (external feeds aren't reachable from the CI
  sandbox); the parsers are unit-checked against sample OCDS/TED payloads._
- **Phase 2 — score & brief & email.** Two-stage scoring (deterministic
  prefilter → LLM classify with the golden set as few-shot), the rewritten brief
  (brief §7), and the twice-weekly digest (brief §8; `watch` in-app only, no
  value floor).
- **Phase 3 — profile & draft.** Guided intake, document ingestion, draft
  generation with every claim traced to a `profile_facts` row.
- **Phase 4 — chat & learning.** Per-opportunity chat that writes approved
  updates back into the profile.
- **Phase 5 — verification.** Weekly self-check (ingested / rejected / pursued /
  emailed / silent sources).

## Guardrails (brief §12)

Sending email is the only outbound write (Phase 2+). The agent never submits a
tender, registers on a portal, or contacts a buyer. Respect `robots.txt` /
published access policy; rate-limit and cache; log LLM cost per call.

_Last verified: 2026-08-18 (Phase 1 ingest)._
