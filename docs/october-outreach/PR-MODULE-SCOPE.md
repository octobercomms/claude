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
- **Editorial log: OMI is the system of record** (not Notion) — so journalist
  contacts and coverage live together and can be joined for analytics. Notion's
  free API migrates the existing 4,371-row log in; clients get self-serve
  **token URLs + downloadable + weekly auto reports**. See §6–§7.

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
├── Editorial Log       (the spine — pitch→coverage lifecycle, ex-Notion)
├── Media Database      (journalists, editors, outlets — coverage analytics)
├── Press Releases      (authoring + sign-off wizard → pitch → send → track)
├── Coverage Monitor    (saved searches auto-capturing into the log)
└── Client Portal       (per-client token pages, downloads, weekly auto reports)
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

## 6. Editorial Log — the spine (system of record)

> Added after reviewing October's real Notion **Editorial Log**: 4,371 rows,
> 34 clients, back to 2019.

The Editorial Log is the heart of the whole PR module — broader than a "coverage
log". Each row is a **pitch with a lifecycle**, and the published rows *are* the
coverage. October's live status flow:

`Pitched → Pending / No Response → Confirmed → Published / Declined`
(+ `Download`, `Interview Prep`).

Its columns map almost 1:1 onto the model already proposed here — crucially,
**Press Contact** and **Publication name** are relations, i.e. the media database
and the log are already entangled. That is the key decision driver (below).

### Decision: OMI is the system of record (not Notion)

The team currently keeps this log in Notion, deliberately separate from the app.
But the value October actually wants — *"which journalists cover us most, when
did X last feature this client, who's gone quiet"* — is a **join between contacts
and coverage**. That join only exists if coverage lives in the same database as
the contacts. Syncing a flattened copy to Notion (or vice-versa) throws it away.

**So coverage/the editorial log moves into OMI, with `contact_id` and `outlet_id`
as first-class foreign keys.** The **free Notion API** (any workspace; rate-limited
~3 req/s, no cost) is used not as the destination but as the **migration tool**:
a one-off import of the 4,371 rows that resolves each `Press Contact` → an
`oo_contacts` row (`segment = media`, created if missing) and each `Publication`
→ an `oo_outlets` row, by name. A one-way Notion→OMI sync can run during a
transition window so the team isn't forced to switch cold.

> CSV import works today as a zero-integration fallback — the exported log
> (`Story Title, Client, Country, Interview Date, Issue Date, Link to story,
> Notes/Outcome, Pitch/Request, Press Contact, Publication name, Request Date,
> Status`) can seed the table before the Notion API sync is built.

### Table: `oo_editorial_log`

Replaces the earlier `oo_coverage` proposal — same idea, but modelled on the real
log so it captures the full pitch lifecycle, not just published hits:

`id`, `client` (→ brand/client), `story_title`, `contact_id` (press contact →
journalist, FK), `outlet_id` (publication, FK), `country`, `status` (the lifecycle
enum above), `pitch_request`, `request_date`, `interview_date`, `issue_date`,
`story_url`, `archive_url`, `notes_outcome` (**internal only**), `sentiment`,
`source` (manual | serper | alerts | webzio | notion-import), `created_at`.

### Journalist ↔ coverage analytics (the payoff)

Because the log FKs into `oo_contacts`/`oo_outlets`, the media database becomes
*intelligent* rather than a flat list:

- **Per journalist:** total pieces, last-featured date, which clients/beats they
  favour, hit-rate, and a "gone quiet" flag (no coverage in N months).
- **Per client:** coverage volume over time, top outlets/journalists, hit rate
  (Published ÷ Pitched).
- **Relationship strength** score surfaced on the contact record and used to rank
  the media list when building a press-release pitch (§8).

### Coverage monitoring auto-captures into the log

A **saved search** = brand/client + keywords + sources + cadence. Action Scheduler
(already bundled) runs them on a recurring schedule, the same way
`oo_process_sequences` already runs. New hits land in `oo_editorial_log` with
`status = 'new'` for a human to confirm (→ Published) or dismiss.

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
sentiment, attempts to **match the byline to a journalist** (`contact_id`) and
publication (`outlet_id`) in the media DB → written to `oo_editorial_log` with
`status = 'new'` for human confirm/dismiss.

**Paywall handling:** when a hit is paywalled, store an `archive_url`
(archive.is) alongside the original so the team can actually read it.

### Supporting table
- **`oo_coverage_searches`** — saved monitors: `client`, `keywords`, `sources`
  (JSON), `cadence`, `last_run_at`.

---

## 7. Client portal & automated reports

The thing Notion can't do well — and the module's headline win for October's
clients.

