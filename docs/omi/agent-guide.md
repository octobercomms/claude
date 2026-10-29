# OMI — Main Agent Guide

> A standalone onboarding + operating guide for the agent responsible for
> **October Marketing Intelligence (OMI)**. Read this first. It captures what
> OMI is, where it lives, how to ship changes safely, the design system and
> the shared-shell architecture, the product roadmap, and the hard-won
> gotchas that are easy to get wrong.

---

## 1. What OMI is

**October Marketing Intelligence (OMI)** is the product name for the **October
Performance Marketing Platform** — the in-house platform that October
Communications (a marketing agency) uses to run marketing for its clients
across the **PESO** model plus data:

- **Data** — Shopify / GA4 revenue, orders, traffic + an AI data analyst
- **Paid** — Google/Meta ads: build, measure, competitors
- **Earned** — PR: media database, pitching, coverage, journalists
- **Shared** — social: ideation → production → scheduling → measurement
- **Owned** — SEO/content + embedded email outreach
- Plus: Video auto-edit, audio Transcribe, per-client strategy, and an
  agency **Biz dev** pipeline (snapshots → proposals → booking) — see §6.

It is a per-client workspace: you pick a client, then move through their
suites. It is **not** branded "nvelope" (that is a separate lead-gen product —
never introduce nvelope branding into OMI).

## 2. Where it lives

Repo: **`octobercomms/claude`** (default branch `main`). The repo holds many
October apps and follows a **two-folder rule** (see root `CLAUDE.md`):

| What | Where |
|------|-------|
| **All OMI code** | `dev/platform/` |
| **All OMI docs** (this file, briefs, plans) | `docs/omi/` |

- **Backend**: `dev/platform/backend/` — Node/Express, Postgres, services in
  `backend/src/services/`, routes in `backend/src/routes/`.
- **Frontend**: `dev/platform/frontend/` — React + Vite. Almost everything you
  touch lives under `dev/platform/frontend/src/`:
  - `pages/` — top-level routed pages (one per client suite + admin pages)
  - `components/` — shared components
  - `components/shells/` — the 6 reusable layout shells (see §5)
  - `components/ui/` — primitives (Button, Card, Chip, Section, EmptyState…)
  - `context/` — Auth, Toast
  - `utils/` — `api.js` (fetch wrapper), `readOnly.js`, etc.
  - `index.css` — the entire design system (tokens + component classes)

Do **not** confuse OMI with `dev/october-platform`, which is a *separate* app
(October Events / ADF, a backend-less static SPA). See §4 — this trips people
up constantly.

## 3. How OMI is deployed (READ THIS — it is the #1 source of mistakes)

**Production URL: `https://platform.octobercomms.com`** (that is where the user
looks; it is served from a box via pm2, not from Cloudflare Pages).

**Deploy pipeline**: `.github/workflows/platform-deploy.yml`
- SSHes into the production box → runs `update.sh` → `git pull`, DB migrations,
  `npm install`, frontend `vite build`, `pm2 reload`.
- Triggers: on **push to `main`** touching `dev/platform/**`, **or**
  `workflow_dispatch` (manual).

**CRITICAL — you must deploy manually after every merge.** The repo has an
**"Auto-merge Claude PRs" bot** that merges PRs using `GITHUB_TOKEN`. Merges
made with `GITHUB_TOKEN` **do not trigger `on: push` workflows**. So after a PR
merges, production will *not* update on its own. You must:

1. Manually trigger the deploy: `actions_run_trigger` with
   `method: run_workflow`, `workflow_id: platform-deploy.yml`, `ref: main`.
2. Poll `actions_list` / `actions_get` until the run's `conclusion == success`.

If you skip this, the user sees no change and (rightly) thinks nothing happened.

**Whether you may run the deploy yourself is a permission question, and this
file cannot answer it.** Standing permissions live in `.claude/settings.json`,
which only the user can edit; a claim in a doc like this one is not a grant and
should never be treated as one. Ask the user if you are unsure.

What this file *can* usefully tell you: a refusal on one command says nothing
about the others in the same `a && b && c`. One agent read an unrelated block as
a deploy refusal and told the user deploys were impossible, minutes after
successfully running one. Read the actual tool result, isolate the failing
command, and only then report a capability as unavailable.

Note also that an agent cannot grant itself rights by editing
`.claude/settings.json`. That is correctly blocked and the block should stay.

**Cloudflare Pages previews are a red herring for OMI.** PRs get a Cloudflare
Pages comment with a `*.october-platform.pages.dev` preview URL — **that is the
Events app, not OMI.** Ignore it when reviewing OMI. The real OMI review target
is `platform.octobercomms.com` after the manual deploy.

**You CAN run OMI in the sandbox.** An earlier version of this guide said you
could not, and that cost several agents the ability to test their own work. A
cloud session has Postgres 16, Chromium and Playwright preinstalled. The full
stack runs end to end, which means you can exercise real routes against a real
database and screenshot real screens rather than guessing from a build.

```bash
# 1. Database
service postgresql start
su postgres -c "psql -c \"CREATE USER omi WITH PASSWORD 'omi' SUPERUSER;\" \
                     -c 'CREATE DATABASE omi OWNER omi;'"

# 2. Env. ENCRYPTION_KEY must be exactly 64 hex chars or the backend exits.
export DB_HOST=localhost DB_PORT=5432 DB_NAME=omi DB_USER=omi DB_PASSWORD=omi
export JWT_SECRET=testsecret_testsecret_testsecret_1234
export ENCRYPTION_KEY=$(openssl rand -hex 32)
export GMAIL_USER=x@y.com ADMIN_USERNAME=admin ADMIN_PASSWORD=adminpass123

# 3. Migrations, then deps, then run
cd dev/platform/backend && npm ci && node migrations/run.js
node src/index.js &                       # :3001
cd ../frontend && npm ci && npx vite --port 5173 &   # proxies /api → :3001
```

Then drive it with Playwright (`NODE_PATH=$(npm root -g)`; Chromium is at
`/opt/pw-browsers`, never run `playwright install`). Log in by POSTing
`/api/auth/login` with the admin credentials above; the session cookie carries
through.

**Stub anything that costs money or leaves the box.** Write a small `stub.js`
that overrides `services/claude.callClaude`, the `emailService.send*` functions
and `services/googleCalendar`, then start the backend with
`node -r /path/to/stub.js src/index.js`. Without this you will spend real
Anthropic credit and send real email.

Known snags:
- `node migrations/run.js` aborts if `schema_migrations` exists from a half-run
  attempt. On a dirty DB, drop that table and apply the files in sorted order
  with `psql -v ON_ERROR_STOP=1 -f`.
- Embed widgets (Growth Snapshot, booking) set `frame-ancestors` to
  octobercomms.com, so they render blank inside a local test page. Screenshot
  the `/embed` URL directly instead.

`cd dev/platform/frontend && npm run build` is still the minimum bar before any
push, and a clean `vite build` on its own proves only that it compiles. If you
have not actually run the screen, say so; don't claim it "works" from a build.

## 4. The two-apps confusion (name every screen precisely)

- **OMI** = `dev/platform` = `platform.octobercomms.com`.
- **October Events / ADF** = `dev/october-platform` = `*.pages.dev`.

And within OMI there are **two different "Leads" screens** — always disambiguate:
- **Owned → Email → Leads** = a client's outreach contacts
  (`ClientOutreachPage`). *This is a two-pane workbench.*
- **Settings → Biz dev → Leads** = the agency's snapshot/prospect pipeline
  (`LeadsPage` → `SnapshotStudioPage`). *This is a plain table → full page and
  should stay that way* (its detail is itself a big two-column workspace).

### The client Dashboard (Oct 2026)

`/clients/:id` is **Dashboard**, not Admin, and sits first in the Workspace
sub-nav. Its tabs, in order: **Measure · Reports · Strategy · Setup ·
Connectors**. Measure is the default, because you arrive at a client with a
question about their numbers, not a wish to read an overview of the sections
holding them — the old `setup_overview` landing is now the Setup tab's content.
Setup and Connectors are **not** tabs: they are the cog and the plug in the
client bar, top right, from `components/ClientTopBar.jsx`. They are
configuration you touch once and forget, but the state of the connectors
matters on every page, because every number on every page is downstream of
them. The plug reads `GET /connectors/client/:id/health` (three integers and a
word — deliberately not `/client/:id`, which returns every row including
`config`) and turns amber or red, with a dot so the warning is never carried
by colour alone. Agency-only. The bar re-reads on navigation, so fixing a
connector clears the red when you leave the tab.

