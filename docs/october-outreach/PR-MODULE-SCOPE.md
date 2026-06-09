# PR Module — Scope

**Status:** In build
**Plugin:** October Outreach (`dev/october-outreach`, v3.8.0)
**Author:** scoping pass, 2026-06-09

This document scopes a new **PR (Public Relations)** capability for the
October Outreach plugin (the "October Marketing Intelligence" app).

### Build status
- ✅ **Phase 0–1** (merged): `segment` split, gated PR menu, `oo_editorial_log`
  + `oo_outlets` tables, Editorial Log page + Notion-export CSV import.
- ✅ **Phase 2b** (merged): AI outlet deduplication — `OO_Dedup` engine
  (normalise → fuzzy cluster), Claude adjudication of fuzzy clusters, Media
  Database page with a "find duplicates" review/merge tool, alias-aware
  resolver wired into the importer so future imports don't re-duplicate.
- ✅ **Phase 2 (CSV)** (merged): master Publications + Press Contacts CSV
  importers routed through the alias-aware resolvers; new contact fields
  (`bio_link`, `last_contacted`, `outlet_id`); shared `OO_Dedup::resolve_contact`
  (email-then-name) so log + master imports converge on one record per
  journalist.
- ✅ **Phase 3** (this branch): journalist ↔ coverage analytics — `OO_Analytics`
  (relationship strength, hit rate, "gone quiet"), a Journalists leaderboard
  (per-client scoping, search) and per-journalist drill-down with coverage
  history.
- ❌ **Notion API sync — dropped.** October is retiring Notion for this; the
  one-time CSV import is the migration, OMI is the sole system of record.
- ✅ **Phase 4a** (merged): `oo_clients` (name, unguessable token, alert
  email, cadence) + Clients admin page; public **token portal** (`/?oo_pr=…`)
  showing Published + positive pipeline, never internal notes, with CSV
  download. Resolves the "clients vs brand" decision (dedicated `oo_clients`).
- ✅ **Phase 4b** (merged): automated client reports + alerts — `OO_Reports`
  (daily Action Scheduler tick → weekly/monthly Claude-written digest via the
  mailer), a "Send report now" button, and a "you've been featured" alert on a
  manual transition to Published. `OO_Claude::write_coverage_report`.
- ✅ **Phase 5 — fast logging** (merged): ⚡ paste-a-URL → Claude auto-fills
  the log entry (`extract_story_meta`), and alias-aware typeahead on the
  publication/press-contact fields to prevent duplicates at entry.
- ✅ **Phase 6 — coverage monitor** (merged): `oo_coverage_searches` +
  `OO_Monitor` (Serper Google News + Google Alerts RSS adapters, alias-aware
  outlet matching, URL de-dupe) → auto-logs as `new`; daily Action Scheduler
  tick; Coverage Monitor page with saved searches (run-now) + a confirm/dismiss
  review queue. Auto-found rows are hidden from the main log until confirmed.
- ✅ **Phase 7 — thank-you engine (assisted stage)** (this branch):
  `OO_Claude::write_thank_you` (fresh, never-repeating per journalist),
  `oo_sent_thanks` (no-repeat memory) + `oo_thank_feedback` (approve/edit/reject
  capture), a Thank-yous review page that drafts → edit → send from the team's
  reply-to address. **Auto-send + adaptive trust ramp = follow-up (Stage 2/3).**
- ✅ **Phase 8 — REST API** (this branch): `OO_REST` exposes the PR data on
  `oo/v1` (stats, editorial-log [GET+POST], journalists [+detail], outlets,
  clients), authed by a logged-in admin **or** an `X-OO-Key` header matching the
  Settings key. The shared gateway for the nvelope front-end **and** the Gmail
  add-on. Settings card to view/regenerate the key.
- ✅ **Phase 9 — press-release wizard (authoring + sign-off)** (this branch):
  Press Releases under the PR menu; brief → `OO_Claude::write_press_release_draft`
  → editable body; status machine draft → in_review → approved → sent; a public
  **client approval link** (token, no login) where the client signs off. Extends
  `oo_press_releases`. **Distribution (build media list → pitch → send) + removing
  it from Email = follow-up.**
