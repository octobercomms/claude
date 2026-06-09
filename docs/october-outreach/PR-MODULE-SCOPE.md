# PR Module — Scope

**Status:** Draft for review
**Plugin:** October Outreach (`dev/october-outreach`, v3.7.0)
**Author:** scoping pass, 2026-06-09

This document scopes a new **PR (Public Relations)** capability for the
October Outreach plugin (the "October Marketing Intelligence" app). It is a
planning artefact — no code has been written yet.

---

## 1. Why

Today the plugin does two things well: it **finds contacts** and runs
**personalised email outreach**. PR (media relations) is bolted on awkwardly:

- The **Press Releases** module exists as a campaign *type* inside the Email
  campaign wizard (`oo_campaigns.type = 'press_release'`), which embeds a press
  release URL and asks Claude to write pitch emails
  (`OO_Claude::write_press_sequence()`).
- There is also a near-orphaned **Press** admin page (`admin/views/press.php`,
  `OO_Admin::page_press()`) doing thin CRUD on an `oo_press_releases` table —
  **it isn't even registered in the admin menu** (`register_menus()` omits it),
  so it's only reachable by typing the URL.

So PR is half-built and split across two places. The user's goal is to make PR a
**first-class module** — its own page — covering the full media-relations
workflow:

1. **Find journalists** and build/categorise a media database by interest/beat.
2. **Monitor coverage** online (Serper/Google News, Google Alerts, webz.io,
   Readly/archive.is).
3. **Log coverage** and produce **weekly/monthly client reports**.
4. **Write, review and sign off press releases** (a wizard), then pitch them to
   the right journalists and track the result.

And to clean up the overlap: **move the press-release flow out of Email and into
PR**, leaving Email for generic commercial outreach. The contacts DB then needs
to distinguish **Media** contacts from **other industries** so each flow filters
to the right people.

### Confirmed direction (from scoping Q&A)

- **Media database: build our own**, reusing existing infrastructure
  (Serper + scraper + Hunter/Icypeas + Claude). No third-party media-list
  licence in v1; leave an import path open for later.
- **Coverage monitoring: support all sources** — Serper (Google News),
  Google Alerts (RSS), webz.io News API, and archive.is — phased so the
  cheap/instant sources land first and paid sources follow. **Print/magazine
  (Cafeyn/Readly) is a separate later track** — see §6 for why (no self-serve
  API; DRM/ToS rule out browser scraping).

---

## 2. What exists today (reuse map)

The PR module is mostly an **assembly of capabilities the plugin already has**.

| Existing capability | File | Reused for PR as |
|---|---|---|
| Contact DB + types incl. `journalist`, `editor`, `media_outlet`, `pr_contact` | `class-oo-database.php` | Media database backbone |
| Contact Finder wizard (audience → discover domains → search → verify → save) | `views/contact-finder.php`, `js/contact-finder.js`, AJAX `wizard_*` | Journalist Finder (media-flavoured variant) |
| Serper web search (`find_business_domains`, `search_within_directory`) | `class-oo-serper.php` | Coverage search + outlet/journalist discovery |
| HTML scraper (`scrape_domain`, `scrape_directory_page`, `pattern_contacts`) | `class-oo-scraper.php` | Byline scraping, article extraction |
| Hunter/Icypeas email finding + verification | `class-oo-hunter.php`, `class-oo-icypeas.php` | Journalist email discovery/verification |
| Claude wrapper — audience refine, sequence writing, **press pitch**, reply classify, tag analysis | `class-oo-claude.php` | PR drafting, beat categorisation, article keywording, report writing |
| Press-release extraction (`extract_press_release_html`, `fetch_press_release_content`) | `class-oo-claude.php` | Press release authoring/preview |
| Press pitch writing (`write_press_sequence`, `define_press_audience`, `write_press_pitch`) | `class-oo-claude.php` | PR pitch generation |
| Multi-provider sending + Action Scheduler queue (`oo_process_sequences`) | `class-oo-mailer.php`, `october-outreach.php` | Pitch send + follow-ups (unchanged engine) |
| Campaigns / sequences / sends tables | `class-oo-database.php` | Pitch campaigns (a campaign with `type = 'pr_pitch'`) |
| Airtable sync, CSV import/export | `class-oo-airtable.php`, `class-oo-admin.php` | Media list import/export |
| Module toggles (`enable_outreach`, `enable_press_releases`) | `settings.php`, `class-oo-admin.php` | Becomes `enable_pr` |