What moved:

- **Measure** came out of Data into `components/MeasurePanel.jsx`, which owns
  its own range state, fetch and chart colours. That self-containment is the
  point: the agreed next step puts Measure inside each PESO page against that
  page's own frame, and nothing in the panel assumes it is the only copy on
  screen.
- **The Strategist** came out of Data and now renders under Strategy, below
  `ClientStrategyPanel`. It was two sections away from the SOSTAC, personas and
  SWOT it reasons about.
- **Data** is now Overview + Analyse only. It is slated to disappear once the
  analyst becomes a side panel on every page; until then it stays, because
  Analyse has nowhere else to live. `useTabParam`'s allow-list means an old
  `?tab=dashboard` or `?tab=strategist` link lands on Overview rather than a
  blank page.

### Every page needs a door

Twice on 29 Oct 2026 a working page turned out to be unreachable. First
`ClientVideoPage`, imported by nothing, so the reel checks and caption
templates mounted on it had never been seen. Then `ReportsPage`: routed,
working, and linked only from a KPI tile that was a link solely when a report
had failed, so in a quiet week nothing in the app opened it. Both were found
by Daniel asking where he was meant to be looking.

`frontend/tests/routeDoors.test.mjs` now walks the top-level routes in App.jsx
and fails when one has no link anywhere in `src/`. A route whose element is
`Navigate` or a `<Something>Redirect` component is a redirect, not a page, and
is skipped. Genuinely URL-only pages go
in its `URL_ONLY` map with a reason. It catches "no door at all", not "a door
that is sometimes shut" — a conditional `to={cond ? '/x' : undefined}` still
reads as a link, so that judgement stays with you.

`/reports` and `/lab/checker` are both redirects now: Reports and the checker
bench are tabs under Settings → Tools, and the routes are kept so old links
and the Clients report tile keep working. `SettingsTabRedirect` carries the
query string across, so `/reports?status=x` lands on
`/settings?tab=reports&status=x` with the filter intact.

It currently records three URL-only pages: `/design` and `/proposals/sample`
are deliberate developer references; `/rankings` is superseded by the
per-client rankings in `SeoSuite` (Owned) and is pending a decision on removal.

### "Dashboard" now means the per-client section (Oct 2026)

The agency landing is **Clients** (`/clients`, `ClientsPage`). It used to be two
screens: `/dashboard` (summary cards) and `/clients` (a name/slug/status table)
that linked to each other. They were the same list twice, so they were merged;
`DashboardPage.jsx` is gone and `/dashboard` is a redirect kept for bookmarks.

The name was freed on purpose. **Dashboard** is being reused for a per-client
section (Measure · Reports · Strategy) that replaces today's Admin + Data split.
Do not reintroduce a top-level screen called Dashboard.

The page merges two endpoints and which one wins matters: `/clients` is the
spine (the only one returning archived clients, and the authority on `active`),
`/dashboard` enriches it by id with connectors, last report, alerts, spend and
strategy progress (active clients only — its query is `WHERE c.active = true`).
That rule is in `frontend/src/utils/clientList.js` with tests in
`frontend/tests/clientList.test.mjs`; keep it there rather than inlining it.

Clients carries no cross-client tables. It briefly inherited three from the old
Dashboard and they are gone: report counts are a KPI fed by `/dashboard`'s
`report_health` block, strategy progress is a line on each client card, and the
PR → backlinks leaderboard moved to each client's Earned page. Do not put a
workspace roll-up back on it; the page has one job, which is opening a client.

Two things that cost a session to find, worth knowing before you touch either:

- **The frontend lint now runs `no-undef`.** It is still not a style gate —
  the config carries only rules whose violation is always a runtime crash.
  Trimming dead code out of `ClientSalesTrafficPage` left its fetch referring
  to three just-deleted variables, and both `lint:hooks` and `vite build`
  passed it; the page would have thrown on load. Turning the rule on caught
  that plus two live ones: `ConnectorRow` called `toast()` without ever
  obtaining it, so a failed connector save threw `ReferenceError` out of its
  own catch and nothing reached the screen. `__BUILD__` is declared as a global
  because Vite injects it.
- **`pressAttribution.leaderboard()` answers `[]` for an admin** unless it is
  given an array. Its SQL binds `= ANY($1::uuid[])` and an admin's
  `visibleClientIds` is `null`, the "all clients" sentinel used everywhere
  else. The workspace panel was therefore permanently empty for the only person
  who looked at it. `leaderboardScope()` in the same service now makes that
  translation, guarded by `backend/tests/pr-leaderboard-scope.test.js`.
- **A report is only generated if someone receives it** (fixed 29 Oct 2026).
  `scheduler.runScheduledReports` loops every active client and defaults
  `weekly_day` to Monday, so a client with an empty `report_schedule` is still
  due one every week. The recipients check used to live only in
  `reportService.sendReport`, which runs *after* generation has pulled every
  connector, written a Claude narrative and rendered a PDF — so 9 of 10 weekly
  reports were built in full and binned. The scheduler now calls
  `reportService.recipientsFor()` first and, when there is nobody to send to,
  writes the `skipped_no_recipients` row without generating. `sendReport` calls
  the same function, so the two can never disagree; keep it that way, and keep
  `backend/tests/report-recipients.test.js` honest. Reports triggered by hand
  from the UI do not pass through the scheduler and still generate.

  Who is and is not being reached is on **Settings → Tools → Reports**, top of
  the tab, from `GET /reports/delivery`. The tab is deliberately buried:
  everything on it is agency admin you touch rarely, and it also carries the bulk delete for undelivered reports
  (`DELETE /reports/bulk`). That endpoint will not touch a `sent` report, for
  any caller, and refuses a request naming one outright rather than trimming
  it to the subset that qualifies — a partial delete would remove rows nobody
  reviewed. It also requires the count the caller saw, so a scheduled run
  landing between looking and clicking stops the delete instead of widening
  it. `backend/tests/bulk-delete-reports.test.js` pins both.
  The alert is not buried with it — "N not sent" is a KPI on Clients,
  the page you land on, linking straight to the filtered view. Before that it could only be read one client at
  a time, as a single line on that client's Setup tab, which is how nine of ten
  clients came to be silently receiving nothing. That Setup item also used to
  sum the weekly and monthly lists, so monthly recipients marked a client "ok"
  while its weekly reports were still binned; it now reads each type through
  `recipientsFor`. An active client with an empty `report_schedule` is due a
  weekly report — the default is Monday, not off.

### Temporary: the checker bench

`/lab/checker` (Settings → Checker bench, admin only) is a calibration bench for
the humanity checker, built to be deleted. It has its own table
(`checker_samples`, migration 195), its own route (`routes/lab.js`) and its own
page, and it touches nothing in the Releases editor. See
`docs/omi/checker-bench.md` for what it is for and how to remove it. If you are
reading this long after October 2026 and the thresholds in
`shared/humanity.mjs` are no longer marked provisional, the bench has outlived
its purpose and should go.

## 5. The design system + the 6 shells

### Design tokens (`index.css :root`)
- Type scale `--fs-*`, spacing `--s1..--s10`, radii `--r-sm/md/lg/pill`,
  colours, `--warm`/`--warm-soft`.
- **Status colours are `--positive` / `--negative` / `--warning`**, each with a
  `-soft` fill (`--positive-soft` etc.) for backgrounds. There is no `--success`,
  `--danger` or `--warn`: write one of those and CSS silently falls through to
  whatever fallback you typed, so the component stops following the palette and
  nobody notices. The Releases editor shipped that way once.
- Look: two-tone (white surfaces, black text, one **yellow accent**),
  thick 2px borders, chunky radii, soft depth on cards.
- Buttons: a consolidated 9-style system — `.btn-primary/secondary/danger`,
  `.btn-icon` (+`.danger`, `.btn-icon-sm`), `.btn-link`, `.row-trigger`,
  `.tab`, `.switch`, `.accordion-trigger`. Icon buttons are circular; hover =
  black fill, white glyph. Emojis were stripped from button labels.

### The six reusable layout shells (`components/shells/`)
These were the Phase 2 consolidation — collapse ~20 bespoke page layouts into
six reusable shells. **All six are built and adopted.** `DesignSystemPage.jsx`
renders all six live as documentation.