- ⬜ Next: PR distribution + remove from Email, thank-you auto-send ramp,
  profiles, Gmail add-on, then the **nvelope front-end** (consumes the API) and
  the "copy to platform.octobercomms.com" step.

### Architecture: dual-surface (plugin + nvelope) — confirmed direction

The PR module should be usable in **both** the WordPress plugin **and**
platform.octobercomms.com (nvelope). To avoid duplicating business logic:

- **WordPress plugin = single source of truth + backend** (all data, dedup,
  analytics, portal, reports, monitor — already built here).
- **Plugin exposes a REST API** (`/wp-json/oo/v1/…`, authenticated) — the same
  API the Gmail add-on needs.
- **nvelope consumes that API** and renders the PR module inside the platform
  UI. Same data, two front-ends, no logic duplication.

Workstream order: keep completing backend features in the plugin → stand up the
REST API → build the nvelope front-end against it. (New dedicated track.)

> **This is an AI-powered *Smart PR system*, not a database.** A database is
> something you maintain; a smart system does the work *for* you — it watches for
> coverage, logs it, alerts the client, thanks the journalist, and keeps the
> relationship warm, with the human only confirming. The database is the
> by-product, not the point.

### Guiding principle: fast, or nobody uses it

Every flow is designed for **minimum clicks and minimum typing**. If logging a
story, finding a contact, or sending a report takes effort, the team falls back
to Notion/spreadsheets and the system dies. So throughout this scope:
**Claude pre-fills, typeahead suggests, and automation fires by default** —
the human approves, they don't author. Speed-first UX choices are called out
inline as **⚡ Fast** notes.

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
  contacts and coverage live together and can be joined for analytics. A one-time
  **CSV import** migrates the existing 4,371-row log in (Notion is being retired
  for this — no ongoing API sync); clients get self-serve **token URLs +
  downloadable + weekly auto reports**. See §6–§7.
- **Profiles + Gmail capture:** dedicated outlet & journalist profile pages
  (coverage history, Claude summary/tags, notes, maternity/availability, photo —
  §5.2), and a **Gmail "log this thread" button** so real conversations reach the
  log (a separate Workspace Add-on talking to a new OMI REST API — §6).
- **Master import + AI dedup:** import October's two Notion master databases
  (**1,581 publications**, **2,181 press contacts** with bylines) and clean the
  heavy duplication (`Dezeen`/`Dezeen.com`/`Dazeen`, `DO NOT USE` flags, etc.)
  with a normalise → fuzzy → Claude "Do you mean X?" pipeline, plus an ongoing
  duplicate-guard. See §5.1.

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
toggle; PR pages are pre-filtered to Media. The **Gmail add-on (§6)** is the
fastest capture surface for both segments — sorting each person you email into
press (media) or an industry type (commercial) at the moment you're looking at
their signature.

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
- **`oo_outlets`** — publications: `name`, `canonical_name`, `aliases` (JSON),
  `domain`, `tier`, `region`, `circulation/reach` (optional), `status`
  (active | do_not_use | merged), `merged_into` (FK, nullable), `notes`.
- **`oo_articles`** — byline catalogue: `contact_id` (author), `outlet_id`,
  `title`, `url`, `published_at`, `vertical`, `style`, `keywords` (JSON),
  `source`. This is the "link journalists to the articles they wrote" piece and
  the input to beat categorisation. **Confirmed present in October's data** —
  the Master Press Contact DB's `Articles` column is exactly this relation.

> **Reality check on the aspiration.** "Every article/journalist/contact ever
> written" is not literally buildable in-house. What *is* buildable, and what
> this scopes, is an **incrementally growing, well-keyworded catalogue** that
> deepens every time you run a finder/monitor pass — owned by you, no per-seat
> licence. A 3rd-party import path is left open (§10) if you later want a
> jump-start. October already has a strong seed: **1,581 publications** and
> **2,181 press contacts** (with bylines, emails, locations, last-contacted) in
> the two Notion master databases.

### 5.1 Master import & AI deduplication