**Implication:** we are not building a new app. We are (a) adding a few tables,
(b) adding a PR menu with 3–4 sub-pages, (c) adding media-specific finder/monitor
flows on top of existing AJAX patterns, and (d) relocating the press-release flow.

---

## 3. Proposed structure

A new top-level **PR** menu (sibling to Outreach), gated by an `enable_pr`
module toggle, with these sub-pages:

```
PR
├── Media Database      (journalists, editors, outlets — categorised by beat)
├── Press Releases      (authoring + sign-off wizard → pitch → send → track)
├── Coverage Monitor    (saved searches + auto-ingest from all sources)
└── Coverage & Reports  (coverage log + weekly/monthly client reports)
```

Email/Outreach keeps: Dashboard, Contacts, Tags, Campaigns, Settings, Help.
The `press_release` campaign type and the press card in the campaign wizard are
**removed from Email** and reborn inside PR (see §8 migration).

---

## 4. Contacts: Media vs. other industries

The single biggest cross-cutting change. Both flows draw from one
`oo_contacts` table; we need a clean way to route contacts into the right flow.

**Approach:** add a coarse **`segment`** column (`media` | `commercial`) derived
from `type`, plus journalist-specific structure.

- `journalist`, `editor`, `media_outlet`, `pr_contact` → `segment = media`.
- Everything else → `segment = commercial`.
- Email/Outreach contact pickers default to `segment = commercial`; PR pickers
  default to `segment = media`. Both can override.

**Journalist enrichment fields** (new columns on `oo_contacts`, or a sidecar
`oo_journalist_meta` table keyed by `contact_id`):

- `beats` / interests (reuse the existing **tags** system — already normalised,
  already has a Tags admin page and Claude tag analysis).
- `outlet_id` → link to a publication (`oo_outlets`).
- `seniority` (staff writer / editor / freelancer / contributor).
- Bylines → `oo_articles` join (see §5).

**Categorise-by-interest** is a Claude job: given a journalist's scraped
bylines/bio, Claude proposes beat tags. This reuses the existing
`OO_Claude::analyze_tags()` + tag-plan apply pattern.

Filtering UI: the Contacts list and finder gain a **Media / Commercial / All**
toggle; PR pages are pre-filtered to Media.

---

## 5. Media database (build our own)

A **Journalist Finder** — a media-flavoured variant of the existing Contact
Finder — plus a byline catalogue.

### Flows
1. **Discover journalists/outlets**: search by beat + publication + geography
   (Serper), scrape outlet staff/author pages (scraper), find/verify emails
   (Hunter/Icypeas). Same 4-step wizard skeleton as `contact-finder.php`, with
   media-specific prompts and defaulting saved contacts to `segment = media`.
2. **Catalogue bylines**: for a journalist (or outlet), Serper + scraper pull
   recent articles; Claude extracts title, vertical/style, keywords, and links
   the article to the journalist. Stored in `oo_articles`.
3. **Categorise**: Claude assigns beat tags from the byline corpus.

### New tables
- **`oo_outlets`** — publications: `name`, `domain`, `tier`, `region`,
  `circulation/reach` (optional), `notes`.
- **`oo_articles`** — byline catalogue: `contact_id` (author), `outlet_id`,
  `title`, `url`, `published_at`, `vertical`, `style`, `keywords` (JSON),
  `source`. This is the "link journalists to the articles they wrote" piece and
  the input to beat categorisation.

> **Reality check on the aspiration.** "Every article/journalist/contact ever
> written" is not literally buildable in-house. What *is* buildable, and what
> this scopes, is an **incrementally growing, well-keyworded catalogue** that
> deepens every time you run a finder/monitor pass — owned by you, no per-seat
> licence. A 3rd-party import path is left open (§10) if you later want a
> jump-start.

---

## 6. Coverage monitoring (all sources, phased)

Track where clients/brands get mentioned. A **saved search** = brand/client +
keywords + sources + cadence. Action Scheduler (already bundled) runs them on a
recurring schedule, the same way `oo_process_sequences` already runs.