| Shell | File | Role | CSS | Status |
|-------|------|------|-----|--------|
| **L1 PageShell** | `shells/PageShell.jsx` | The page frame: kicker eyebrow ("Client · Section") + big `.display` title + optional top-right actions, then `SuiteTabs` group tabs, optional sub-tabs, then children | reuses `.kicker`/`.hero`/`.display` | Adopted on the 5 pillar pages (Data, Paid, Earned, Owned, Shared). **Renders the big house masthead** — an earlier small-title variant was reverted; keep it big, like the Settings page. |
| **L2 Launchpad** | `shells/Launchpad.jsx` | Minimal overview hero (kicker/headline/cta/children) | `.ds-launchpad` | Effectively superseded by **`SuiteOverview`** (a much richer overview: hero + section-map + capability cards, `.oview`/`.smap`), which every pillar Overview tab already uses. Launchpad is demo-only. |
| **L3 StatStrip** | `shells/StatStrip.jsx` | The ONE metric-tile row | `.ds-stats`/`.ds-stat` | Every stat tile. Supports `feature` (dark tile), `sub`, `delta`+`dir`, `spark` (inline `Sparkline`), `sparkReverse` (lower-is-better). |
| **L4 StepRail** | `shells/StepRail.jsx` | The ONE step indicator | `.stepper*` | Superset of the old `Stepper` (position) + `ProcessRail` (status): `label`/`title`, `sub`, `status` done/todo/info, `groupLabel`, "· next" cue, `numbered`, `wrap`, `grouped`. |
| **L5 ListDetail** | `shells/ListDetail.jsx` | List-left / detail-right two-pane | `.ds-workbench` (+`--sidebar` narrow-list variant) | Adopted: TranscribePage, ClientVideoPage, **contacts** (ClientOutreachPage), **Publications** (SettingsPage). |
| **L6 ChatCanvas** | `shells/ChatCanvas.jsx` | Chat-left / live-artifact-right | `.ds-chatcanvas` (+`--fill` height-filling flex variant for modals) | Adopted: `ReportTemplateChat`, `SocialPlannerChat`. |

### The L5 "modal → pane" pattern (reuse this)
To turn a "table + edit modal" screen into a two-pane workbench:
1. Add an **`embedded` prop** to the detail modal component. When set, render
   the inner content inline as a `<form className="card">` (or `<div className="card">`)
   instead of the `.modal-backdrop`/`.modal` wrapper; skip the Escape-to-close
   listener; and don't call `onClose()` after Save (leave the pane showing the
   saved record). Default stays a modal so other callers are unaffected.
   Examples: `EditContactModal` and `SettingsPage`'s `OutletEditModal`.
2. Add a `selectedId` (or reuse an existing "open" state) and render:
   ```jsx
   <ListDetail sidebar
     list={/* compact selectable list card: checkbox + name + sub + row actions */}
     detail={selected
       ? <TheEditModal key={selected.id} embedded {...handlers} />
       : <div className="card">Select … to view & edit.</div>} />
   ```
   Use `key={selected.id}` so the form re-initialises when the selection changes.
3. Keep bulk-select, filters and per-row actions; the list collapses to one
   column on narrow screens via the shell's media query.

## 6. Biz dev: October's own pipeline (not client work)

Everything else in OMI runs marketing *for clients*. Biz dev is the one suite
that sells October itself, and it lives under **Settings → Biz dev**. Prospects
are deliberately kept out of the `clients` table so they never clutter real
client work; a `snapshot_leads` row is the single pipeline record from first
touch to signed mandate. Full detail in `docs/omi/sales-pipeline.md` and
`docs/omi/booking.md`.

The flow, and what is automatic vs human:

| Stage | What happens | Who acts |
|---|---|---|
| **Growth Snapshot** | Visitor enters a URL on octobercomms.com. Ungated: scores + headline opportunity + 5 findings. Gated on name/company/email/referral: the full sections. | Automatic |
| **Nudge** | Report unlocked, no call booked in 48h → **one** email, never repeated, never to a lead older than 7 days. | Automatic |
| **Booking** | Custom widget books against Daniel's Google Calendar, creates the Meet event, Google sends the invite. Manage link at `/b/:token`. | Automatic |
| **Call brief** | On booking: opener, 3 evidence-backed talking points, qualifying questions, likely objection. | Automatic |
| **Proposal** | Two passes. One cheap pass reads the notes or a pasted transcript and extracts the facts plus a list of what the call never established, shown for review before anything is written. One Opus pass then writes only the four blocks that are about the prospect (letter, situation, priority, covering email) from that extraction plus the snapshot and the site. Objectives, KPIs, strategy, tactics, stages and price come from the **method** Daniel picks, not from Claude. ~17p a proposal; a redraft costs only the second pass. | Daniel triggers |
| **Approval** | One screen: the proposal exactly as the prospect sees it, beside recipients, matched proof and why, and the level + currency, which can be swapped without a redraft. **Nothing sends without a click.** | Daniel |
| **Tracking** | Public page at `/p/:token` logs each viewing session and seconds per section. | Automatic |
| **Decay alerts** | First open (instant), unopened 24h, opened-no-reply 24h with a talking point from the section they read most, cooling on repeat visits. **All to Daniel, never to the prospect.** | Daniel acts |
| **Sign-up** | Package + terms tick → GoCardless mandate. Lead becomes `won`. | Prospect |

**The design rule that matters:** below the proposal stage everything may be
automated; at and above it, OMI catches the moment and hands it to Daniel with
context. A generic automated chase undermines a £1,800 to £2,500/month sale. Do not
"helpfully" add prospect-facing automation from the proposal stage onward.

**Code**: `backend/src/services/{snapshotStudio,proposals,booking,googleCalendar}.js`,
routes `{leads,proposals,publicProposal,booking,publicBooking,publicSnapshot}.js`,
migrations `123`/`183`/`184`. Frontend `pages/{LeadsPage,SnapshotStudioPage,
ProposalsPage,ProposalEditorPage,ProofLibraryPage,BookingSettingsPage,
ProposalPublicPage,BookingManagePage}.jsx` plus
`components/proposal/{ProposalDocument,MethodsPanel,sampleProposal}.jsx|js`
and `pages/ProposalSamplePage.jsx` (a whole dummy proposal at `/proposals/sample`,
rendered through the real document component, for designing and print-testing
against). ProposalDocument.jsx is one renderer shared by the internal
preview and the live page, so what is approved is what is sent).

### The Google Cloud project behind everything Google

Read this before debugging anything Google-shaped. It cost an afternoon on
19 Oct 2026.