### Internal editorial log (team)
Filterable table over `oo_editorial_log` (by client, status, date, outlet,
journalist), mirroring the Notion views (All Stories / By Status / By Date /
Published). Manual "add row" for anything found off-platform; confirm/dismiss
queue for auto-captured hits. This is the team's working surface once they move
off Notion.

### Public client page (token URL)
Each client gets an **unguessable token URL** (`?pr_client=<token>`) — public to
anyone with the link, not listed or indexed. Renders a front-end (non-wp-admin)
view scoped to that client.

- **Shows: Published + pipeline, *without* internal notes** (confirmed via Q&A).
  i.e. story, publication, journalist, country, status (Published / Confirmed /
  Pitched), issue date, link. The candid `notes_outcome` and `Declined`
  reasons are **never** exposed.
- **Download report button** — generates the current view as a branded
  PDF/HTML on demand.
- Optional client-set email for **alerts** (see below).

### Automated weekly reports & alerts
- Action Scheduler runs a **weekly per-client digest**: Claude writes a short
  narrative (new coverage this week, highlights, who featured them) over that
  client's confirmed rows → emailed via the existing mailer, with the portal
  link + PDF attached.
- **Alerts**: when a row flips to `Published` for a client, optionally fire an
  immediate "you've been featured" email. This is the self-serve visibility
  clients keep asking Notion for.
- Cadence (weekly/monthly/off) configurable per client.

Reuses the mailer for delivery and the brand list (`OO_Database::get_brands()`)
as the client dimension (see open decision on `clients` vs `brand`).

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

**New tables:** `oo_outlets`, `oo_articles`, `oo_editorial_log` (the spine —
replaces the earlier `oo_coverage`), `oo_coverage_searches`. (Optional sidecar
`oo_journalist_meta`.)

**Altered tables:**
- `oo_contacts`: `segment` (media|commercial), optional `outlet_id`,
  `seniority`. Gains derived analytics (coverage count, last-featured) via the
  `oo_editorial_log` FK.
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
- **Notion integration** (free): internal integration token + the Editorial Log
  database ID, used for the one-off migration import and the optional transition
  sync. Free tier, ~3 req/s — fine for a batched 4,371-row import.
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
| **1** | `oo_editorial_log` table + internal log UI + CSV import of the existing log | 3–4 days |
| **2** | Notion API migration/sync (resolve Press Contact → contact, Publication → outlet) + `oo_outlets` | 3–5 days |
| **3** | Journalist ↔ coverage analytics (counts, last-featured, hit-rate, relationship strength) | 3–4 days |
| **4** | Client portal (token URL, Published+pipeline, download report) + weekly automated reports & alerts | 5–7 days |
| **5** | Move press-release flow into PR + authoring/sign-off wizard | 4–6 days |
| **6** | Journalist Finder (media variant of contact finder) + byline catalogue (`oo_articles`) + Claude beat tagging | 5–8 days |
| **7** | Coverage Monitor (Serper + Google Alerts → log) + webz.io + archive.is | 5–8 days |

Phases are independently shippable. Phase 0 unblocks everything; **Phases 1–4 are
the new priority spine** — getting October's existing log into OMI and giving
clients self-serve access is the highest-value, lowest-risk slice. Press-release
authoring and live monitoring (5–7) build on top once the log + media graph exist.

---

## 12. Decisions

### Resolved (from scoping Q&A)
- **Media database:** build our own, reuse existing infra. *(no 3rd-party licence in v1)*
- **Coverage sources:** all of them, phased; print/magazine is a separate later track.
- **Editorial log source of truth:** **OMI**, not Notion — to keep the
  contacts↔coverage join. Notion's free API is the migration tool; CSV import as fallback.
- **Client public view:** **Published + pipeline, no internal notes.**

### Still open
1. **Press page fate** — replace the orphaned `views/press.php` entirely with
   the new authoring wizard, or keep it as a simple list view that links into
   the wizard? (Recommend: keep as the list, wizard for create/edit.)
2. **"Client" identity** — the log has **34 clients**, more than the 6-entry
   `brand` list. So we likely need a dedicated lightweight **`clients`** concept
   (name, token, report cadence, alert email) rather than reusing `brand`.
   (Recommend: add `oo_clients`; it's also what the portal/token model needs.)
3. **Transition sync** — one-off Notion import only, or keep a one-way
   Notion→OMI sync running for a few weeks while the team switches?
   (Recommend: import first; add a manual "re-sync from Notion" button before
   committing to scheduled sync.)
4. **Report export format** — HTML email + PDF, or HTML only for v1?
   (Recommend: HTML email first, on-demand PDF in Phase 4.)
5. **AVE / reach metrics** — do clients want estimated reach/AVE in reports, or
   is volume + highlights + journalist relationships enough for v1? (Affects
   whether we need an outlet-reach data source on `oo_outlets`.)