October's two master databases are rich but **full of duplicates and quality
debt** — real examples from the export: `Dezeen` / `Dazeen` (typo) /
`Dezeen Daily`; `Telegraph.co.uk` / `The Telegraph` / `Daily Telegraph` /
`Telegraph Magazine`; `A Mum Reviews` / `A Mums Review`; `Selfbuild` /
`Self Build & Design`; `Architects Journal` / `Architects Jo` /
`AJ / The Architects' Journal`; exact repeats (`Planted`, `OLIVA Lifestyle`,
`BBC Culture`); plus **~40+ `DO NOT USE` flags embedded in the name string**.

Import must therefore clean as it loads, and prevent re-duplication afterwards.
A 3-stage pipeline (reusing the **Tags** feature's existing
`analyze_tags` → human-approved `apply_tag_plan` pattern):

1. **Mechanical normalise** — trim; strip ` DO NOT USE` → `status = do_not_use`;
   drop URL scheme; fold case/punctuation/diacritics; extract `domain`. Resolves
   exact dupes and `Dezeen` ↔ `Dezeen.com` with no AI cost.
2. **Fuzzy blocking** — trigram / Levenshtein clustering generates *candidate*
   dupe groups cheaply. This avoids the 1,581² (~1.2M) pairwise blow-up — only
   ambiguous clusters proceed.
3. **Claude adjudication + "Do you mean X?" review** — Claude returns
   `{canonical, members[], confidence}` per cluster; a review screen lets the
   team **merge / keep-separate** with a *bulk-accept high-confidence* option.
   Merge picks the canonical record, **repoints** every dependent
   contact/article/editorial-log row, and records old names in `aliases`.

**Stop-it-happening going forward:** the `aliases` JSON means a later "Dezeen.com"
from a monitor hit auto-resolves to the canonical outlet. Every new outlet/contact
(manual, finder, or monitor) runs normalise + fuzzy first and prompts
*"Do you mean X?"* before creating a near-match.

**Contacts** dedup uses `name + publication + email` as the key (two "Sarah King"
at different outlets may be different people → human confirm), and preserves
publication history when a journalist moves outlet.

Scale note: ~1,581 outlets + ~2,181 contacts → expect a few hundred candidate
clusters to adjudicate, batched to keep Claude cost/latency sane.

### 5.2 Outlet & journalist profile pages

Once the log FKs into outlets/contacts, a profile page is just a query — and it's
where the "smart database" feeling lands for the team.

**Publication (outlet) profile** — `oo_outlets` detail view:
- **Summary header** — Claude-generated 1–2 line "who they are" written from their
  articles/site, plus tier, region, domain, status.
- **Topic tags** — Claude-generated from the outlet's articles (what they actually
  cover), via the existing tags system + `oo_articles.keywords`. Refreshes as new
  bylines are catalogued.
- **All coverage with them** — every `oo_editorial_log` row for this outlet across
  all clients; total pieces, last featured, which clients/journalists.
- **Journalists here** — contacts linked to this outlet.

**Journalist (contact) profile** — `oo_contacts` detail view:
- **Header** — photo, name, outlet(s), location, beat tags (Claude from bylines),
  relationship strength, last-contacted, last-featured.
- **Notes** — free-text the team writes (the `notes` column already exists).
- **Availability status** — `active | maternity_leave | sabbatical | moved_on |
  unreachable`, with an optional **`available_from`** date. A "maternity leave"
  toggle sets the status (this happens often); journalists on leave are **excluded
  from pitch lists**, and once `available_from` passes the system surfaces a
  *"reactivate?"* nudge (the "back a year later" case).
- **Coverage & bylines** — their `oo_articles` + the log rows where they featured
  our clients.

**Photo sourcing (best-effort, honest):** there's no clean free "journalist photo"
API. Practical order: scrape the author/bio page (the scraper already exists →
`og:image`/headshot), then Gravatar from their email, then manual upload/paste-URL.
LinkedIn photos are off the table (ToS + unreliable). Store `photo_url`; treat
auto-fetch as a convenience, manual override always available.