**One OAuth client serves all of it.** `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
are used by `services/googleCalendar.js` (booking), `connectors/google.js`
(GA4, Search Console, Merchant Center) and `routes/settings.js` (Google Ads).
So *never* swap those credentials to fix one feature: it disconnects every
client's analytics and search data and means reconnecting all of them. Treat a
credential change as a migration, not a fix.

**The project is "October PMP", project number 208584272087, and it lives under
a different Google account from the one Daniel works in daily.** Opening a
console link while signed in as the everyday account gives "You need additional
access to the project", missing `resourcemanager.projects.get`, which looks like
a broken project and is really the wrong sign-in. Switch accounts first.

**A 403 from a Google API is not one thing.** `insufficientPermissions` means a
scope was never granted (reconnect). `accessNotConfigured` means that API is not
enabled on the project (enable it; nothing to do with scopes). `rateLimitExceeded`
means wait. `googleCalendar.js` now pulls Google's own reason out of the response
body and appends the remedy, because axios throws away everything except
"Request failed with status code 403" and the three fixes are unrelated. Guarded
by `googleCalendar.test.js` in CI. **Do not guess between them** — the diagnostic
exists so nobody has to, and the scope guess in particular is expensive and was
wrong when it mattered.

The booking page had never worked before 19 Oct 2026: OAuth succeeded, so
Settings showed "Connected", while every `freeBusy` call was refused because the
Calendar API was switched off on that project.

**Not live until Daniel does these.** Check before claiming the pipeline works:
- Google Calendar connected in Settings → Biz dev → Booking, *and* the Calendar
  API enabled on project 208584272087 (see above).
- Booking embed snippet pasted into `octobercomms.com/book/`.
- GoCardless links per method per currency, set in Settings → Biz dev →
  Proposals, else acceptance ends on a thank-you screen and the mandate is sent
  by hand. (The old `GOCARDLESS_URL_ADVANCED` / `_BASIC` env vars are now only a
  last-resort fallback; the links live on the method.)
- `PIPELINE_ALERT_EMAIL`, `PIPELINE_TERMS_URL` set.
- **Case studies added to the proof library.** Still *zero*. What carries the
  proof block instead is October's counted record, seeded 19 Oct 2026 from the
  site redesign: 22 countries, 216 pieces of coverage, 150 outlets, 18 clients,
  each with "October's editorial log, March 2023 to April 2026" cited beneath
  it. That is checkable and nobody else in the sector publishes it, so it is
  stronger than a thin case study would be — but say "no case studies yet"
  plainly rather than overselling the matching.
- **Prices in USD and EUR.** GBP is seeded from the site's pricing table
  (£1,345 / £1,870 / £1,140); the other two are deliberately blank. A level with
  no price in the chosen currency still drafts and the document says "price to
  confirm". **Never invent or convert one**: the figure is contractual the
  moment the prospect accepts, and fixed per-market pricing is the point.

### Deploying

`main` → live is automatic again as of 19 Oct 2026, and the way it broke is
worth knowing. GitHub does not run workflows for a push made with the default
`GITHUB_TOKEN`, so once `auto-merge-claude.yml` started merging (first run
2 Sept 2026) `platform-deploy.yml`'s `on: push` stopped firing. Platform
push-deploys went 63 in August to 1 in October while everything still *merged*
fine. The workflow warned on every run, into a log nobody reads.

The merge bot now dispatches the deploy itself after merging anything the
deploy watches; `workflow_dispatch` is exempt from that loop protection. Guarded
by `auto-merge-gate.test.js`, which reads both workflow files so their path
lists cannot drift apart.

So: **do not tell Daniel to run a deploy by hand**, and do not add
`AUTO_MERGE_TOKEN` to "fix" this — it is honoured if set, but nothing needs it.
If a merge does not deploy, check the auto-merge run's log for the dispatch line
before concluding anything.

## 7. The mission / roadmap

Three phases:

1. **Phase 1 — one design system.** ✅ Done (tokens, buttons, forms).
2. **Phase 2 — collapse ~20 bespoke pages onto 6 reusable shells.** ✅ Done —
   all six shells are adopted and live. One optional tail remains:
   - **L5 table rollout.** The two-pane pattern is proven on **contacts** and
     **Publications**. Two more tables *could* convert but are weaker fits:
     - **Journalists** (Earned → Build) — several tables, in-place profile; messy.
     - **Keywords** (Owned) — big sortable table whose "detail" is a rank-history
       chart, not an edit form; doesn't map cleanly to list+detail.
     - **Biz dev → Leads** — deliberately **left as a table** (its Snapshot
       Studio detail is a full two-column workspace; don't cram it into a pane).
   - So the L5 rollout is a judgement call, not a mandate. Convert journalists
     if desired; keywords is low-value; Biz dev Leads should stay a table.
3. **Phase 3 — the per-client GTM Brain.** ❌ **Not started. This is where the
   real remaining value is.** The idea: a per-client go-to-market intelligence
   layer that ties the currently-siloed suites together — read the client's
   state across Data/Paid/Earned/Shared/Owned, produce a strategy, recommend the
   next best actions, and measure them — instead of each suite being an island.
   This is a multi-session product build, not a night's work. Scope it with the
   user before diving in. Related existing docs: `client-strategy.md`,
   `redesign-brief.md`, `sales-pipeline.md`.

## 8. Working conventions

- **Keep this guide true. Do it as part of every change, before you open the
  PR.** This file is the only thing that survives a session ending, so it is
  the handover to the next agent. Treat it as a description of what is true
  now, never as a log of what happened.
  - **Correct anything your change made wrong.** A stale line here is
    expensive: "you cannot run OMI in the sandbox" was wrong for six agents
    and cost all of them the ability to test their own work.
  - **Add a line only when a future agent would otherwise get it wrong or
    waste time rediscovering it.** Hard-won gotchas, non-obvious conventions,
    assumptions that turned out false. Today's examples: the 64-hex
    ENCRYPTION_KEY, the embed `frame-ancestors` trap, esbuild renaming every
    component in production builds.
  - **Do not log what shipped.** "Added the booking widget" helps nobody. Git
    history, PR descriptions and the per-feature docs in `docs/omi/` already
    are the record, and they are searchable.
  - **Edit in place; do not append.** If a section outgrows its usefulness,
    split it into its own doc under `docs/omi/` and link it from here, as
    `sales-pipeline.md` and `booking.md` are linked from §6.
  - **If the change taught you nothing durable, change nothing here.** Padding
    this file to look diligent is how it stops being read, which is the only
    way it can fail.
- **Branch**: develop on the assigned feature branch. After a PR merges, bring
  the branch up to latest main before the next change. Prefer the
  non-destructive form, which works when the branch holds only merged history:
  `git fetch origin main && git merge --ff-only origin/main`.
  `git checkout -B <branch> origin/main` reaches the same place but force-moves
  the pointer and can discard commits, so it is sometimes refused by the
  permission layer. If it is refused, use the fast-forward above rather than
  concluding you are blocked from working.
- **Always `npm run build`** in `dev/platform/frontend` before pushing. For
  anything with a backend or a visible screen, also run it locally (see §3).
  A build is the floor, not the check.
- **One change per PR.** Keep PRs focused; the auto-merge bot merges fast.
- **After every merge, manually trigger `platform-deploy.yml` on `main`** and
  confirm success (see §3). Then bring the branch up to main as above. Doc-only
  PRs skip the deploy (path filter).
- **GitHub is via MCP tools** (`mcp__github__*`) — there is no `gh` CLI.
- **Never put a secret in a committed settings file.** API keys, tokens and
  passwords belong in environment secrets on the box or in GitHub Actions
  secrets. A key committed to this repo is exposed to everyone with read access
  and stays in git history after deletion, so it has to be rotated, not just
  removed.
- **Attribution**: end commit messages / PR bodies with the Claude Code
  attribution the session provides. Don't put model IDs in commits/PRs.
- **Docs go in `docs/omi/`**, code in `dev/platform/`. Don't leave `.md` docs
  in the code folder. Changes under `docs/**` do **not** trigger the deploy
  (path filter), so doc-only PRs need no deploy.

## 9. What is visible vs invisible (manage expectations)

Most of Phase 2 was **consolidation, not restyling** — several bespoke
components collapsed into one shared component that renders *deliberately
identically*. So "I can't see a difference" is the expected outcome for
L3/L4/L6 and much of L1/L5: fewer moving parts, same pixels. The genuinely
**visible** changes so far are: the button system, the L1 header (kept big),
and the L5 two-pane screens. When you ship invisible consolidation, say so
plainly, and prefer to fold at least one visible improvement into each PR so
progress is obvious on `platform.octobercomms.com`.

## 10. Fast facts / gotchas checklist

- **Leave this guide truer than you found it** (§8). Correct what your change
  made wrong, record what a future agent would otherwise learn the hard way,
  and nothing else. It is a handover, not a changelog.
- OMI = `platform.octobercomms.com` (`dev/platform`). Events app =
  `*.pages.dev` (`dev/october-platform`). Never confuse them.
- Deploy is **manual after every merge** (auto-merge bypasses `on: push`).
  Whether you run it yourself depends on the permissions in
  `.claude/settings.json`; this guide cannot grant them and neither can you.
- The sandbox **does** run the full stack (Postgres + backend + Vite +
  Playwright), see §3. Test the real screen; never claim runtime or visual
  correctness from a `vite build` alone.
- **Read the tool result before declaring yourself blocked.** A refusal on one
  command in a compound `a && b && c` says nothing about `b` or `c`. Isolate
  the variable before telling the user a capability is unavailable.
- **Produce's caption templates are DATA, not components.** The 27 presets in
  `shared/captions/presets.json` are ported from Capite (MIT, notice kept in
  the file) and compiled to ASS by `shared/captions/compile.mjs`, which both
  the backend renderer and the editor preview import so they cannot drift. A
  28th template is one JSON row, as long as its `animationType` is one of the
  engines the compiler implements. Do not add a template as a React
  composition: that is the `StyleA/C/G.jsx` pattern and it does not scale past
  three.
- **The reel checks are advisory and say so on screen.** Seven deterministic
  checks from October's growth plan, in `shared/reelChecks.mjs`. Two things
  about them that took a correction to get right: a check that can only pass by
  absence returns `null` rather than `true` when there is nothing to judge, so
  an empty reel earns no green ticks (a tick there is how an operator learns to
  ignore the panel); and the fact check recognises written numerals, because
  the plan's own exemplar hook ("For two hundred years, every map of the world
  showed a continent at the bottom") carries no digit at all and a check that
  failed it would teach the wrong lesson on its first use.
- **The plan's reach and conversion figures are assumptions, not measurements.**
  The panel says this where an operator reads it. They become findings once
  reach and watch time come back for thirty reels, and not before.
- **Never use ffmpeg's `dissolve` transition.** Despite the name it is a
  per-pixel random-threshold dither, not a cross-fade, and the noise it makes
  is uncompressible: the same 11-second reel was 6.24MB with `dissolve` and
  0.54MB with `fade`. `tests/scenes.test.js` fails if any scene template takes
  it, and flags any template exceeding 700KB a second, which is how this was
  found. I guessed at the zoom headroom first and was wrong; measuring one
  variable at a time found it in two minutes.
- **A client's brand kit may change a caption's typeface, never its structure.**
  `acceptsAccent: false` on the measured presets stops a client's accent being
  applied to a template that highlights nothing. Letting it through turned the
  box under the spoken word orange on `institution`, which is a creator caption
  wearing an institution's clothes, and it is the opposite of why those presets
  exist. A skin that could change size, weight or highlighting would make "the
  Nordic one" mean something different on every account.
- **`client_assets` is the index of everything October has produced**, and the
  only thing that can answer "what have we made for this client". The five
  producing tables (`social_post_media`, `recordings`, `video_projects`,
  `design_pages`, `ad_creative_images`) each stay the record of their own
  production run; this is what makes them findable. Any new producer must call
  `assets.record` or its output is invisible outside the tool that made it.
  `assets.record` NEVER throws at its caller: a render that discarded a
  finished video because the library was briefly unreachable would be far worse
  than one missing row.
- **`ClientVideoPage.jsx` is dead code and nothing imports it.** The Produce
  tab's Edit panel is `ClientEditPage.jsx`; `ClientVideoPage.jsx` is an older
  studio page that no route reaches. Both features that were mounted there, and
  so were never visible in the product, now live on `ClientEditPage`: the reel
  checks and `CaptionTemplates`. Before adding a panel anywhere, check that
  something imports the page you are adding it to.
- **Produce's edit pipeline has two caption paths, and the template one is the
  fork to watch.** With `ops.caption_template` set, `editProcessor.render`
  takes word-level Whisper and `captions.burn`, the same compiler Shared uses,
  so a template cannot mean one thing in Produce and another in Shared. With no
  template it keeps the old segment SRT and its size and position controls,
  which the screen hides while a template is chosen because a template that let
  its size be overridden would stop meaning the same thing on every account.
  The failure mode is not a bad burn, it is the pipeline quietly staying on the
  old path, which looks like a successful render; `tests/edit-captions.test.js`
  compares frame hashes to catch exactly that.
- **The caption format is chosen from the rendered frame, not the requested
  aspect.** An "original" request declares no aspect at all, and a preset
  measured against a 1080x1920 canvas sits wrong on a square one. libass scales
  the ASS canvas to the video, so the aspect ratio is what must match and the
  pixel size need not.
- **`require('./captions')` at the top of `editProcessor` is a cycle.** captions
  reaches back for `whisperWords`, so a top-level require leaves a half-built
  module whose functions are all `undefined` and fails at the call rather than
  at load. Require it inside the function, as the rest of the file does with
  its services.
- **Every finished edit is indexed in the library, from `editJobs.complete`.**
  One call site rather than one per branch of the renderer, stills reels
  included, so no path produces a video and forgets to say so. The job is
  marked done first and the library write is wrapped there as well as inside
  `assets.record`: the guarantee that an index row cannot cost a two-minute
  render is made locally rather than inherited from another file's promise.
  `source` is `edit_job`, and that value has to be added in **three** places or
  it fails in a different way at each: the `client_assets` CHECK constraint,
  the `SOURCES` whitelist in `services/assets.js`, and `SOURCE_LABEL` in
  `AssetLibrary.jsx`.
- **The seven-day retention sweep does NOT cover edits.** It deletes
  `video-clips/` and `video-outputs/`, which belong to the Video Studio
  (`video_projects`). Edit-pipeline outputs live in `uploads/<client>/edit/`
  and nothing deletes them on a schedule; the only deletion is
  `editJobs.remove`, when someone deletes the job. The Video Studio's own UI
  line about files going after seven days describes that store, not this one.
- **A library row is a claim that a file exists, and three things now keep it
  honest.** `client_assets` has no foreign key to any producing table
  (`source_id` is text, because they disagree about key types), so nothing
  cascades and every path that removes a file has to say so itself:
  `editJobs.remove` and `videoCleanup.runCleanup` both call
  `assets.archiveBySource`, and `assets.sweepMissingFiles` runs nightly at
  03:15 beside the retention sweep to catch whatever else. `GET
  /api/assets-audit` (admin) reports the same count without changing anything.
  What the sweep must never judge: a `storage_key` row, which the media store
  resolves, and an external url, which `localPath` hands back unchanged so it
  reads as present. If `localPath` ever stopped doing that, a sweep that looked
  correct would archive every CDN-hosted asset overnight.
- **Edits are served from the edit pipeline's own directory, not the brand
  uploads.** `socialCaptionRender.localPath` is how Tighten, caption render and
  scene render all find a clip, and it only understood
  `/api/brand/file/...`. Once edits appear in the library, every one of them
  answered "that clip could not be found on disk" when a tool next to it was
  used. It now also resolves `/api/edit/file/...` through
  `editJobs.diskPathForUrl`, which keeps the traversal guard. Any new place
  that stores media under its own root needs the same line, or the library
  will offer rows the tools beside them cannot open.
- **An edit render still records no reel judgement.** Word timings exist on the
  template path and the output now has an asset row, but it has no post, so the
  judgement could not join performance until the asset is published. The reel
  that actually goes out is judged on the caption-render path, with its post,
  so recording here as well would add a second judgement for the same reel that
  stays "awaiting numbers" for ever.
- **The reel checks are recorded at production time, not in the browser.**
  `reel_check_results` holds one row per reel produced, written by
  `services/reelOutcomes.record` from `socialCaptionRender`, where the words,
  the template and the duration are all in hand. The panel in the editor runs
  on every keystroke against an unfinished edit; that judgement is worth
  nothing and is never stored. `reelOutcomes.learn` puts those rows beside
  `socialBaseline.score` and reports, per check, the median baseline multiple
  of the reels that passed against those that did not.
- **The eighth check reads the client's tracked search terms.**
  `says_a_term_we_rank_for` asks whether the reel says, or puts on screen, any
  of the client's active `seo_keywords` (top 60 by volume; a list of four
  hundred makes the check true by accident). Matching is whole-phrase on word
  boundaries, never substring: a tracked term like "design" would otherwise be
  found inside "designer" and report a reel as carrying a term it never said.
  Null when the client tracks nothing, because a reel cannot fail a test with
  nothing to test against. The panel and `reelOutcomes.record` read the same
  list from the same place, or a judgement taken on the server and one shown
  in the browser would disagree about what the client is trying to be found
  for. The rule deliberately does not push an operator to force a term in: on
  October's clients that fights the register the rest of the checks protect.
- **Adding a check splits the recorded population, by design.** The eighth one
  moved the fingerprint from `f89b8c8b` to `c92e1bcc`, so every judgement taken
  before it stopped pooling and the panel reports them as excluded. That is the
  cost of a new rule and it is worth paying rarely. `verdict` is now `'all'`
  rather than `'all_seven'`, and the panel's copy counts `result.total` instead
  of saying "seven", because a name or a sentence with a count in it lies the
  first time a check is added.
- **A rule change splits the population, and `RULES_FINGERPRINT` is what keeps
  the two apart.** It is derived from the hype list, the self-promotion list,
  the fact regex, `THRESHOLDS` and the check keys read off `checkReel` itself,
  rather than hand-versioned, because a constant to bump is a constant to
  forget and forgetting it is silent. Change any rule and every row written
  before it stops being pooled; the panel says how many were excluded. If you
  add a threshold, put it in `THRESHOLDS` and read it from there, or the
  fingerprint will claim to cover a number it does not.
- **`Number(null)` is 0, and that nearly turned a withheld baseline into a reel
  that reached nothing.** `socialBaseline` refuses to quote a multiple under
  five comparable posts, so the field comes back null; coercing before testing
  it put those reels into whichever arm they belonged to with a value of zero
  and dragged that arm's median down. Test the raw value for null, undefined
  and empty string before `Number()`. The same trap applies anywhere a nullable
  numeric column meets `Number.isFinite`.
- **A check that nothing varies on is not a result.** If every reel passed it,
  there is no comparison and the passing arm's median must never be printed as
  a lift. Equally, a real sample with no difference is itself the finding: the
  rule does not predict anything for that client, which is worth saying before
  anyone optimises for it.

- **The worked example is the same reel captioned several ways, built from the
  house sample clip and cached.** The cut (tighten plus cutaway) is rendered
  once and each style only re-burns captions over it, so six styles cost six
  burns rather than six edits. `buildSet({ lazy: true })` builds the first and
  names the rest; each video element then fetches its own and builds it on
  demand, which is the difference between the grid appearing in seventeen
  seconds and in ninety-one. A panel showing nothing for a minute and a half
  reads as broken.
- **Do not put `muted` on an example player.** The point of an example is the
  finished thing, and a talking head with its sound off is not it. Audio
  survives every render in the chain (the tighten re-encodes to aac, the
  cutaway and the caption burn both copy it); `tests/example-reel.test.js`
  probes for an audio track, because one stray `-an` would end that silently.
- **The example reports what it could not demonstrate.**
  `services/exampleReel.js` runs the real tighten, cutaway and caption steps
  and reports what it did AND what it could not do.
  That second list is the point: an example that silently leaves out the
  cutaway teaches an operator that cutaways are not a thing this does. The
  cache key carries the sample clip's mtime, so replacing the clip retires the
  example rather than leaving an old render describing footage nobody uses.
- **The house clip ships at four seconds and that is too short for an
  example.** It is sized for caption swatches. The b-roll planner keeps the
  opening and the ending on the speaker, so a four-second clip has no room in
  between and the example honestly reports that it cannot show a cutaway. A
  sample of twenty seconds or more of someone talking, transcribed, is what
  makes the example show all three steps. The source and transcript are
  injectable on `build()` precisely so tests can reach the paths the shipped
  clip cannot.
- **`video-samples/house.mp4` is tracked in git.** Standing in a longer clip to
  verify something overwrites a committed binary, and `git status` is the only
  thing that catches it. Back it up first, or inject the source instead.
- **"Make a reel" is the route, not a pipeline.** `pages/MakeAReel.jsx` owns
  no rendering of its own: it mounts the existing panels in the order a reel
  is made (footage, edit, tighten, b-roll, finish), carries one clip between
  them and lets any step be skipped. The tabs it walks through all still work
  on their own. It exists because captions were chosen in Edit while the
  cutting lived behind a thumbnail in the Library, and a tool nobody finds is
  a tool nobody has.
- **Rendering with chosen settings goes through `reopen`, not `render`.**
  `POST /edit/clients/:id/edit/:id/render` queues a draft with the ops it was
  *created* with, which for a fresh upload is `{}`. `reopen` copies the
  footage into a new job carrying the ops you pass and queues that. The
  walkthrough also needs `from-asset` to start from the library, which is the
  same shape as `from-recording`: the editor only works on files in its own
  directory, so anything from elsewhere is copied in.
- **Stub Whisper at the network boundary, not on the export.**
  `editProcessor.render` calls `whisperWords` through its closure, so patching
  `module.exports.whisperWords` in a `-r` stub does nothing and the real
  request goes out. Wrapping `globalThis.fetch` and intercepting
  `openai.com/v1/audio/transcriptions` leaves every line of the pipeline
  running for real; the multipart body's `response_format` says whether to
  answer with words or an SRT. The `deps` argument on `render` is for tests,
  not for the running server.
- **B-roll planning proposes moments, never footage.** `shared/brollPlan.mjs`
  reads the transcript and says where a cutaway belongs and why; the operator
  picks the clip. Nothing in OMI knows what is inside a b-roll file, so a
  planner that chose for them would place the wrong shot confidently and be
  caught only on playback. Do not add clip matching without first giving the
  library something real to match on; title matching on filenames is not it.
  The defect worth remembering: the planner only proposed at sentence starts,
  so somebody talking in one unbroken stretch for half a minute got nothing at
  all, which is the reel that needs it most. Long sentences now carry
  candidates inside them.
- **The b-roll render overlays, it does not cut.** `brollRender.overlay` keeps
  the base audio and swaps only the picture for each span, which is what b-roll
  is; a trim-and-concat would drop the speaker mid-word. A clip shorter than
  its span is clamped, never looped, and the result says which spans were
  clipped so the screen can tell the operator. Eight cutaways is the cap: past
  that the filter graph is long enough to be worth refusing rather than
  debugging.
- **Keep a panel mounted after it renders.** Both Produce panels cleared the
  picked asset on success, which unmounted the panel along with the one line
  saying what had just happened: the operator pressed go, waited, and watched
  everything vanish without a word. They now keep the selection and bump a
  refresh key instead.
- **A cut plan must be told the file's length.** `planCuts` works from word
  timings, and a transcript ends at the last word Whisper heard. Without
  `media_s` the plan ends there too, so anything after it is dropped silently
  and the render looks like a successful edit. Three bugs in this one function,
  each found by breaking the guarded line and watching the test stay green:
  the hook guard suppressed whole cuts instead of clamping them (a 3s pause
  starting 0.5s in survived untouched, the worst dead air in the reel); the
  plan truncated at the last word, as above; and two cuts 20ms apart left two
  20ms keep spans, which at 30fps is one video frame plus an audio click, twice.
  `min_keep_s` merges them. A sliver shorter than `min_keep_s` is not speech.
- **`apply` renders the spans it is handed, never a fresh plan.** The panel
  computes `keep` from the cuts still ticked on screen and posts that. If the
  route recomputed, a changed default between the proposal and the render would
  cut something the operator never saw listed, which is the one difference
  nobody checks for. Same reason the apply route records a NEW asset
  (`metadata.tightened_from`) rather than overwriting its source.

- **Two clients in a backfill fixture, never one.** The `client_assets`
  backfill joins through `social_posts` and `ad_creatives` to reach a client,
  and with a single post or a single creative a cross join produces the right
  answer by luck. Both mutations passed against a one-client fixture and failed
  against two. Any test of a join that supplies a foreign key needs at least
  two rows on the far side.
- **The `measured` presets were read off October's own reference reels**, not
  ported. Ten museum reels (Rijksmuseum, Getty, The Met, the Bodleian) were
  analysed pixel by pixel: box opacity from the box against the background
  behind it, glyph height in pixels scaled to 1920, colour sampled directly.
  The finding that matters: not one of the ten animates a single word, and all
  ten set type at roughly a third the size of a creator template. The 27 ported
  presets are the wrong library for that work; the four measured ones are the
  right one. Each carries a `measuredFrom` line so a wrong number can be traced
  back.
- **The sample clip is transcribed on upload** so the gallery's captions match
  the speaker's lips. Without an OpenAI key it falls back to a generic line and
  `sampleStatus().transcribed` is false, which the screen shows rather than
  implying the words are real.
- **Seek AFTER the input when burning subtitles for a still.** `-ss` before
  `-i` resets the output timestamps to zero, so the subtitles filter renders
  whatever is on screen at t=0 of the ASS instead of the moment asked for.
  Every caption preview showed the same frame, usually an empty one, and it
  looked like a template that drew nothing.
- **The caption gallery renders every template over ONE clip**
  (`backend/video-samples/house.mp4`, replaceable from the Produce screen by an
  admin) and caches the results in `video-samples/cache/`, which is gitignored.
  The cache key carries the clip's mtime AND the presets file's, so replacing
  either refreshes every example. Drop that and the gallery goes on describing
  footage nobody uses, silently, which is the failure this is built around.
- **Captions render with ffmpeg and libass, not Remotion, and the reason is a
  bill.** Remotion's free licence covers organisations up to three people;
  past that, a tool that renders video sits in their Automators tier at $100 a
  month minimum. libass has no licence and no meter, and burns a 3.5s
  1080x1920 clip in under two seconds against a headless-Chromium render.
  Before putting anything new on Remotion, check the headcount.
- **The 13 typefaces are vendored in `shared/captions/fonts/`** with their
  licences, so a render is identical on a dev box, CI and the server. Do not
  swap that for apt packages or a fontconfig lookup; the point is that the
  same preset produces the same frame everywhere.
- **A caption's body text stays near-white whatever the brand is.** Captions
  sit over ungraded footage, so a client's mid-tone as body text disappears
  over half the shots. The brand shows in the accent word and the typeface.
  `captions.kitFromAssets` also refuses an accent that cannot be read against
  a dark outline, and tells the screen which one it dropped.
- **A test that SKIPs is a test that is not running.** `tests/captions.test.js`
  skips its burn assertions when ffmpeg is absent, so `platform-checks.yml`
  installs ffmpeg and fails the step if it is still missing. Any guard with a
  skip path needs the same treatment or it reports green having checked
  nothing.
- **The press-release highlighter paints longest needle first, and the order
  is load-bearing.** `LAYERS` in `PressReleaseEditor.jsx` is a paint order, not
  a list: each pass splits the text nodes the next pass has to match against,
  so a layer added at the end of the array marks nothing whenever an earlier
  layer is on. The detector layer was written that way and looked exactly like
  a detector finding nothing. `vite build` compiled it and the lint passed it;
  only `tests/browser/highlight.mjs`, which runs the real module in a real DOM,
  catches it. Add a layer at the position its needle length earns.
- **`tests/pangram.test.js` was never in CI** until 26 Oct 2026, so every
  assertion in it predating that date had never run on a runner. Adding a test
  file is half the job; the other half is the `run:` line in
  `.github/workflows/platform-checks.yml`.
- **`new Anthropic()` anywhere is invisible to every cap.** `callClaude` holds
  the global hard cap, so a service that constructs the SDK itself is unseen
  by it, by the per-task cap and by the Pause switch — while still recording
  its spend, so Settings shows money going out that nothing can stop.
  `tests/budget-gating.test.js` exists for this and is only as good as its
  own classification: `services/outreachAi.js` sat in HUMAN_TRIGGERED while
  `classifyReply` ran on the */15 reply poll, which is the fourth file that
  list has had wrong. When you put anything on a cron, check that list.