### Source adapters (one interface, several backends)
| Source | Cost | Notes | Phase |
|---|---|---|---|
| **Serper (Google News)** | Cheap, key already configured | Best v1 default; query per brand on schedule | **v1** |
| **Google Alerts (RSS)** | Free | Ingest one RSS feed per client alert; noisy → Claude de-dupes/filters | **v1** |
| **webz.io News API** | Paid | Comprehensive + historical archive, structured data; add behind a settings key | **v2** |
| **archive.is** | Free | No key; read paywalled hits surfaced by the other sources | **v2** |
| **Print / magazine (Cafeyn/Readly)** | Paid + partnership | See note below — own track, not part of the online engine | **later / TBC** |

#### Print & magazine coverage (Cafeyn / Readly)

Researched June 2026. Cafeyn (which acquired Readly) **does** expose a partner
API (`partner-api.cafeyn.co`) with issued `API_ID`/`API_PASSWORD` credentials —
but it's a **B2B "harvesting" arrangement** aimed at libraries/aggregators, not
self-serve, and governed by a content-licensing agreement. Readly itself has no
public developer API.

A **browser-automation approach** (logging into a Readly/Cafeyn subscription and
having the tool read pages) was considered and **rejected as a shipped feature**:
it violates their ToS, the content is DRM-protected page *images* (would need OCR
before any keyword match), it's per-session manual browsing rather than scheduled
monitoring, and it carries real legal risk for a client-facing tool.

**Decision:** print/magazine monitoring is a **separate later track**, decoupled
from the online engine. The realistic routes are (a) a formal **Cafeyn partner
agreement**, or (b) a dedicated print-monitoring vendor that already holds the
licences. In the meantime, the **manual "add coverage" entry** (§7) lets the team
log print hits by hand so they still appear in client reports from day one, with
zero integration risk.

Each adapter returns normalised hits → de-duped → Claude scores relevance &
sentiment, attempts to **match the byline to a journalist** in the media DB →
written to `oo_coverage` with `status = 'new'` for human confirm/dismiss.

**Paywall handling:** when a hit is paywalled, store an `archive_url`
(archive.is) alongside the original so the team can actually read it.

### New table
- **`oo_coverage`** — `client/brand`, `title`, `url`, `archive_url`, `outlet_id`,
  `contact_id` (matched journalist, nullable), `published_at`, `snippet`,
  `sentiment`, `relevance`, `reach/AVE` (optional), `source`,
  `status` (new/confirmed/dismissed), `created_at`.
- **`oo_coverage_searches`** — saved monitors: `brand`, `keywords`, `sources`
  (JSON), `cadence`, `last_run_at`.

---

## 7. Coverage log & client reports

- **Coverage log**: filterable table of `oo_coverage` (by client/brand, date,
  sentiment, outlet, confirmed-only). Manual "add coverage" for items found
  off-platform. Confirm/dismiss queue for auto-captured hits.
- **Reports**: pick client + period (weekly/monthly) → Claude writes a narrative
  summary (volume, highlights, sentiment, key outlets/journalists) over the
  confirmed coverage → export as branded **HTML/PDF** and/or **email to client**.
  Reuses the mailer for delivery and the brand list (`OO_Database::get_brands()`)
  for client identity.
- Optional: schedule recurring report emails via Action Scheduler.

---

## 8. Press releases — move from Email to PR

### New: authoring + sign-off wizard
A guided wizard (mirrors the campaign wizard's step pattern,
`views/wizard.php` + `js/wizard.js`):

1. **Brief** — title, key facts, brand/client, angle, embargo date.
2. **Draft** — Claude writes the release (reuse/extend the press Claude methods);
   editable rich text. Can still ingest an existing URL via
   `extract_press_release_html()`.
3. **Review & sign-off** — status machine `draft → in_review → approved → sent`.
   Optional shareable read-only link for client approval (token-gated front-end
   view). Approval gates the send step.
4. **Build media list** — filter media contacts by beat/interest/outlet tier
   (pulls from §4/§5). Reuses the contact-picker from campaign wizard step 2.
5. **Generate pitches** — `write_press_sequence()` (already exists) writes the
   journalist pitch + 2 follow-ups, personalised with `{{first_name}}`.