New `oo_contacts` columns: `availability_status`, `available_from`, `photo_url`.
New `oo_outlets` column: `summary`. Topic/beat tags reuse the tag system.

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
as first-class foreign keys.** Migration is a **one-time CSV import** of the
exported log — each row resolves its `Press Contact` → an `oo_contacts` row
(`segment = media`, created if missing) and its `Publication` → an `oo_outlets`
row, by name. **October is retiring Notion for this workflow**, so there is *no*
ongoing Notion API sync — OMI is the sole home (decision confirmed; the
earlier Notion-API option is dropped).

> The exported log columns (`Story Title, Client, Country, Interview Date,
> Issue Date, Link to story, Notes/Outcome, Pitch/Request, Press Contact,
> Publication name, Request Date, Status`) map straight into the importer —
> ✅ built in Phase 1.

### Table: `oo_editorial_log`

Replaces the earlier `oo_coverage` proposal — same idea, but modelled on the real
log so it captures the full pitch lifecycle, not just published hits:

`id`, `client` (→ brand/client), `story_title`, `contact_id` (press contact →
journalist, FK), `outlet_id` (publication, FK), `country`, `status` (the lifecycle
enum above), `pitch_request`, `request_date`, `interview_date`, `issue_date`,
`story_url`, `archive_url`, `notes_outcome` (**internal only**), `sentiment`,
`source` (manual | serper | alerts | webzio | notion-import | gmail),
`gmail_thread_id` (the "living link" for status auto-advance, §6), `created_at`.

### ⚡ Fast logging (speed-first UX)

Logging a story must take seconds, or the log rots:

- **Paste-a-URL → auto-fill.** Paste a story link; Claude (via the existing
  `extract_*`/scraper) reads the page and pre-fills publication, journalist,
  title, date and a suggested sentiment. The human glances and saves.
- **Typeahead everywhere, alias-aware.** Typing a publication or contact searches
  existing records *and their `aliases`* — so "Dezeen.com" surfaces the existing
  "Dezeen" rather than letting you create a dupe. Inline "＋ create new" only if
  there's genuinely no match (this is the duplicate-guard from §5.1, surfaced as
  autocomplete).
- **Auto-status.** Scraped/confirmed hits set `status = Published` automatically;
  no dropdown fiddling.
- **Keyboard-first table** with inline edit, mirroring the Notion muscle memory.

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
`oo_process_sequences` already runs. Hits are matched to journalist + outlet
(alias-aware) and scored by Claude for relevance + sentiment, then:

- **High confidence** → **auto-logged as Published, client alerted, journalist
  thanked** (§7.1) — zero human steps, exactly the "scrape → log → alert" flow.
- **Lower confidence** → a one-tap **confirm queue**; confirming triggers the
  same alert + thank-you chain. Confirmation *is* the only manual step, and it's
  one click.

The confidence threshold and whether thank-yous wait for confirmation are
configurable (see §12) — the default favours speed with a safety net on the
genuinely ambiguous matches.

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

### Email capture from Gmail (conversations → log)

The real back-and-forth with journalists lives in Gmail today, invisible to the
log. We close that gap so the log reflects *what's actually happening*, not just
outcomes. Three routes, in build order:

1. **⚡ Gmail Add-on — contextual sidebar (recommended v1).** A Google Workspace
   Add-on ("OMI for Gmail", Apps Script/CardService) that opens a **right-hand
   sidebar in context**. Gmail's `onGmailMessageOpen` trigger hands the add-on the
   sender/subject/thread when you open a message; the card then shows, at a glance:
   - **Journalist panel** — photo, outlet, beats, **availability (incl. the
     maternity flag)**, relationship strength, last-featured, and their recent
     coverage. *"See immediately what they've done before."*
   - **Publication panel** — Claude summary, topic tags, recent coverage with this
     client.
   - **Edit in place** — quick-edit notes, availability/maternity toggle, beats
     (CardService form inputs → callback → OMI REST update). Deeper edits deep-link
     to the full profile (§5.2).
   - **Log this thread** — one tap: Claude reads the thread and pre-fills client +
     status + one-line outcome (reusing `OO_Claude::classify_reply()`); confirm
     creates/updates the `oo_editorial_log` row and stores the `gmail_thread_id`
     ("linking" the thread).
   - **Not in the database? Add them — into the right segment.** When the sender
     isn't matched, the card flips to a one-tap **add contact**, with Claude
     pre-filling name/company/title/location/website from the email signature +
     sender domain. The team picks:
     - **Press** → `segment = media`; tries to match/create the publication and
       suggest beats. Feeds the PR flow.
     - **Industry contact** → `segment = commercial`; Claude suggests a **contact
       type** from the existing `get_contact_types()` (architect, interior
       designer, **property developer**, etc.) and relevance **tags** (e.g.
       "property developer — relevant to architecture clients"). Feeds **invite
       lists and outreach** — so the add-on quietly grows the right industry lists
       every time you email someone, not just the press DB.

     The §5.1 duplicate-guard applies, so adding from Gmail never creates a dupe.
     This makes the always-open sidebar the **shared capture surface for the whole
     contacts DB** — both the Email/Outreach and PR modules — reinforcing the
     media/commercial split in §4.
   - All via a new **authenticated OMI REST endpoint**
     (`/wp-json/oo/v1/...`); journalist matched by email (alias-aware).
   - Separate deployable per the two-folder rule: `dev/oo-gmail-addon/` (+
     `docs/oo-gmail-addon/`). Minimal Gmail scope — only the open message, **not**
     the whole mailbox.

   **Living link — status auto-advances as the conversation moves.** Once a thread
   is linked (`gmail_thread_id` on the log row), each time you open it the add-on
   re-sends the latest messages and Claude re-classifies the state, advancing
   `Pitched → Confirmed → Published` (or `Declined`). Per the **per-client trust
   ramp** (§7.2): confident transitions apply automatically, ambiguous ones offer a
   one-tap confirm — so it feels automatic without a background watch. A move to
   **Published** hands straight to the thank-you engine (§7.2); because "published"
   is high-stakes, it's corroborated against an actual story link / coverage hit
   before auto-thanking, not taken from the journalist's word alone.
   *(True hands-off background advancing — updates while you're not in the thread —
   needs the Gmail-API watch/push in route 3.)*
2. **Forward / BCC ingest address (zero-friction fallback).** A dedicated mailbox
   (e.g. `log@inbox.octobercomms.com`); forward a thread or BCC it when pitching.
   OMI ingests it (REST relay or IMAP poll), Claude parses + matches + logs.
   Works from **any client incl. mobile**, no add-on install — good for "on the go".
3. **Gmail API OAuth sync (later, heavier).** OMI connects to the account and,
   via `users.watch` + Pub/Sub push, gets notified when a **linked thread** gets a
   new reply — re-classifying and advancing status **in the background**, with no
   need to open the email. This is what makes "it auto-updates by itself" fully
   hands-off. It also surfaces ongoing threads with known journalist emails for
   one-click logging. The cost: full-mailbox scope → Google verification + a real
   privacy review, so it's deferred until the button/sidebar prove the value.

**Privacy stance:** v1 only ever ingests threads the user explicitly logs — no
background mailbox reading until (and unless) the OAuth phase is chosen.

New table: `oo_email_activity` — `contact_id`, `editorial_log_id` (nullable),
`client`, `gmail_thread_id`, `direction`, `summary`, `occurred_at`, `captured_via`
(addon | forward | oauth) — so a contact's profile shows the conversation trail,
not just published outcomes.

---

## 7. Client portal, automation & the relationship engine

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

### 7.1 The "coverage logged" automation chain

This is what makes it *smart*. A single trigger — a row reaching `Published` —
fans out into a chain that previously took the team manual effort, now firing
automatically (or on one confirming click for ambiguous scraped hits):

```
Published row  →  ① client alert ("you've been featured")
               →  ② thank-you email to the journalist   ← the relationship win
               →  ③ relationship stats refresh (last-featured, count, strength)
               →  ④ feeds the next weekly digest
```

All built on existing parts: Action Scheduler queues it, the mailer sends it,
Claude writes it.