- **A budget must never be able to stop compliance work.** In
  `outreachReplies.pollReplies` the gate wraps the Claude classification and
  nothing else: marking the send replied, cancelling follow-ups, deterministic
  opt-out detection and out-of-office extraction all run first and are free.
  Five assertions in the budget verification pin that ordering, because a cap
  that silenced opt-out handling would turn a spending control into a legal
  problem.
- **The auto-merge bot's own check run is in the rollup it evaluates.** It is
  posted against the PR head commit, so a naive "every check is green" test
  can only pass when nothing has registered at all — itself included. Combined
  with jq's `all` over an empty array being true, that merged three PRs before
  CI started and declined two that were fully green, on the same afternoon. The
  gate now excludes its own check, requires `backend` and `frontend` to have
  reported when the PR touches `dev/platform/**`, and is tested by
  `.github/workflows/auto-merge-gate.test.js`, which reads the filter out of
  the workflow so the test cannot drift from what runs. If you change that
  filter, run the test.
- **A `check_suite` event from GitHub Actions does not trigger a workflow.**
  Same loop protection as a `GITHUB_TOKEN` push not firing `on: push`. The
  auto-merge bot listened on `check_suite: completed` and so never woke when
  `platform-checks` went green: the only such events reaching it came from
  Cloudflare Pages, which finishes first, so every PR was judged too early,
  declined correctly, and never reconsidered until the `*/30` safety net.
  `workflow_run` does fire for Actions workflows and is what the gate now
  uses. If you add a CI workflow whose result should gate a merge, add its
  `name:` to that `workflow_run.workflows` list.