6. **Send & track** — reuse the campaigns/sequences/sends engine under a
   `type = 'pr_pitch'` campaign. Opens/replies tracked as today. Confirmed
   coverage can be linked back from the pitch (closes the loop into §7).

This is the **"two almost-identical flows, different purposes"** the user
described: Email pitch sequence ↔ PR pitch sequence share the send engine but
have separate entry points, audiences (commercial vs media), and Claude prompts.

### Data
- Extend `oo_press_releases`: add `body_html`, `brand`, `approved_by`,
  `approved_at`, `embargo_at`, `review_token`, link to the `pr_pitch` campaign.

### Removed from Email
- Drop `press_release` from `get_campaign_types()` and hide the press card in
  `views/wizard.php`.
- `enable_press_releases` setting → renamed/repurposed to `enable_pr`
  (with a one-time migration so existing installs keep their choice).
- Register the previously-orphaned Press page under the new PR menu (or replace
  it entirely with the new authoring wizard).

---

## 9. Data model — summary of changes

**New tables:** `oo_outlets`, `oo_articles`, `oo_coverage`,
`oo_coverage_searches`. (Optional sidecar `oo_journalist_meta`.)

**Altered tables:**
- `oo_contacts`: `segment` (media|commercial), optional `outlet_id`,
  `seniority`.
- `oo_press_releases`: `body_html`, `brand`, `approved_by`, `approved_at`,
  `embargo_at`, `review_token`, `campaign_id` (already nullable today).
- `oo_campaigns`: new type value `pr_pitch` (no schema change — it's a varchar).

All additive → handled by the existing `dbDelta` + `maybe_update()` migration
path. **Multi-tenancy note:** the in-flight roadmap
(`TODO-MULTITENANCY.md`) adds `user_id` to every table — any new PR tables must
include `user_id bigint NOT NULL DEFAULT 0` from day one to avoid reworking them.

---

## 10. Settings & integrations

- **New API keys** (Settings → new "PR & Coverage" card): webz.io key.
  Serper key already exists. Google Alerts = paste RSS feed URL(s) per client.
- **archive.is**: no key; on-demand fetch.
- **Module toggle**: `enable_pr` shows/hides the whole PR menu.
- **3rd-party media list (future):** leave a documented import adapter seam
  (CSV/JSON → `oo_contacts`/`oo_outlets`) so a presscloud.ai / newsmachine
  export can be ingested later without schema change.

---

## 11. Phasing & rough effort

| Phase | Deliverable | Rough effort |
|---|---|---|
| **0** | Contacts `segment` split + Media/Commercial filtering; `enable_pr` toggle; PR menu shell | 2–3 days |
| **1** | Move press-release flow into PR + authoring/sign-off wizard | 4–6 days |
| **2** | Journalist Finder (media variant of contact finder) + `oo_outlets` | 3–5 days |
| **3** | Byline catalogue (`oo_articles`) + Claude beat categorisation | 3–5 days |
| **4** | Coverage Monitor v1 (Serper + Google Alerts) + `oo_coverage` + confirm/dismiss | 4–6 days |
| **5** | Coverage log + client reports (Claude summary + HTML/PDF/email) | 3–5 days |
| **6** | webz.io adapter; archive.is paywall handling; Readly | 2–4 days |

Phases are independently shippable. Phase 0 unblocks everything and is the
smallest sensible first PR.

---

## 12. Open decisions (please confirm)

1. **Press page fate** — replace the orphaned `views/press.php` entirely with
   the new authoring wizard, or keep it as a simple list view that links into
   the wizard? (Recommend: keep as the list, wizard for create/edit.)
2. **Client sign-off mechanism** — in-WordPress status only, or a token-gated
   public review link the client can open without logging in?
   (Recommend: token-gated link — it's the differentiator for agencies.)
3. **Report export format** — HTML email + PDF, or HTML only for v1?
   (Recommend: HTML first, PDF in phase 6.)
4. **"Client" identity** — reuse the existing `brand` list as the client
   dimension, or introduce a dedicated `clients` concept? (Recommend: reuse
   `brand` for now; promote to `clients` only if multi-tenancy lands.)
5. **AVE / reach metrics** — do clients want estimated reach/AVE in reports, or
   is volume + sentiment + highlights enough for v1? (Affects whether we need an
   outlet-reach data source.)