### 7.2 Journalist thank-you engine

> *"Thank the journalist when coverage is logged… 10 different thank-yous so they
> never get the same one twice… saves time and builds relationships."*

- **Auto-drafted, never repetitive.** Rather than 10 static templates that will
  eventually repeat, Claude **generates a fresh, personalised thank-you per
  send**, referencing the actual story (title, client, a genuine specific
  detail). To guarantee no repetition we pass Claude the last N notes/openers
  used with *that* journalist (tracked in `oo_sent_thanks`) so each one is
  demonstrably different. A seed library of ~10 tones/angles (warm, brief,
  praising a specific line, looking-forward, etc.) anchors the rotation.
- **Sent from a real person, not no-reply.** Relationship-building only works if
  replies land in the account manager's inbox — the thank-you uses the human's
  sending identity (per-client From/Reply-To), not a system address.
- **Claude decides auto vs confirm, per item.** For every opportunity Claude
  returns a **confidence score** across three checks: (1) is the journalist↔story
  match right, (2) is the coverage genuinely positive/neutral, (3) is a thank-you
  appropriate at all. **Confident → auto-send. Unsure → queue for one-tap
  confirm.** Negative/unmatched coverage never auto-thanks. Per-contact/per-client
  **opt-out** and a global **kill-switch** always apply.

#### Graduated autonomy (starts safe, earns trust)

The default is *auto-send*, but the system **ramps into it** rather than trusting
itself cold:

- **Stage 1 — Assisted (cold start).** Everything is drafted; nothing sends
  itself. The team hits **Approve / Edit / Reject** on each. Every decision is
  logged against the confidence Claude had assigned.
- **Stage 2 — Supervised auto.** Once there's a track record — e.g. ≥N decisions
  and a high approve-without-edit rate in the top confidence band — the system
  **auto-sends that band** and keeps queueing the rest. Can ramp per-client.
- **Stage 3 — Trusted auto.** Broad auto-send; only genuinely ambiguous or
  novel cases queue.

**What "learns" actually means** (honest scope — no model training):
1. **Feedback capture** — approve/edit/reject + the human's edits are stored.
2. **Adaptive threshold** — the auto-send cutoff moves *both ways*: it loosens as
   approvals accumulate, and **tightens again** if auto-sent items start getting
   corrected. Trust is revocable, not one-way.
3. **Few-shot improvement** — recent approved (and rejected) examples are fed back
   to Claude as context, so drafts and its own confidence calibration improve.
4. **Calibration check** — we compare "Claude said high-confidence" vs "human
   approved unedited" to catch over/under-confidence and adjust.

This is a transparent rules-and-feedback loop, not a black box — the team can see
why something auto-sent or got queued, and override the stage at any time.

**Tables:**
- `oo_sent_thanks` — `contact_id`, `editorial_log_id`, `body_excerpt`, `tone`,
  `confidence`, `sent_at`, `sent_by` — no-repeat memory + audit of what was said.
- `oo_thank_feedback` — `editorial_log_id`, `claude_confidence`, `decision`
  (approved | edited | rejected), `edit_diff`, `decided_by`, `decided_at` — the
  learning signal behind the adaptive threshold and few-shot examples.

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
replaces the earlier `oo_coverage`), `oo_coverage_searches`, `oo_sent_thanks`
(thank-you no-repeat memory + audit), `oo_thank_feedback` (approve/edit/reject
signal driving the adaptive auto-send threshold), `oo_email_activity` (Gmail
conversation trail). (Optional sidecar `oo_journalist_meta`.)

**Altered tables:**
- `oo_contacts`: `segment` (media|commercial), optional `outlet_id`,
  `seniority`, `last_contacted`, `bio_link`, `aliases` (JSON), `status`
  (incl. `do_not_use` | `merged`), `merged_into`, plus profile fields
  `availability_status`, `available_from`, `photo_url` (§5.2). Gains derived
  analytics (coverage count, last-featured) via the `oo_editorial_log` FK.