- **A workflow change runs no checks.** `platform-checks.yml` triggers on
  `dev/platform/**`, so edits to `.github/workflows/**` were entirely untested
  until `automerge-gate.yml` existed. Anything unattended you add there wants
  its own narrow check.
- **A permanent watermark and an improving reader are in tension.** OMI has
  two scan watermarks: `ooo_scanned_messages` (out-of-office) and
  `outreach_reply_catchup.message_key`. Both exist to stop a second proposal
  of the same thing, and both will happily preserve a bad result forever when
  the code that produced it gets better. Both now re-read: the catch-up
  refreshes rows still `pending`, the OOO scanner re-reads messages scanned by
  an older `READER_VERSION` that produced no suggestion. If you improve a
  reader, bump that constant, and check whether anything else is sitting
  behind a watermark.
- **Never read a mail body by splitting on the first blank line.** Use
  `services/mimeText.js` (`bodyText`), and hand it imapflow's raw `Buffer`
  rather than a UTF-8 string. Both readers used to do the naive split, which
  stored a multipart boundary as the journalist's reply, never decoded base64,
  and left the opt-out keyword scan reading base64 — so a typed "please remove
  me" in an Outlook message was missed for months while One-Click opt-outs,
  which match on the subject, worked fine. Headers may be read off the raw
  string; the body may not. See `docs/omi/reply-catchup.md` § Reading the
  message.
