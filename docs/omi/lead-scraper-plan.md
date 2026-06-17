# OMI — Free Lead Scraper (extends the Outreach find flow)

Scope/decision record for a **free** lead-scraping source inside the existing
Outreach module: paste a URL (or describe an ICP) → scrape public contacts and
decision-makers → straight into the contacts library. Built on infrastructure
the platform already runs, so it costs nothing per lead and reduces spend on the
paid finders.

Status: **scope — awaiting sign-off before build.**

---

## Interaction model — end-to-end auto-task (not a wizard)

This is **one auto-task, not a step-by-step wizard.** A single input — a URL/list
or a plain-English ICP, plus what to pull — then **Find leads**, and it runs
autonomously (discover → fetch → extract → verify → dedupe) with a **live
progress count**, handing back a finished list. The only human gate is a **light
end review**: tick which contacts go into the library so junk doesn't pollute the
DB — with an "auto-add everything above X confidence" option for true one-shot.
Matches the platform's existing fire-and-respond + poll pattern (site audit,
brand-voice), not the Find→Brief→Draft step-wizards.

---

## Why

The Outreach "find" step already pulls leads from **Hunter**, **Serper** and
**Icypeas** — all paid per lookup. A lot of the time the contact is just sitting
on a company's Contact/About/Team page, a directory, or a listicle. We already
run **FlareSolverr** (free stealth fetch that beats WAFs) and use Claude for
extraction — so we can add a **free** finder that scrapes those pages directly,
and keep the paid providers as the fallback for email-pattern guessing.

This is an **extension of the outreach wizard**, not a new product: it adds one
more source to the same find → library → campaign flow.

## What already exists vs what's new

| Capability | Today in OMI | This build |
|---|---|---|
| Find sources | ✅ `/api/outreach/find/{hunter,serper,icypeas}` (paid) | Add `/find/scrape` (free) alongside them |
| Stealth page fetch | ✅ `utils/fetchHtml.js` → FlareSolverr, behind the `assertPublicHttpUrl` SSRF guard | The scrape engine |
| SERP discovery | ✅ `services/serper.js` | Reused to turn an ICP/keyword into candidate URLs |
| Claude extraction | ✅ `services/claude.js` | Extracts structured contacts from page text |
| Email verification | ✅ `services/outreachVerification.js` | Optional pass to drop invalid emails |
| Dedupe + library | ✅ `services/contactDedup.js`, `outreach_contacts` schema | Scraped contacts flow in exactly like paid ones |
| Everything downstream (sequences, sending, tasks) | ✅ | Unchanged — scrape just feeds the library |

So the only genuinely new code is the scrape orchestrator + its route + a UI
option; everything before and after it is reused.

## The flow

1. **Input** — the AM gives one of: a direct URL, a list of URLs, a domain, or a
   plain-English ICP ("independent furniture brands in the UK"); plus what to
   pull (contacts, decision-makers, emails).
2. **Discover** (ICP/keyword only) — `serper.js` finds candidate sites/pages.
   Direct URLs skip this.
3. **Fetch** — `fetchRenderedHtml` (FlareSolverr, free) renders each page; the
   SSRF guard runs first. Optionally crawl a couple of obvious internal pages
   (`/contact`, `/about`, `/team`) for a better hit rate.
4. **Extract** — Claude reads the page text → structured rows: `name, title,
   email, phone, company, location, linkedin, source_url`, each with a
   confidence flag. Grounded strictly in what's on the page (no guessing).
5. **Verify** (optional) — run found emails through `outreachVerification.js`.
6. **Dedupe + save** — push into the library via `contactDedup`, tagged
   `source = 'scrape'` + the run id, so they're indistinguishable from paid
   leads downstream.

## Moving parts (new)

| Piece | Location |
|---|---|
| Scrape orchestrator (discover → fetch → extract → dedupe) | `backend/src/services/leadScraper.js` |
| Routes (`POST /find/scrape`, `GET /find/scrape/runs/:id`) | added to `backend/src/routes/outreach.js` (fire-and-respond + poll, since multi-page scrapes are slow) |
| Run history + provenance | migration `lead_scrape_runs` (client_id, input jsonb, status, found_count, saved_count, created_at); scraped contacts carry the run id |
| UI — "Scrape (free)" find option | the outreach find panel (`ClientOutreachPage.jsx`) — URL(s)/ICP input + extract options → progress → results preview → "Add to library" |

## Money saved

Scrape is the **free first pass**; paid finders become the fallback:

- **Scrape wins** when contacts are publicly listed — company sites, agency
  directories, "top N" listicles, association member lists, Reddit, job boards.
- **Hunter/Icypeas stay** for email-pattern *guessing* where no email is on the
  page. The UI nudges "try scrape first, enrich with Hunter only if needed."

## PR slices (each independently mergeable)

1. **Core: single URL → contacts** — `leadScraper.js` (fetch one URL via
   FlareSolverr → Claude extract → dedupe into library), `POST /find/scrape`,
   SSRF guard. The end-to-end free path on one page.
2. **Multi-page + discovery** — crawl `/contact`,`/about`,`/team`; ICP/keyword →
   Serper → candidate URLs; `lead_scrape_runs` history + async polling.
3. **Verify + provenance polish** — email-verification pass, source tagging,
   per-run results view + "add selected to library".
4. **UI** — the "Scrape (free)" option in the find panel, with the
   scrape-first/enrich-later framing.

## Honesty / guardrails (vs the video's hype)

- **LinkedIn / Apollo are out.** They're aggressively bot-walled and their ToS
  forbids scraping — even FlareSolverr is unreliable there and it carries legal
  risk. "Unlimited LinkedIn for free" is marketing. We scope to public sites,
  directories, Reddit, job boards.
- **SSRF guard** (`assertPublicHttpUrl`) runs on every URL, as the other
  scrapers do.
- **Rate-limited + polite.** Reuse the existing fetch throttling; decide a
  robots.txt policy at slice 1 (default: honour it for crawl-discovery, allow
  AM-pasted URLs).
- **Quality flagged.** Every extracted field carries a confidence; low-confidence
  emails get the verification pass before they're campaign-eligible.

## Framing (OMI vs nvelope)

Lands in the **shared Outreach module**, so it serves both the agency-facing OMI
use and the nvelope lead-gen funnels — no fork. The contacts schema already
distinguishes `kind` (prospect / media / industry), so scraped business leads
slot in as `prospect` without disturbing the PR/media contacts.

## Out of scope (v1)

- LinkedIn / Apollo / gated networks.
- Non-contact scraping (competitor product data, real-estate, etc.) — the video
  mentions these; easy to add later on the same engine, but v1 is leads.
- Auto-enrichment chaining (scrape → auto-Hunter) — keep enrichment a manual,
  cost-aware click in v1.