- `oo_outlets` carries dedup fields (`canonical_name`, `aliases`, `status`,
  `merged_into`) plus `summary` (Claude bio) — see §5.1 / §5.2.
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
- **Notion**: no integration — migration is a one-time CSV import (✅ Phase 1/2);
  Notion is being retired for this workflow, so there's no API key or sync.
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
| **2** | Master import (CSV) of 1,581 outlets + 2,181 contacts → `oo_outlets`/`oo_contacts`, resolving Press Contact & Publication relations | 4–6 days |
| **2b** | AI deduplication pipeline (normalise → fuzzy block → Claude "Do you mean X?" review + merge) + ongoing duplicate-guard on create | 4–6 days |
| **3** | Journalist ↔ coverage analytics (counts, last-featured, hit-rate, relationship strength) | 3–4 days |
| **4** | Client portal (token URL, Published+pipeline, download report) + weekly automated reports & alerts | 5–7 days |
| **4b** | ⚡ Fast-logging UX (paste-URL auto-fill, alias-aware typeahead, inline edit) | 3–4 days |
| **5** | Coverage Monitor (Serper + Google Alerts → auto-log) + webz.io + archive.is | 5–8 days |
| **5b** | "Coverage logged" automation chain + **journalist thank-you engine** (`oo_sent_thanks`, no-repeat, safety gates) | 3–5 days |
| **6** | Move press-release flow into PR + authoring/sign-off wizard | 4–6 days |
| **6b** | Outlet & journalist **profile pages** (coverage history, Claude summary/tags, notes, maternity/availability, photo) | 4–6 days |
| **7** | Journalist Finder (media variant of contact finder) + extend byline catalogue + Claude beat tagging | 5–8 days |
| **8** | **Gmail Add-on**: OMI REST API + contextual sidebar (journalist/publication summary, edit-in-place), "log thread" + living-link status auto-advance on open, **add unknown senders into media/commercial segment**; forward/BCC fallback | 9–13 days |
| **8b** | Gmail API OAuth sync — background status auto-advance via watch/push (heavier — Google verification) | 6–9 days |

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
  contacts↔coverage join. Migration is a one-time CSV import; **Notion is being
  retired for this, no API sync.**
- **Client public view:** **Published + pipeline, no internal notes.**

### Still open
1. **Press page fate** — replace the orphaned `views/press.php` entirely with
   the new authoring wizard, or keep it as a simple list view that links into
   the wizard? (Recommend: keep as the list, wizard for create/edit.)
2. **"Client" identity** — *Resolved:* added a dedicated lightweight
   **`oo_clients`** table (name, unguessable token, alert email, cadence)
   rather than reusing the 6-entry `brand` list — it's what the portal/token
   model needs. (Phase 4a.)
3. **Transition sync** — *Resolved:* none. Notion is being retired for this
   workflow; the one-time CSV import is the whole migration.
4. **Report export format** — HTML email + PDF, or HTML only for v1?
   (Recommend: HTML email first, on-demand PDF in Phase 4.)
5. **AVE / reach metrics** — do clients want estimated reach/AVE in reports, or
   is volume + highlights + journalist relationships enough for v1? (Affects
   whether we need an outlet-reach data source on `oo_outlets`.)
6. **Dedup merge policy** — auto-merge clusters above a confidence threshold, or
   always require a human click? (Recommend: human-confirm with a "bulk-accept
   high-confidence" button — same UX as the Tags merge plan. The first clean-up
   pass on 1,581 outlets is a one-time effort worth eyeballing.)
7. **Thank-you auto-send** — *Resolved:* auto-send is the goal, but via
   **graduated autonomy** (§7.2) — start in confirm-everything mode, let Claude's
   confidence + an adaptive threshold ramp it to auto as a track record builds.
   Confident → auto; unsure → one-tap confirm. *Resolved:* the trust ramp is
   **per-client** — trust builds at different rates and a new client starts
   cautious even when the system is broadly trusted.
8. **Thank-you/alert sending identity** — from the account manager's own
   address (best for relationships) or a brand PR address? (Recommend: the
   human's identity, so replies build the relationship.) Depends on the
   `clients` model (decision #2).