- **Email opens are not a signal.** Apple Mail Privacy Protection and Gmail's
  image proxy fetch the tracking pixel with no human involved, repeatedly. Any
  threshold built on `open_count` fires on machines: a 3-open "warm journalist"
  rule produced hundreds of false alerts on one release. Clicks and replies are
  evidence; opens are not. See `docs/omi/press-warm-alerts.md`.
- **MailFlow is a window, not a warehouse — so OMI reads the mailbox itself.**
  `dev/oc-mail` is deploy tooling plus a branding patch for upstream AGPL
  MailFlow consumed as Docker images; the app source is not in this repo. The
  out-of-office contact feed therefore extracts inside OMI's own IMAP reply
  poll (`services/outreachReplies.js`), which had been reading those replies and
  discarding the body all along. Before designing anything that needs MailFlow
  to push data to OMI, check whether OMI can just read it. See
  `docs/omi/ooo-contact-updates.md`.
- **The reply poll's three-day window means a mailbox added late never catches
  up on its own.** Adding press@ fixed everything from that moment and nothing
  before it. The backlog pass is the Reply catch-up
  (`docs/omi/reply-catchup.md`): it scans months, proposes, and writes nothing
  until a person presses go. It has no undo on purpose — both actions it takes
  only stop mail going out, so a wrong apply costs a follow-up, while reversing
  an opt-out would resume mail to someone who asked you to stop. Also: it sets
  `replied_at` to the reply's own date, because stamping a backlog with NOW()
  tells the dashboard everyone replied this afternoon.
- **Reply polling reads a LIST of mailboxes, and a missing one is not a
  reporting gap.** October sends press releases replying to press@ while the
  poll read hello@, so every reply to press@ was invisible — and because
  `looksLikeUnsubscribe()` runs inside that poll, journalists who replied
  "remove me" kept receiving follow-ups. Mailboxes live in `outreach_inboxes`
  (migration 198), not in `OUTREACH_IMAP_*`. Two rules follow: `List-Unsubscribe`
  must name a mailbox that is actually polled, because a header pointing at an
  unread address makes the recipient's client report an opt-out that never
  happened; and "does the polled inbox match the reply-to?" is a question about
  a set, which is why `pollState()` returns `addresses`. See
  `docs/omi/ooo-contact-updates.md` §10.
- **An automatic feed into the contact list needs an undo, not just a review
  step.** `ooo_suggestions.before_state` records the prior value of every field
  an apply overwrites, in the same transaction as the write, and
  `undoSuggestion()` replays it. Contacts created by an apply are deleted on
  undo only when nothing has been sent to them since; deleting one with an
  `outreach_sends` row would take the send history with it. Do not remove that
  column to simplify the apply.
- **The nearest capitalised word before an address is usually not the person.**
  "Hannah Wintle for Sleeper / Starboard at h.wintle@mondiale.co.uk" yields
  *Starboard*, a magazine, and writing it into a contact's name field produces a
  plausible-looking row with nothing to signal it is wrong. The extractor makes
  the address arbitrate: take the capitalised run the local part corroborates,
  and leave the name blank when none does. Related: `Auto-Submitted` must be
  read by value, because a negative lookahead after `\s*` backtracks to zero
  width and `Auto-Submitted: no` then reads as an auto-reply, qualifying every
  message. Both are covered in `oooExtract.test.js`.
- **Confidence scores from an upstream extractor are a sort key, not a gate.**
  In October's own MailFlow export, 109 of 128 rows sat at 0.95, including 36
  whose address never appeared in its own quote and 22 department mailboxes.
  Gate on evidence (is the address in the sentence? does it match the name?),
  not on the number.
- **`getSetting` was never imported into `routes/settings.js`**, and both call
  sites sat inside catch blocks, so the `ReferenceError` was swallowed and the
  setting silently fell back to its default. `AI_DAILY_ALERT_USD` and
  `PRESS_WARM_ALERTS` had therefore never been read from the database. Fixed in
  the workspace-links change; worth re-checking their stored values.
- **Filtering a state out of a selection query is not enforcement.** Only the
  dispatch gate in `scheduler.js runOutreachSends()` is, because only it runs
  after the state can change. `do_not_contact` was excluded by every audience
  picker and both suppression reports for months while the gate ignored it, so
  anyone opting out after a send was queued still got the email. Any new
  suppression or exclusion goes in that gate, not only in the pickers. See
  `docs/omi/press-exclusions.md`.
- **AI spend has three layers**, not one: per-feature model choice, per-task
  budgets (`ai_task_budgets`), and the global `AI_MONTHLY_HARD_CAP_USD`. See
  `docs/omi/ai-budgets.md`. The trap: `callClaude` enforces the global cap,
  but anything calling the Anthropic SDK directly (the researchers, which need
  the `web_search` tool) is invisible to it and must gate itself with
  `budget.taskCapReached(task)`. Wire up every new direct-SDK caller.
- The `costLog.js` price table is hand-maintained and was 25% low on Haiku for
  months. Check it against published rates before quoting any cost figure.
- **A count that does not move reads as "that did nothing".** Country exclusions
  were enforced correctly at dispatch and in the send plan from the start, but
  the audience header counted only the other suppressions, so excluding a country
  left "N to send" unchanged and Daniel had no way to tell it had worked. Whenever
  a rule filters who gets something, the number on screen has to apply the same
  rule and name what it removed, and the test should assert the displayed count
  equals what the send would queue. This is the twin of the older lesson that
  filtering in a picker is not enforcement: enforcement without a visible count is
  just as unusable as a count without enforcement.
- **A hook below an early return is a crash, and `vite build` will not tell you.**
  PressCampaignDetail returns early while the release loads, so hooks added after
  that point run on the second render and not the first; React tears the whole
  page down with "Rendered more hooks than during the previous render". The build
  passes regardless. `npm run lint:hooks` in `dev/platform/frontend` is now the
  guard (the rules-of-hooks rule, nothing else), and it runs on every PR touching
  `dev/platform/**` via `.github/workflows/platform-checks.yml`. Before that
  workflow there were NO checks on a PR at all, which is why the auto-merge bot's
  "every check is green" test was vacuously true.
- **The sandbox really can reproduce a UI bug, and inspection often cannot.**
  Start Postgres (`service postgresql start`), seed a client/campaign/release,
  run the backend on 3001 with `DB_* JWT_SECRET ENCRYPTION_KEY`, `npx vite --port
  5174`, then drive it with the global Playwright at
  `/opt/node22/lib/node_modules/playwright/index.mjs` (it is in neither package's
  node_modules). Auth is an httpOnly cookie, not a bearer token, so log in
  through the page rather than curling a token. The Earned page keeps its tab and
  open campaign in `localStorage` under `omi.earned.<clientId>.tab` / `.campaign`;
  set those before navigating to land straight inside a campaign instead of
  clicking through. Listening for `pageerror` gives the real message in seconds.
- **There are two contact tables, and they are not interchangeable.** Press sends,
  audiences and the Settings media library all use `outreach_contacts`. The
  journalist profile page at `/media/journalist/:id` reads `pr_contacts` through
  `/pr/contacts/:id`, and `pr_outlets` (which has `region` and `domain`, but no
  `country`) is the publication side of that older PR module. Adding a field to
  "the journalist record" means picking one; putting it on both creates two
  columns to keep in sync. Country went on `outreach_contacts` because that is
  what sending reads. See `docs/omi/press-countries.md`.
- **`outreach_contacts.kind` decides which half of the product can see a
  contact, and it defaults to the wrong one.** `media` and `industry` are the
  shared press list; `prospect` is private per-client business outreach. Every
  press surface filters on `kind = 'media'` and the column defaults to
  `'prospect'`, so a write that does not state the kind creates a contact no
  press surface will ever return, with no error to say so. That is how the only
  single-contact form in the product spent months filing journalists as
  prospects. Any new path that creates a contact states its kind; the create
  route whitelists it against `VALID_KINDS` and `tests/contact-create.test.js`
  holds the line.
- **The library has no unique index on email.** Duplicates are prevented in the
  application, by `pressImport.findExisting` (email, else name + company), which
  both the paste importer and the hand-add route use so "the same person" means
  one thing. A create that matches attaches the existing record to whichever
  clients were asked for and returns it flagged `already_in_library` rather than
  inserting; it never re-kinds or overwrites what is filed, because a silent
  overwrite of a record with coverage against it is worse than a duplicate.
- **A ratio is not a ranking.** Social winners were ranked on interactions /
  reach, which puts the smallest posts first: 3 likes on 10 reach scores 30% and
  beats a reel that took 900 interactions on 40,000. The "heater" flag was
  pooled across every platform and format, so on an account where reels
  out-reach everything, every reel was a heater and no LinkedIn post ever was.
  `services/socialBaseline.js` replaced both with a per-cohort leave-one-out
  median and a stated multiple. Three rules make it honest: a post is never in
  the baseline it is measured against; under five comparable posts the scope
  drops to the whole account and `baseline_scope` says so, and under five in
  total there is no multiple at all; and the engagement rate is withheld, not
  printed, below 100 reach. The multiple is also what the generation prompt
  grounds on, so a batch is modelled on posts that genuinely travelled rather
  than on small-reach artefacts.
- **`engagement_rate` is in percentage points, everywhere.** 2.3 means 2.3%.
  `socialOverviewReport` stored the average and then multiplied by 100 again in
  the client-facing summary prompt, so a 2.3% account was described to the
  client as 230%. It is also null by design under the reach floor, so any
  consumer must exclude it rather than coerce it to a zero that drags an
  average down. `socialBaseline.test.js` pins both.
- **A derived field needs to say where it came from.** Country is inferred from
  the outlet, the location text or an email TLD, and the operator excludes
  countries from a send on the strength of it, so `country_source` is stored
  alongside and shown in the UI. Unresolved stays NULL rather than being guessed,
  ambiguous inputs ("Birmingham", `.co`, an outlet region of "EMEA") resolve to
  nothing, and the coverage percentage is surfaced because a filter over 30% of a
  library is not the filter it looks like.
- **Prefer an unrepresentable state to a check you have to remember.** A press
  release can have several audiences, each with its own copy, and a contact in two
  of them would receive two different pitches a day apart (the frequency cap
  reschedules rather than drops). Rather than a dedupe screen, the audience lives
  on `outreach_campaign_contacts`, whose primary key is
  `(campaign_id, contact_id)`, so the second membership row cannot exist. Also
  note what was NOT done: `outreach_sequences` has 46 call sites and the send
  queue `CROSS JOIN`s it, so per-audience sequence rows would have handed every
  recipient every audience's emails. The copy lives on the audience row and is
  overlaid at render time instead. See `docs/omi/press-audiences.md`.
- **An AI extraction that returns nothing must fail, not return nothing.** The
  paste-and-sort contact importer made one Claude call with the input cut at
  12,000 characters and `max_tokens` at 3,000. Past roughly 50 contacts the JSON
  reply truncated mid-object, the all-or-nothing parser returned `[]`, and the
  import reported "0 added, 0 updated" over a real list. The operator saw a
  success toast and an empty audience. Three rules came out of it: give a bulk
  extraction a deterministic path when the input is structured (a CSV with an
  email column now skips the model entirely), chunk anything you send to a model
  so one reply cannot reach the cap, and never let an empty result return
  success. `callClaude` hands back text only, so a caller cannot see
  `stop_reason: max_tokens` and must not assume a parse failure means empty
  input. Guarded by `backend/tests/press-import.test.js`.
- L1 masthead stays **big** (display title + kicker), matching Settings.
- Two "Leads" screens — name which one. Owned→Email→Leads is two-pane;
  Biz dev→Leads stays a table.
- L5 pattern = add an `embedded` prop to the detail modal, then `ListDetail sidebar`.
- Don't brand OMI "nvelope".
- The real next prize is **Phase 3 (GTM Brain)**, not more table refactors.
