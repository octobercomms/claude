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

### Video and audio live in R2, not on the box (30 Oct 2026)

`MEDIA_STORE=r2`. Recordings, transcripts and client assets are in the
Cloudflare R2 bucket `omi-recordings`; the box holds a duplicate of everything
from before the switch, which `media-to-r2.js --commit --prune-verified` will
free when someone decides it is time.

What this changes for you:

- `services/mediaStore.js` has two drivers behind one interface. Write against
  the interface, never against a path on disk. The playback route hands out
  short-lived signed URLs; nothing serves bytes from the filesystem any more.
- `backend/scripts/` holds five scripts for this. All of them load the
  backend's own `.env` from `__dirname`, so they work from anywhere on the box.
  `media-store-status.js` is the one to run first when anything about media
  looks wrong: it prints the active driver and, per key column, how many
  objects are referenced and how many are actually there.
- The four `R2_*` values are in `/opt/october-source/dev/platform/backend/.env`,
  which is gitignored and survives the `git reset --hard` on every deploy.

`docs/omi/loom-replacement-plan.md` has the whole switch, including what it
looked like on the day and the two things that bit.

**Node is 22.23.4 as of 31 Oct 2026** (was 20.20.2, which the AWS SDK drops
after early January 2027). `docs/omi/node-22-upgrade.md` is the runbook, and
read its restart section before any `pm2 kill`: doing that upgrade took
omi.octobercomms.com down, because the daemon runs two apps and the runbook
named one.

**ffmpeg on the box is still 4.4**, which has no `-cues_to_front`, so a
remuxed WebM keeps its seek index at the tail: on a 5-minute capture, byte
16,329,148 instead of byte 465. `services/recordingRemux.js` probes the binary
and drops the flag where it is unsupported, so nothing fails; three recordings
(`13464815`, `1b82dce3`, `b7f3d0c4`) are still indexed at the tail and want
`remux-backfill.js --commit --force` after the upgrade.
`docs/omi/ffmpeg-upgrade.md` is the runbook: a pinned static build in `/opt`
(8.1 as of 31 Oct 2026; BtbN publishes 8.1 and 9.0 and no 7.x, so check the
list rather than a version written down), proven with
`scripts/ffmpeg-check.js`, switched on with two lines in
`.env` and a reload, and rolled back by deleting them. The system package is
never touched.

**One ffmpeg for the whole backend.** Every service takes its binary from
`services/ffmpegBin.js` (`FFMPEG`, `FFPROBE`, resolved from `FFMPEG_PATH` /
`FFPROBE_PATH`). Never spawn the string `'ffmpeg'` in a new service:
`tests/ffmpeg-bin.test.js` scans for it and fails, because the version before
this had four services honouring the variable and seven ignoring it, which
meant two ffmpeg versions inside one request and a bug that reproduced only in
the half you were not looking at.

## 3. How OMI is deployed (READ THIS — it is the #1 source of mistakes)

**Production URL: `https://platform.octobercomms.com`** (that is where the user
looks; it is served from a box via pm2, not from Cloudflare Pages).

**Deploy pipeline**: `.github/workflows/platform-deploy.yml`
- SSHes into the production box → runs `update.sh` → `git pull`, DB migrations,
  `npm install`, frontend `vite build`, `pm2 reload`.
- Triggers: on **push to `main`** touching `dev/platform/**`, **or**
  `workflow_dispatch` (manual).

**The deploy is dispatched for you, but verify it rather than assume it.**
Merges made by the "Auto-merge Claude PRs" bot use `GITHUB_TOKEN`, and those
**do not trigger `on: push` workflows** — which is why this section used to say
you had to run the deploy by hand. `auto-merge-claude.yml` now closes that gap
itself: after a merge it checks the changed paths against
`dev/platform/`, `dev/october-mi-shopify/`, `dev/october-mi-wp/` and
`.github/workflows/platform-deploy.yml`, and if any match it runs
`gh workflow run platform-deploy.yml`, which is exempt from the loop
protection. Confirmed on 30 Oct 2026: PR #1842 merged at 16:54 and deploy run
682 started the same minute, as a `workflow_dispatch` by `github-actions[bot]`.

So after a merge, **check** rather than deploy blind:

1. `actions_list` with `workflow_id: platform-deploy.yml` — look for a run
   whose `head_sha` is your merge commit.
2. Poll `actions_get` until its `conclusion == success`.
3. Only if no such run appeared, dispatch it: `actions_run_trigger` with
   `method: run_workflow`, `workflow_id: platform-deploy.yml`, `ref: main`.

Dispatching a second one is harmless, so when in doubt, dispatch. The case that
genuinely needs step 3 is a change **outside** those four paths that still has
to reach the box, or a merge where the dispatch step itself failed — it logs
`could not dispatch platform-deploy` and says the merge is not live.

**The box runs two pm2 apps, and `pm2 kill` stops both** (31 Oct 2026):
`october-platform` (port 3001, platform.octobercomms.com, `dev/platform/backend`)
and `october-mi-shopify` (port 3002, omi.octobercomms.com,
`dev/october-mi-shopify`, started from `ecosystem.config.cjs`). `update.sh`
reloads each one by name, so a normal deploy is safe. A manual `pm2 kill` —
needed for a Node upgrade, since pm2 keeps the interpreter it started with —
takes the daemon down and therefore both apps. The Node 22 runbook named only
`october-platform`, so omi.octobercomms.com stayed dead after the kill until
someone checked it. Run `pm2 list` first, then start every app it showed.

`update.sh` also syncs `dev/platform/nginx/platform.conf` to
`/etc/nginx/sites-available/`, runs `nginx -t`, and reloads only if that
passes. An nginx change ships with the deploy; it needs nothing by hand.

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
sub-nav. Opening a client from the Clients list lands on `?tab=measure` — you
arrive with a question about the numbers, so the numbers are what loads. The
page is agency-only and now says so in code: a client login that deep-links to
any of its tabs is redirected to its own Data page. It was previously kept off
it by hiding the nav item, which gates nothing; `roWrite` blocked the writes
but the reading was open to anyone who typed the address. Its tabs, in order: **Measure · Reports · Strategy · Setup ·
Connectors**. Measure is the default, because you arrive at a client with a
question about their numbers, not a wish to read an overview of the sections
holding them — the old `setup_overview` landing is now the Setup tab's content.
Setup and Connectors are **not** tabs: they are the cog and the plug in the
client bar, top right, from `components/ClientTopBar.jsx`. The cog opens
`?tab=details`, the brief itself — it briefly opened `?tab=setup_overview`,
a page describing where setup lived, which is not the same thing. That
overview is gone; the readiness checklist it carried moved onto Setup, which
is the only part of it that told you anything. They are
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
- **Data is gone for the agency.** It held Measure, then the Strategist, then
  the Overview, then only the analyst, and the analyst is now a panel on every
  page. `/clients/:id/sales-traffic` redirects an agency login to the Dashboard
  and the nav item is hidden for them. A client login keeps the route and the
  nav item: the Dashboard is agency-only, so Data is still the only place their
  own revenue, orders and traffic appear, and it renders `MeasurePanel`.

### The Overviews are gone (29 Oct 2026)

Every section used to open on an Overview: a hero, a benefits list and a
diagram of links into the section you were already in. All of them are
deleted. Each suite now lands on its first real tab.

| Section | Lands on |
|---|---|
| Dashboard | Measure |
| Data | gone for the agency; Measure for a client login |
| Paid | Measure |
| Earned | Health (Coverage) |
| Shared | Measure (Review) |
| Owned | Health |
| Email | Campaigns |

`SuiteOverview`, `DataFlowMap` and `OverviewChat` went with them — nothing
imported them afterwards. `SocialSuiteOverview` stays and is a different
thing: the Review readout inside Shared's Measure group, which only shares the
name.

Two traps this hit, worth knowing before doing anything similar:

- **Data's Overview was the only thing a client login could see there.**
  Analyse has always been agency-only, so deleting the Overview without a
  second branch would have left every client staring at an empty page — and
  both `ClientHomeDashboard` and the Workspace nav send them there. Data now
  renders `MeasurePanel` for a client login, and nothing for the agency, who
  are redirected to the Dashboard.
- **Earned stores its tab in localStorage.** A stored `overview` from before
  the change would have resolved to nothing, so it is mapped to `coverage` on
  read.

`frontend/tests/tabDoors.test.mjs` is what cleared the deletion: it showed no
Overview was load-bearing, i.e. no tab was linked only from inside one. It
keeps that job — if an Overview-shaped component comes back and a tab ends up
depending on it, the test fails.

Two things worth knowing before trusting or changing it:

- The scanner has its own tests in `tabDoorsLib.test.mjs`, because the first
  two attempts at this analysis were confidently wrong. One regex missed
  accordion items. The next reported Paid's four pipeline steps and Owned's
  `topic_map` as Overview-only — all five reachable through a `StepRail` whose
  handler is passed by reference (`onStep={setTab}`) with keys taken from an
  array by index, so there is no `setTab('render')` anywhere to find. Teaching
  it about that pattern cleared all five.
- It cannot read `ClientPRPage` (tab in `useState`, no allow-list) or
  `ClientDetailPage` (tab straight off the search params). Both are pinned in
  the test's `UNREADABLE` list, so a green run never silently implies coverage
  it does not have, and a third such page fails until someone decides about it.

### The analyst is a panel, and it knows where you are (29 Oct 2026)

The analyst was a tab inside Data, which meant leaving the thing you were
looking at in order to ask about it. It is now `components/AnalystPanel.jsx`:
a chat bubble in the client bar, next to the cog and the plug, opening a panel
over the right-hand side of whatever page you are on.

A panel, not a modal, and that is the whole design:

- no backdrop and no scroll lock, so the numbers you are asking about stay
  visible, and the page behind still **scrolls** while the panel is open;
- **clicking anywhere outside the panel dismisses it**, and that click is
  swallowed rather than passed through, so dismissing never also presses
  whatever was under the cursor. Escape and the × work too;
- the client bar stays put at `z-index: 50` and is covered by the panel. It
  used to sit at 70 and slide left by `--analyst-w` to stay reachable, because
  the panel covering it left Escape as the only exit. Click-to-dismiss replaced
  that exit, so the bar no longer jumps sideways every time the panel opens.

Two things about the dismiss that are easy to get wrong:

- **It listens on `click` in the capture phase, not `mousedown`.** Cancelling
  the mousedown does not stop the click: they are separate events, and the
  first version let the dismissing click also press a button on the page. A
  capture listener runs before the target's own handler, which is what makes
  `stopPropagation` there effective. Mutation-tested: switch the listener to
  the bubble phase and the check goes red.
- **No backdrop element, deliberately.** A div over the page would swallow
  wheel events as well, and scrolling the page to read more of what you are
  asking about is the whole reason this is a panel rather than a modal. The
  capture listener leaves scrolling untouched.

The panel covers the bar at every width, so there is no second element to
exclude from the dismiss handler. If the bar is ever raised above the panel
again, clicks on the bubble will need excluding or it will close and reopen on
one click.

**The PESO sub-nav carries a plain-English chip**: Paid (Ads), Earned (PR),
Shared (Social), Owned (SEO). The model's word keeps the position, because it
is what we plan in and what clients hear; the chip is there so nobody has to
translate before clicking. `.nav-chip` is the one dark-surface chip in the
sheet — every other `.chip-*` is built for a light card, and a white pill on
the dark rail outshouts the label it is helping.

**Those four NavLinks are written out rather than mapped over a table.** A
first pass used a `PESO_NAV` array, and `tests/routeDoors.test.mjs` failed:
`/clients/:id/social` and `/clients/:id/pr` became pages nothing opened,
because a path assembled from an array is a door neither the guard nor a human
grepping for the route can see. Three saved lines are not worth that.

**The persona comes from the section you are standing in.** `utils/analystContext.js`
maps the path segment after `/clients/:id` to one of the four PESO pillar
personas the backend has carried since `chat.js` was built — `ads` → `paid`,
`pr` → `earned`, `social` → `shared`, `seo` → `owned` — and anything else to
the general `analyst`. Each has its own history thread
(`client_chat_messages.thread`) and its own entry in `PILLAR_ACTION_TOOLS`, so
on Owned you are talking to the analyst that can draft a piece of content.

**Nothing in the frontend had ever asked for one of those personas.** They were
built, tested on the backend and then left unreachable. Worth checking for
elsewhere before building something the backend already has.

Three things that cost time here:

- **`chat.js` validates `persona` against its own list and falls back to the
  general analyst for anything it does not recognise, without erroring.** A
  typo or a rename gets you a working chat on the wrong thread with the wrong
  tools and nothing on screen saying so. `tests/analystContext.test.mjs` reads
  `PILLAR_ACTION_TOOLS` out of the route and asserts every persona the panel
  sends is defined there.
- **An effect runs on mount as well as on change.** `Layout` closes the panel
  when `clientId` changes, and without the `lastClientId` ref the mount pass
  closed the panel that `?analyst=1` had opened: the chat rendered for one
  frame, fetched its history on the right thread, and then vanished. The
  history fetch landing correctly is why this looked fine in the network tab.
- **`?analyst=1` is the deep link**, and it is what the old
  `/clients/:id/chat` URL now redirects to, via `?tab=measure&analyst=1`.

`ClientChatPage` takes `embedded`, `clientId` and `persona` as props, and is
mounted only while the panel is open, so moving from Paid to Owned starts the
right conversation rather than re-labelling the previous one. Nothing routes it
as a page any more, so `embedded` is in practice always true and the
`!embedded` branch is unreachable — worth deleting rather than maintaining.

**The panel's chrome was cut back to give the chat the room** (29 Oct 2026),
across PRs #1804, #1805 and #1806. Measured at 1440x1000, the thread ends up
with 78% of the panel height and the header with 56px.

| Was | Is |
|---|---|
| Clear history in the chat body under a hero | small text button beside the × |
| PDF / Word as a button row under each reply | two 24px icons to the right of the bubble |
| Context log as a 260px sidebar | accordion at the panel foot, closed, opening upward |
| Model and Data window on four lines | one line, detail in `title` tooltips |
| Attach and Send in a row beside the box | stacked column, attach above Send |
| Assistant avatar as a black dot | the same filled circle holding a robot glyph |

Four things to know before changing it:

- **`.btn` is already a pill** (`border-radius: var(--r-pill)`), and `.btn-icon`
  / `.btn-icon-sm` are already pill icon buttons. Send looked like a slab
  because a flex row with an 80px textarea stretched it; the fix is
  `align-items: flex-end` and a column, not a new class. Two inline
  `borderRadius: var(--r-pill)` overrides on `.btn` survive in the send row
  from a pass that did not check — they are redundant, not harmful.
- **The export buttons carry icons, not "PDF" / "DOC" labels.** The words cost
  68px of width each against 24px, and that width comes off the message. They
  stay visible rather than hiding behind hover: once they are icons there is no
  height to save, and a download you have to discover is one nobody uses.
- **The avatar keeps its filled circle.** A bare glyph on the panel background
  reads as a stray icon rather than the speaker.
- **The DeepSeek hint stays on screen** while every other model hint moved into
  a `title`. It says this client's pulled data leaves for a third party, which
  should not need a hover to find.

Icons follow one house style, set by `ClientTopBar`: 24x24 viewBox,
`fill="none" stroke="currentColor" strokeWidth="2"`, round caps. `BotGlyph` and
`FileIcon` in `ClientChatPage` match it. There is no shared icon module yet; if
a fifth is needed, make one.

Two traps that cost time in this area, both in the checks rather than the code:

- **`.caption` uppercases its text**, so a test matching a rendered string
  needs a case-insensitive regex. This produced a false pass and then a false
  failure on the DeepSeek warning.
- **A `<select>`'s `innerText` includes all its `<option>` labels.** A regex
  looking for "DeepSeek" in the controls row passed whether or not the warning
  was rendering. Scope such a check to the element that holds the message.

### Money carries the currency the data reported (29 Oct 2026)

Measure, and the client's own Data page, formatted revenue as
`'£' + n.toLocaleString('en-GB')`. Right for a UK store, silently wrong for
Architecture Tours, which bills in USD and had its dollars labelled as
sterling. **A wrong symbol is worse than no symbol: the number reads as a
fact.**

How it works now:

- `shopify.js` and `woocommerce.js` report `summary.currency`, read off the
  orders they already fetch. Shopify needed `currency` adding to the `fields`
  list — same request, no new scope.
- `services/ecomCurrency.js` → `agreeCurrency(summaries)` decides what the
  summed revenue is denominated in. **One currency only when every store
  agrees.** `/sales-traffic` sums revenue with no FX conversion, so a client
  whose stores bill in different currencies has a total that is not money in
  any currency: it comes back with no currency and a note saying so, never
  stamped with whichever store answered first. Junk (`''`, `'£'`, `'pounds'`,
  a number) is treated as no information, not as a currency — Woo returns a
  blank string for a store that was never configured.
- `/sales-traffic/:id` returns `currency` beside `kpis`.
- `utils/money.js` → `formatMoney(amount, currency)` is the only place that
  turns an amount into text. **No currency means no symbol**, not a fallback
  to sterling. A currency with no symbol in its table (CHF, SEK) gets its ISO
  code via `Intl` rather than a guess.

Guards: `tests/ecom-currency.test.js` (backend, its own CI step) and
`tests/money.test.mjs` (frontend). Both were mutation-tested — make
`agreeCurrency` pick the first of several currencies and two checks go red.

**The currency comes from the client, then the stores** (29 Oct 2026, fixing a
regression from the morning). Making the connectors report their own currency
fixed Architecture Tours showing USD as sterling, and introduced a worse
failure at the other end: `kpis.revenue` is set from GA4 **whether or not an
ecommerce connector reported**, but the currency was only resolved inside the
ecom block. A client with GA4 revenue and no working store connector went from
a wrong symbol to no symbol at all — which is what Falcon showed.

`resolveCurrency(clientCurrency, summaries)` in `services/ecomCurrency.js`, and
the resolve now runs **outside** the ecom block:

1. `clients.reporting_currency` (migration `216`, set in Setup) wins. Currency
   is a property of the client, not of whichever connector answered: six stores
   can report in one currency and the account lead knows which.
2. Otherwise whatever the stores agree on.
3. Otherwise nothing, shown unlabelled. Never a guessed pound sign.

**A stated currency does not silence disagreeing stores.** Revenue is summed
across them with no conversion, so stamping one currency on that total is
arithmetic that is simply wrong; the note says the figure is not a true total
rather than letting the label imply a conversion nobody performed. That case
was a bug in the first version of this fix, caught by its own test.

**Ad spend and postcode revenue carry their currency too** (29 Oct 2026), which
clears the last two hardcoded `£` in reporting UI.

*Ad spend* — `services/adsCurrency.js` → `summariseAdsCurrency(clientCurrency,
googleEntries, metaEntries)`, called by `/connectors/client/:id/ads-data`, which
now returns `currency: { google, meta, blended }`, each `{ currency, note }`. It
delegates to the same `resolveCurrency`, so the Paid page and the Dashboard
cannot drift apart on the rule.

The Paid page adds spend up at three levels and each needs its own answer:
Each account on its own (always exact — `entry.data.currency`), a per-platform
"All Countries — Combined" total, and a blended Google + Meta figure. **A UK
plus US Google Ads pair is an ordinary setup**, so the cross-currency sum is
the normal case here, not an edge: the blended total is resolved over both
platforms together rather than inherited from either, because Google in GBP
plus Meta in USD is a disagreement that only appears once they are added.

A failed account contributes neither spend nor currency — the page filters
errors out before summing, so counting its currency would invent a
disagreement that is not in the figure.

*Postcode revenue* — `fetchCustomerPostcodes` on both store connectors now
returns **`{ customers, currency }`** rather than the bare array. Returning the
array again would not throw: `walked.customers` would be undefined and the
distribution would silently read zero, so `tests/postcode-currency.test.js`
guards the shape. The currency is read **before** the postcode filter, because
a store whose orders carry no postcodes still bills in a currency.

Migration `217` caches it on `audience_postcode_cache`, since the distribution
is cached for 24 hours and an uncached currency would leave a cache hit
unlabelled. The client's `reporting_currency` is still applied **at read time**,
so setting it in Setup labels the panel without waiting out the cache.

**`AudiencesPanel` reads `distribution.note` as "no store is connected"** and
hides the whole section when it is set. The currency note therefore travels as
`currency_note`. Putting it in `note` would make the panel vanish.

Everything else matching `£` in the frontend is marketing copy, the design-system
demo, or proposals, which carry their own explicit symbol. `MethodsPanel`'s
"Fixed per market, never converted: £2,500 and $2,500 are different prices on
purpose" is deliberate — do not "fix" it into a conversion.

### The Reports tab's layout (29 Oct 2026)

Setup first, history last: **Weekly and Monthly side by side, then Recent
reports underneath**. Recent reports used to sit on top, and its empty state
read "use the buttons above" while the buttons were below it. Moving the card
made that sentence true.

Three things hold the layout together, and all three are invisible to lint,
the tests and the build:

- **No `alignItems` override on the grid.** `.grid` already stretches its
  items, so both boxes take the taller one's height. An explicit
  `alignItems: 'start'` was what left Weekly short, and putting it back drops
  the boxes to 425px against 618px.
- **Each card is a flex column**, and its action row carries
  `marginTop: 'auto'`. Equal height alone is not enough: without the auto
  margin the shorter box's buttons float mid-card and the two rows sit 193px
  apart.
- **Both Save buttons say "Save changes", not "Save weekly".** Both boxes edit
  one `client` state object and `handleSave` PUTs all of it, so either button
  saves whatever is unsaved on the tab. A per-section label would be a lie.
  The drive script asserts this: editing weekly, saving from Monthly, and
  checking the PUT body still carries the weekly edit.

`tests/` cannot see any of it, so the guard is the browser drive script, with
both layout rules mutation-tested.

### The Strategist has a memory now (29 Oct 2026)

It did not before, and that was the whole problem. Migration `041` said the
next briefing would "ground recommendations in what was actually actioned vs
ignored"; `140` said it would "grade follow-through". Neither wired it up, so
every briefing re-derived the account from nothing: it could not say an item
had been open three weeks, could not follow up on something you fixed, and
wrote the same 24 sections every Monday. **A weekly document that never varies
is one you stop opening.** Length was the symptom; sameness was the disease.

What changed:

- `services/strategist/queue.js` parses the queue and threads it to the
  previous briefing's open items. The model is handed the open list with
  `[A1]`-style tags and copies a tag verbatim to carry an item forward. An
  invented tag, or a tag used twice, is treated as a **new** item rather than
  attaching one item's history to another's — a quieter failure than a wrong
  age. Tests in `tests/strategist-queue.test.js`, its own CI step.
- `215_strategist_briefing_memory.sql` adds `first_raised_at` (carried across
  briefings, so age survives), `carried_from` (lineage) and `rationale` (why,
  kept apart from what).
- The synthesis prompt is now two sections: **What changed** (four bullets at
  most, one line if nothing did) and **The queue**. The old prompt asked for
  "thorough" twice and "in real depth" once across 24 sections, and the model
  was obeying. The pillar prompts shrank from five sections to two plus
  recommendations: they are evidence read on demand, not the briefing.
- The queue is the synthesis's alone. Pillar recommendations stay on their
  sections rather than merging in — two lists of the same work is how six
  items ended up saying one thing.

On screen: What changed leads, then the queue with an age badge past seven days
(not before: the badge exists to make a stale item uncomfortable, and nothing
is uncomfortable on its first morning), each item's reasoning folded behind a
`?`. The four pillar boxes, three of which read "no data", are behind one
**Evidence** line. The strategy checklist collapsed to one line above it, since
it is quarterly reference and the briefing is the weekly read.

Three traps:

- **The synthesis markdown is cut at the queue heading before rendering.** The
  queue renders below as tickable rows, so printing the markdown whole shows
  every item twice. If the model omits the heading, the whole thing renders
  rather than nothing.
- **One level of disclosure inside Evidence, not two.** The first pass kept the
  per-pillar accordions inside it, which meant two clicks to read one
  paragraph, three of the four being pillars with nothing to say. Pillars that
  reported render straight out; the silent ones are named in a line.
- **`loadOpenItems` runs before the new briefing's row is inserted**, or the
  briefing would find itself as the "previous" one.

### Which clients are slipping (29 Oct 2026)

The per-client queue answers "what is open for Falcon". The question an agency
owner has on a Monday is "which of my fourteen clients has something on fire",
and no per-client screen answers that however well it is placed. The Clients
page's **Needs attention** tile does.

`services/strategist/attention.js` → `summariseAttention(rows)` ranks every
client with open crucial items, worst first. `/dashboard` returns it as
`attention: { clients, stale, total, stale_days }`.

Four rules, each there because the alternative makes the number meaningless:

- **Only crucial items count.** Crucial means it moves the needle in the next
  30 days. Letting nice-to-haves raise the alarm would make the alarm useless
  within a month, which is how a "needs attention" number becomes one nobody
  looks at.
- **Stale is 14 days**, deliberately longer than the panel's own seven-day age
  badge. The badge nudges while you are already looking at that client; this
  interrupts across all of them, and an interruption has to earn itself.
- **Worst first means oldest first**, then most items. One item open 30 days
  beats four raised yesterday: age is the signal that something is being
  avoided rather than worked.
- **An unknown age is never stale.** (Belt and braces rather than load-bearing:
  `null >= 14` is already false, so a mutation removing the explicit check does
  not change behaviour and the test cannot tell them apart. The check documents
  the intent.)

An expired token still outranks everything, because it blocks every number
downstream of it. The tile links to the worst client rather than a list: a tile
that names a problem and then makes you find it is half a tile.

**Ages only accumulate from the first briefing generated after `215` shipped.**
Existing items were backfilled to their `created_at`, so historic briefings read
honestly, but nothing has been *carried* yet. For the first week or two the tile
will look quiet, and that is the data being young rather than an all-clear.

### The queue is the panel's second view (29 Oct 2026)

The analyst panel has **Chat** and **Queue**, a segmented pair in its header.
The conversation is where you ask; the queue is what is already on your list.
Both are scoped by the section you are standing in, so the switch is cheap and
neither needs its own icon in a bar that already has three.

**This was undone the same day — the section below is kept as the record of
why, not as a description of the panel.** I argued for a separate icon, was
overruled, and agreed the call had merit I had undervalued. We were both wrong
in the same direction: the question was never which chrome the queue should
wear but whether it should exist in two places at all. Shown the result, the
account lead could not say what the queue tab was. One list with two homes has
an identity in neither. The queue lives on the Strategist now and the analyst
is a chat again.

- `GET /strategist/clients/:id/queue` returns open items from the latest
  completed briefing only. Not "list briefings then fetch the newest": the
  panel needs this on every page and cannot afford two round trips, nor the
  synthesis and pillar analyses that make up the bulk of that payload.
- **A pillar persona sees its own items plus `cross`.** An account-wide item is
  relevant to every section by definition. The general `analyst` persona sees
  everything.
- **The count of what the scoping hid is shown**, with a button to reveal it.
  Without that, a short list on Paid reads as "the account is quiet" when it is
  only this pillar that is.
- **Ticking writes to `PATCH /strategist/briefing-actions/:id`**, the same
  endpoint the Strategy tab uses, so the two never disagree. The item then
  leaves the list: the panel is a working list, and a ticked item belongs in
  the briefing's history rather than in your way.
- **The chat stays mounted while the queue shows**, hidden rather than
  unmounted, so switching views does not throw away a half-typed question.
  Mutation-tested: unmount it and the half-typed-question check fails.
- Reopening the panel lands on Chat. The queue is a glance; the chat is where
  you were working.

The reasoning sits with each item here rather than behind a `?` as it does on
the Strategy tab: the panel is a glance, and a glance that needs a click is not
one.

### The Monday email sends what the platform shows (29 Oct 2026)

Three things were wrong with the weekly cron, and all three were silent:

- **It generated `strategistReport`**, the older ads-only write-up, while the
  Strategy tab showed the cross-PESO briefing. The panel's own copy said
  "emailed to you every Monday" about a document nothing emailed.
- **It selected only clients with an active `meta_ads` or `google_ads`
  connector**, left over from when the briefing was ads-only. A client on GA4
  and Shopify alone got no Monday email and nothing said so.
- **It never read `strategist_active`**, so the "Weekly email" checkbox on the
  Strategy tab did nothing. Unticking it still sent the email.

All three are fixed and guarded by `tests/strategist-weekly.test.js`, which
reads the cron's own source. Blunt, but it is the only thing that fails when
someone reintroduces the ads-only filter, and all three rules were
mutation-tested.

The email now carries the synthesis (What changed, then the queue) with the
open items as the punchlist above it, ages included past seven days. Ticked
items are left out: they are history, not Monday's work. The link goes to
`?tab=strategy`, since `/ads?tab=strategist` no longer exists.

`strategistReport` itself stays — `adAudit.js` and `routes/strategist.js` still
use it. Only the scheduler stopped.

### Two AI conversations, and which is which

There are now two per client, and the names have to carry the difference:

| | Where | What it reads | What it can do |
|---|---|---|---|
| **Ask about this briefing** | Strategy tab | the briefing in front of you | push notes into the next one |
| **Analyst** | the chat bubble, any page | live data for the section you are on | the pillar action tools |

The Strategy tab's chat was "Ask the strategist", which said nothing about the
difference. It now names itself and points at the analyst for live numbers.

**`.caption` uppercases its text.** This has now caught three browser checks,
twice on the same day, including one written hours after this line was added:
`innerText` reports the CSS-transformed text, so a case-sensitive regex against
a rendered caption or section heading always fails. **Match case-insensitively
by default** in a drive script; it costs nothing when the text is not
transformed.

### Measure on each PESO page (29 Oct 2026)

Each pillar page now opens with what that pillar actually drove, and its share
of the account. `components/PillarMeasure.jsx`, on all four.

**Not the whole Measure panel four times.** That would put refund rate and top
products on the PR page, which is noise wearing the costume of data. The pillar
version is the three headline numbers — revenue, orders, sessions — filtered to
that pillar's GA4 channels.

**The share is the frame.** "Paid drove 2,000 sessions" says nothing on its
own; "20% of the account" is the judgement. That was the comparison frame this
work was waiting on, and it is the same question on all four pages, which is
what makes them comparable.

**The data was already being fetched and thrown away.** `salesTraffic` asks GA4
for sessions, users, transactions and revenue grouped by
`sessionDefaultChannelGroup`, then built `channels` from sessions alone. Keeping
the other two cost nothing — no extra call, no new scope — and is why a pillar
page can now say what its channels earned rather than only how many visits they
brought.

`services/channelPillars.js` holds the mapping, guarded by
`tests/channel-pillars.test.js` with its own CI step:

| Pillar | GA4 channels |
|---|---|
| Paid | Paid Search, Paid Social, Paid Shopping, Paid Video, Paid Other, Display, Cross-network |
| Owned | Organic Search, Organic Shopping |
| Shared | Organic Social, Organic Video |
| Earned | Referral |

**Direct is deliberately unmapped**, along with Email, Affiliates and
Unassigned. Direct is returning customers, bookmarks, dark social and
everything GA4 could not attribute; counting it as Earned would flatter PR with
traffic it may have had nothing to do with.

Two rules that are easy to get wrong and were mutation-tested:

- **A share is of the account, not of the mapped subset.** Unmapped channels
  still count toward the total, so a pillar sitting next to a large Direct
  number reads small, because it is. Share-of-mapped would have read Paid at
  29% instead of 20%.
- **A channel that stops matching fails downward and silently.** If GA4 renames
  one, its traffic drops out of its pillar and the pillar reads smaller than it
  is, with nothing on screen to say so. Matching is on a normalised key, and
  the test names every current GA4 channel.

No sessions at all gives a `null` share rather than 0%: with no account to be a
share of, 0% is a claim the data does not support.

### The Strategist: the queue is the product (29 Oct 2026)

**Read this before touching the Strategist, and before redesigning any page
whose content comes out of an LLM.** It is the record of getting the same
thing wrong three times.

The page was redesigned twice in one day. Both times the diagnosis was layout:
sixteen controls above the first sentence, configuration holding the top third,
a left rail spending a third of the width on something you pick weekly. Both
times the fix was real and the page still failed, because the account lead's
actual complaint was never about where the controls were:

> the strategy briefing is so long and dense text. im never going to read this.

**The page was a reader for a document nobody reads.** No arrangement of a
reader fixes that. The cause was one contradiction in `briefing.js`, which had
survived both redesigns because neither looked at the generator:

| | said |
|---|---|
| `SYSTEM` (above both passes) | "Depth is welcome and expected, this is a proper strategic review, not a one-line summary." |
| the synthesis prompt | "At most four bullets, and fewer is better... Nothing else." |
| the pillar prompt | "short and specific... Length is not a measure of usefulness here." |

A model handed both splits the difference. The user prompts were tightened
twice and lost twice, silently, to a system prompt nobody re-read. **When an
LLM feature's output is the wrong shape, read the system prompt before you move
a single div.**

`SYSTEM` now makes brevity the instruction, names the banned moves
(throat-clearing, "it is worth noting", closing summaries that repeat the
above) and says outright that length is never evidence of rigour. "What
changed" is capped at three one-line bullets. The pillar prompt is told where
its paragraph is shown, which is folded under a queue item rather than as a
section of a report.

**The page is now two things: what changed, and what is now yours to do.**

| Gone | Why |
|---|---|
| The pillar filter | It used the tab component, so it read as navigation and instead silently shortened a list. Every row carries its own pillar chip, which is what made the filter unnecessary. |
| The "Evidence" section | A one-word label with no object, sitting apart from the items it was evidence for. It is now under each item: rationale, then that pillar's analysis. |
| Four "no data this period" boxes | A finding the queue already carries. One line now names the silent pillars, which is worth knowing because a quiet pillar is usually a broken connector. |
| The `h2` and its blurb | The tab says Strategist. A page that repeats its own tab spends its first line saying where you are. |
| The settings strip | See the drawer, below. |

Measured: **four chrome controls on arrival** (the Briefing/Ask toggle,
Generate, the cog), against sixteen above the fold before. The rest are the
queue rows themselves, which are the content.
`drive28.mjs` counts the two separately, because a checkbox per queue item is
the page working and conflating the two hides the number that matters.

**The queue has one home.** It was also a tab inside the analyst panel, and the
account lead could not say what it was. Two homes for one list is not
redundancy, it is two half-identities: a strategist's output wearing the
analyst's chrome is unnameable. `AnalystQueue.jsx` is deleted and the analyst
is a chat again. `GET /strategist/clients/:id/queue` stays as the cheapest read
of "what is open on this client", with nothing in the frontend calling it.

**Three inputs looked alike and differed only by when the answer lands.** That
is now said out loud, and they are physically apart:

| | Runs | Lands |
|---|---|---|
| Generate briefing | now | two minutes |
| Ask about this briefing | now | changes nothing |
| Steer the next briefing (in the drawer) | next generation | next Monday |

#### The side drawer, a house pattern

`.side-drawer` in `index.css`, with `.side-drawer-scrim`, `.side-drawer-head`,
`.side-drawer-body` and `.drawer-group`. **Reach for it when a page has a
second audience: the person configuring the thing rather than the person
reading it.** Settings, archives, exports.

Two deliberate differences from `.analyst-panel`, which proved the shape:

- **It takes a scrim.** The analyst deliberately has none, because you are
  reading the page behind it while you ask. You are not, while you set
  recipients.
- **Its body scrolls.** A settings list grows; a chat thread does not.

Each `.drawer-group` names one concern. The strip this replaced put the email
toggle, the period and the recipients in one unlabelled row, so three unrelated
settings read as one setting with three parts.

#### What belongs in a drawer, and what does not (29 Oct 2026)

The account lead asked whether Paid's playbook should be a drawer with
"reference on the left, functions on the right". The answer sharpened the
pattern, so the rule is written here rather than rediscovered:

> **A drawer is for reading and choosing. Anything you would deep link to, or
> spend more than a minute inside, is a page.**

Three consequences, each a thing that was nearly built wrong:

- **One drawer, one job.** The Strategist's drawer earns two columns because
  both halves belong to the same object: asking about the briefing, and
  configuring it. Reference on one side and a tool shelf on the other have no
  relationship, and they put "where does this live" back to three answers.
  `.side-drawer-split` is `1.15fr 1fr` of 1000px, about 530 and 460, which is
  also too narrow for a three-column funnel diagram.
- **Quick reference is a different artefact from the reference.** The Google
  Ads playbook is a funnel diagram you study. Moved into a drawer unchanged it
  would be harder to read than the accordion it replaced. `GoogleAdsPlaybook`
  keeps the diagram and lives in Guide; `GoogleAdsPlaybookQuick` is four rows
  that open one at a time, over the same `LAYERS` data, for answering "what
  should PMax exclude" mid-task.
- **Editing is not choosing.** `AudiencesPanel` (504 lines) and
  `ICPIntelligencePanel` (201) manage standing client data, so they are a tab.
  *Picking* a saved audience while writing a brief is the drawer case.

`SideDrawer` in `components/ui/SideDrawer.jsx` is the one definition now.
Children render whether or not it is open, because it slides out rather than
vanishing and an emptied panel sliding away reads as a glitch; a caller with
something expensive inside gates it on `open` itself, as the Strategist does
with its chat.

#### Paid: Measure is the page, Build is the Produce shape (29 Oct 2026)

Paid had Health (holding Measure, Competitors and Playbook) and Build (the
five-step pipeline, with Audiences and Resize in an accordion of "tools").
Everyone opened Measure. A tab whose only job is to hold the tab you wanted is
a tax, so Health is gone and **Measure is the landing**.

The redesign's organising question was "is this a stage of making an ad?".
**The answers still hold; the chrome they describe does not — every tab below
is a row in Paid's section panel now (§5).**

| Was | Is | Because |
|---|---|---|
| Health → Measure | the Measure tab | it is the page, not a thing inside one |
| Health → Competitors | Build → Competitors | research that feeds a brief |
| Health → Playbook | the ⋮ drawer, full diagram in Guide | reference, not a section |
| Build → Audiences (accordion) | Build → Audiences (tab) | standing data, never a step |
| Build → Resize (accordion) | a row of its own again (31 Oct) | see the correction below |
| nothing | Build → Creative | removed again 31 Oct — see below |

**Build takes Produce's shape**: the guided route first (Make a batch), then
the things that are not steps as peer tabs. That answers the complaint wizards
earn — useful until you want one section — without duplicating each step as
its own tab.

**The creative library did not exist**, so one was built: `GET
/ad-creatives/clients/:id/library` and `PaidLibraryPanel`, with Resize
starting from a library item.

> **Superseded 31 Oct 2026.** Daniel asked for the library to be removed, and
> it is gone along with its endpoint — finished creative is reachable from the
> batch that made it and from the Launch export (§ Paid, third pass). Resize
> has its own row again and takes an upload. The reasoning above was sound and
> the account lead's preference beat it, which is the right order.
>
> The one thing to keep from it: the resize endpoint resolves creative by
> **id, never a URL**, because taking a URL from the client would be an open
> proxy pointed wherever the caller fancied. That branch survives even though
> nothing in the UI reaches it today.

Research reaches the brief now. `briefSeedFor` in `utils/competitorBrief.js`
turns a competitor run into brief text, and the button does not render when
the pull found nothing: a header plus an instruction reads as research that
was never done.

**Old links.** `resolvePaidTab` in `utils/paidTabs.js` is the redirect table
for `health`, `performance`, `playbook`, `resize`, `pipeline` and `creative`.
A deep link that lands nowhere is the quietest breakage there is, because
whoever follows it assumes the feature was removed. `?tab=playbook` opens the
drawer rather than only landing on Measure, for the same reason.

#### The Authority numbers stopped being typed (30 Oct 2026)

Three figures on Owned → Authority were copied by hand every month, and a cron
emailed a reminder to go and do it: **one email per client**, so twelve
identical messages at 08:00 on the same morning, because every client runs on
day 1. That screenshot is what prompted this.

**Referring domains was never missing.** `dfs_backlinks_summary.referring_domains_total`
has been filled for every active client every three days since the DataForSEO
Backlinks API came off its $100/mo commitment on 1 July 2026. SeoDrift reads
it. The Dashboard reads it. The Backlinks panel on the same SEO page displays
it. The Authority panel did not, so the account lead typed a monthly figure
that sat in the same database, ten times fresher, a few hundred pixels away.
**Before building an integration, check whether the number is already there.**

**Moz DA** is now one Moz API call per client per month. The free tier is 50
rows and a row is one site, so twelve clients use twelve. Two properties of
that tier shape `connectors/moz.js`: batching twenty-five sites still spends
twenty-five rows and lets one bad domain fail the whole call, so it fetches one
at a time; and the free limit is about one request per ten seconds, so
`seoAuthority.MOZ_GAP_MS` is 11s and the sweep takes two minutes.

**Use the JSON-RPC API, not the REST one.** The first build of this connector
targeted `lsapi.seomoz.com/v2/url_metrics` with an Access ID and Secret Key
over HTTP Basic, which is what most third-party guides still show. Moz calls
that pair a **legacy credential** and issues a single API token instead:

```
POST https://api.moz.com/jsonrpc
x-moz-token: <token>
{ jsonrpc: '2.0', id, method: 'data.site.metrics.fetch',
  params: { data: { site_query: { query: '<host>', scope: 'domain' } } } }
→ { result: { site_metrics: { domain_authority, page_authority, … } } }
```

**JSON-RPC reports failure at HTTP 200**, in an `error` member of the body. A
client that only checks the status code turns "your token is wrong" into "Moz
returned no metrics", which sends whoever is debugging it to the wrong place.
`call()` raises on `error` explicitly.

moz.com is blocked by the session network policy, so none of this could be
read from Moz's own docs. It was pieced together from a working client and
cross-checked against two independent write-ups, then pinned by tests that
assert the header, the method name, the scope and the normalised query.

**Confirmed working on the live platform on 30 Oct 2026**, with a real token
through the Settings → Connections → Moz **Test** button, which spends one row
and reads a DA back. The shape above is right; treat it as settled rather than
re-deriving it.

**Semrush Authority Score is retired, not dropped.** It measures what DA
measures from another vendor, so collecting both was typing two numbers that
move together. The input is gone; the column stays so the existing trend is
still readable.

The reminder email and its cron are gone with them. A reminder to do work that
no longer exists is worse than no reminder, because it trains you to filter
the sender.

**The rule the whole thing rests on:** a fetch that fails must never blank a
number that is already there. These figures go into a client's monthly report,
so a month that silently loses its DA because Moz was down on the 1st is a gap
in a document that goes to a client. The upsert COALESCEs every metric against
what the row already holds, and a run that fetched nothing writes no row at
all. That is a SQL claim, so it is guarded in `tests/seo-authority.db.test.js`
against a real Postgres rather than asserted about a query string.

Provenance is recorded per metric (`moz_da_source`, `referring_domains_source`)
and shown on the page, because the moment a page starts displaying where a
number came from, every historical row silently reads as API-sourced unless
the migration says otherwise. 219 backfills them as `manual`.

#### Running a .db test in a cloud session (30 Oct 2026)

`migrations/run.js` cannot bootstrap an empty database: it creates
`schema_migrations` itself, then `001_initial_schema.sql` tries to create the
same table without `IF NOT EXISTS` and the run dies on the first file. Postgres
is installed in these sessions but `pg_ctl` refuses to run as root.

What works:

```sh
mkdir -p /tmp/pgdata && chown postgres:postgres /tmp/pgdata
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /tmp/pgdata -U postgres"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgdata \
  -o \"-k /tmp -p 55434 -c listen_addresses=''\" -l /tmp/pg.log start"
psql -h /tmp -p 55434 -U postgres -c "CREATE DATABASE omi"
# bootstrap around the chicken-and-egg, then run the rest normally
psql -h /tmp -p 55434 -U postgres -d omi -c "DROP TABLE IF EXISTS schema_migrations"
psql -h /tmp -p 55434 -U postgres -d omi -f migrations/001_initial_schema.sql
psql -h /tmp -p 55434 -U postgres -d omi -c \
  "INSERT INTO schema_migrations (version) VALUES ('001_initial_schema.sql')"
DB_HOST=/tmp DB_PORT=55434 DB_NAME=omi DB_USER=postgres node migrations/run.js
```

`clients.slug` is NOT NULL, which every fixture has to supply.

Two things that cost time on the second use of this recipe. `initdb` refuses a
non-empty `/tmp/pgdata`, so within one session you **start the existing cluster
rather than re-running the recipe** — the schema is already in it. And a
Postgres started from a backgrounded Bash tool call dies when that call is
reaped, so start it with `run_in_background: true` and a long timeout, or it
will be gone by the next command and the error will look like a code problem.

`backend/tests/press-attribution.db.test.js` is the worked example: two
clients, two overlapping campaigns, and a fixture built so that a join which
forgets to scope by client produces a visibly wrong answer rather than the
right one by luck.

#### A check scoped to the page passes on another section's state (30 Oct 2026)

Swapping Paid's "Show campaigns" button for a `+`/`−` before the label, the
check read `document.querySelectorAll('.ad-acct-detail table').length`. That is
never zero on this page: an account that is the only one on its platform opens
by default, and Meta has one. So "expanding reveals the campaign table" passed
whether or not the section under test expanded, and "clicking the label closes
it again" failed on correct code.

**A check on a toggle belongs inside the thing being toggled.** The fix scopes
the locator to the one section. This is the same family as the earlier
`?tab=setup` mistake: both judged something that was never drawn.

#### Worked examples, one per pillar (30 Oct 2026)

Paid had a worked example since October: a real batch drawn from the client's
own profile, badged "Example", so a brand-new client has something that runs
through every Build step and can be shown to a client. Shared, Earned and
Owned had nothing, so a newly set-up client opened three empty pages and had
to imagine what each produced.

`services/workedExamples.js` is the orchestration, `218_worked_examples.sql`
adds `is_example` to `social_batches`, `content_drafts` and
`pr_press_releases`, and `WorkedExamplesPanel` is the button, on Setup.

Three rules it follows, each the reason a line of code looks the way it does:

- **Idempotent.** The account lead cannot tell by looking whether the button
  has been pressed, so a second press must cost nothing. Every pillar checks
  for an existing example before making one.
- **Badged, always.** An example that cannot be told apart from real work is
  worse than no example, because somebody eventually sends it to a client.
  Every list that shows one carries the chip.
- **Never silent about failure.** One pillar failing neither stops the others
  nor gets folded into a success message. Each returns its own status and the
  panel shows all four, with the reason.

**The flag is set by updating the row the existing generator wrote**, rather
than threading an `isExample` argument through `social.generateBatch`,
`contentDraft.generateDraft` and the press-release insert. Changing three
every-day code paths to serve a setup button is risk taken in the wrong place.

**Placement is deliberate.** It sits below the readiness checklist because the
examples are only as good as the briefing and brand assets that checklist asks
for. Quick Start, higher up the same page, writes the profile; this reads it.
Run them the other way round and you get four thin examples.

The orchestration takes an injectable `registry`, so the behaviour worth
guarding is testable without a database or four Claude calls. What
`tests/worked-examples.test.js` pins is not what any generator writes; it is
that a second press makes nothing twice and that a failure is reported as one.

#### Paid, second pass: the page the account lead actually read (30 Oct 2026)

Eleven points off the live page the morning after the first pass. Two read as
bugs and were not; the rest were the page failing to say what it meant.

**The £ on a section headed "US" is correct.** `formatMoney` never defaults to
a pound sign (a null currency gives a bare number), so a symbol means the
platform reported that code. `store_label` is free text typed on the connector
and describes targeting; billing currency comes from the ad platform, and an
account can target anywhere while billing in anything. The account's reported
currency now prints beside its label, which is the difference between a
wrong-looking number and an explained one.

**The two revenue figures are different systems, not a disagreement.** The
contribution panel is GA4 store revenue attributed last-click; the ad sections
are each platform's own conversion value, including view-through, over a
longer window. On Falcon that is 7,645 against 8,540, with Google alone
claiming 12% more than GA4 attributes to all paid combined. Both are right.
The page now says so above the numbers, once.

**Leading with revenue exposed a platform-wide clipping bug.** `.ds-stat__value`
renders at 40px in a column that can be 150px wide, with no overflow handling.
"£4,800.00" is about 216px, so it was drawn as "£4,800." with the pence cut
off by the tile edge. It had been there all along and nobody saw it while
spend, the smaller number, led every strip. `valueSizeClass` in
`utils/statValue.js` picks a size bucket from the string's length, because CSS
cannot measure it. **A clipped figure is worse than a small one: it reads as a
different, smaller number and nothing says it was cut.**

The rest, and the rule each one came from:

| Change | The rule |
|---|---|
| Ad sections collapse, summary always visible | a collapsed section that hides its own summary is a page that starts empty |
| Each currency note printed once per page | a sentence repeated three inches below itself reads as two warnings |
| ⋮ became a **Playbook** button | a kebab means "several things"; exactly one lives behind this |
| "Make a batch" became "Batch" | the other sub-tabs are nouns |
| The brief form **is** the Brief step | the page said "tell Claude what you want" and gave you nowhere to type |
| The mode switch moved below the brief, renamed "Output" | two full-width pills above the field made a refinement the loudest thing on the page, and "Batch" already named the tab |
| Hand-off buttons gone from every Paid step | the step rail navigates; a second control doing the same thing is a second thing to read |
| `NoBriefYet` on steps with no batch | "pick one on the Brief step" implies briefs exist and you failed to choose |

Steps stay **clickable** without a brief, by the account lead's call: a greyed
rail reads as broken software, and you would have no way to see what a later
step does before committing to a brief.

`PipelineStep` keeps `onNext` because Organic and Shared still pass it. Paid
dropping its hand-offs is not a reason to change pages nobody has reviewed.

#### Paid, third pass: the ten-item review (31 Oct 2026)

Ten items off a page-by-page read of Paid, plus Setup, SOSTAC and the mobile
view. What is worth carrying forward is mostly not the features.

**The Build pipeline is four steps, not five.** Approve was a three-line
summary and one button between two steps that do real work, and a step
implies a decision it did not have. Minting a client link is a header button
beside Playbook now, and it names the batch it is about to share — which the
step could not, because it shared whatever happened to be selected.

**Draft is editable.** Changing a headline used to mean briefing Claude.
`ConceptEditModal` has plain fields with the refine chat beside them, and
applying a revision fills the fields rather than saving, so you can keep
Claude's headline and your own body.

**The framework chip shows `framework_rationale`.** The generator has written
and stored a per-concept rationale since the feature shipped and the frontend
never displayed it. If a field exists in the schema and nothing renders it,
check whether it is being paid for.

**Launch exports.** It claimed to be "a manual export with the pre-launch
checklist" and had no download. A page that describes a capability it does
not have is worse than an empty one, because people plan around it.

**`show_to_client`** (migration 222) holds a concept back from the approval
link without deleting it. Render shows the count, the approval page filters,
and the export records it.

**The Paid library is gone** and Resize has its own row. Resize only ever
hung off the library, so removing one without rehoming the other would have
made a working tool unreachable.

**Audiences is three screens** (ICP, Segments, Customers), behind one
component with a `view` prop. The one-page version had no question it
answered. Daniel overruled a proposal to fix it in place; the split was the
right call and each screen states its job in a line.

**Competitors buys one answer, not two.** Quick Start asked Claude to name
competitors and kept only the hostnames; the panel asked again on every open
and lost the answer on navigation. `client_competitors` (migration 221) holds
the record and `clients.competitor_domains` is rebuilt from it in the same
transaction, because seven services read that column.

**SOSTAC items carry a `how`** — three or four steps written at tailor time,
riding the generation that already runs. `max_tokens` went 5000 → 8000; at
5000 the reply truncated and the parse threw.

**The phone gets a screen picker,** not a 44px horizontal scroller holding
four of Owned's 29 rows at a time.

#### Four bugs nobody reported (31 Oct 2026)

Each was found while doing something else, and each had been live for a while.

**Every legacy Paid alias was broken.** `resolvePaidTab` was being handed the
tab key from `useScreen`, which maps an unknown slug to the section default
before anything else runs — so the table only ever saw `'measure'` and
matched nothing. `/ads/playbook` showed Measure with no drawer, which is
exactly the silent breakage the table's own comment says it exists to
prevent. Every unit test passed throughout, because they called the table
directly with the alias. **Nothing tested the call site.** There is now a
test that reads it.

**`screenForPath` matched `/settings` literally**, so when Database and Biz
dev became sections of their own every `/database/*` path answered null and
the panel lit Health while the page showed Journalists. Mine, from earlier
the same day. It reads the section's own `leaf` now.

**The report builder printed `£` on all e-commerce revenue** regardless of
the store's currency. Harmless while every shop billed in sterling; the
Stripe connector brought a dollar client, and the figure would have been
wrong by whatever the rate is, in a direction nobody checks.

**The connector credential form silently dropped a field's `hint`.** Found by
writing one. Guidance a form discards is worse than none, because whoever
wrote it believes the user was told.

#### The shape of a test that passes for the wrong reason (31 Oct 2026)

Three in one session, all caught by mutation testing rather than by care.
They share a shape: **the assertion could not have failed.**

- **An `||` with a clause that is always true.** `daily.every(d => …) ||
  daily.length === 1` — the fixture put every charge on one date, so the
  second clause held whatever the first did. Spread the fixture across days
  and drop the escape hatch.
- **A case that never reaches the code it names.** The path-traversal test
  used a url with slashes in the filename, which never matches the route
  pattern at all, so it exercised the regex and said nothing about the
  containment check it claimed to test. Deleting that check kept the test
  green.
- **A measurement that does not mean what it looks like.**
  `getBoundingClientRect()` returns a 16px box for a descendant of a closed
  `<details>`, because content-visibility hides without collapsing. The fold
  assertion would have passed with the fold removed. `checkVisibility()` is
  the one that tells the truth.

The lesson is not "write tests more carefully". It is **mutate the code and
watch the test fail**, every time, because all three of these were written
carefully.

#### Three tooling traps in this container (31 Oct 2026)

- **A python `.replace()` with no assert silently does nothing.** Two
  assertions were added to a test file, the anchor did not match, the file
  was unchanged, and the suite reported green with the new checks never run.
  Every scripted edit needs `assert old in s`.
- **Playwright's `uncheck()` fights a controlled checkbox.** It re-reads the
  state before React has re-rendered, concludes its click failed, and clicks
  again — landing back where it started. Use `click()` and wait.
- **A drive must reset the stub at the start, not the end.** Tidying up at
  the end leaves a mess whenever the drive crashes, and the next run then
  fails for reasons unrelated to the code.

#### Two test-shaped mistakes worth not repeating (30 Oct 2026)

Both nearly banked a green run that proved nothing.

**`>= 0` is not an assertion.** A check written
`check('a step says to write a brief', count >= 0)` passes on zero. So does
`check(..., a === 0 || b > 0)` when `b` is always positive. Both shipped into
drive36's first run and both were rewritten.

**Driving the empty state needs a client that is actually empty.** The first
version pointed at a client with a batch, so the empty state never rendered
and the check judged a page that was never drawn. The stub grew a third
client with connectors and no briefs for exactly this.

#### A combined total of one network (29 Oct 2026)

The Paid page printed "Combined · Google + Meta £2,853.94" directly above
"Google Ads £2,853.94". Both figures were right. The strip tested whether a
Meta account was **connected**, not whether it had **spent**, and Falcon's
Meta account spent nothing.

Now `showCombined` in `utils/adsTotals.js`, tested rather than looked at. The
whole class of bugs on this page has been arithmetic verified by eye.

#### A setState updater does not run when you read it (29 Oct 2026)

Worth the space, because it cost a cycle and it looks correct.

Fixing the cross-client leak in `usePaidPipeline`, I wrote:

```js
let take = false;
setActiveBatchId(cur => { take = fresh || !cur; return take ? real[0].id : cur; });
if (take) { /* fetch that batch's concepts */ }
```

React evaluates an updater **eagerly only while the update queue is empty**.
On first mount the queue is empty, the updater runs, `take` is true, and the
fetch happens. After a client change the reset has already queued an update,
so the updater is deferred, `take` is still `false`, and the batch is selected
with its concepts never fetched: the Draft step read "No brief selected" for a
client that had one.

The fix is a ref alongside the state (`activeIdRef`), read synchronously. The
general rule: **never read a value out of a setState updater and act on it
outside the updater.** It works until something else queues an update first.

It was caught by the drive, not by a test and not by reading it back.

#### The same stale-selection bug, third and fourth instance (29 Oct 2026)

`usePaidPipeline` and `CompetitorAdsPanel` both held
`if (nothing is selected) select the first`, keyed on a client. After a switch
the condition is false, so both went on showing the previous client's work:
Falcon's concepts and Falcon's competitor research under Architourian's name.

That is four components now (StrategistBriefingPanel, SeoDriftPanel, and these
two). I still have not added a lint rule, for the reason recorded earlier: the
shape is legitimate in any component that is not keyed on a client, and a
guard that cries wolf gets suppressed. **Checking it is part of reviewing any
panel that takes a `clientId`.**

#### One client's briefing under another client's name (29 Oct 2026)

**Architourian's Strategist showed Falcon's queue**, word for word, down to
"porcelain enamel cookware".

`selectedId` survived the client change. `loadList` would not replace it
because one was already set (`if (r.length && !selectedId)`), and the effect
that fetches the briefing never re-ran because the id had not changed. The
panel kept rendering a briefing belonging to someone else.

**Nothing leaked.** `/strategist/briefings/:id` calls `assertClientAccess`, so
a viewer scoped to one client gets a 403. The account lead is an admin who can
see both, so the API answered honestly and the frontend filed the answer under
the wrong name. Still the worst kind of wrong, because the page gives you no
reason to doubt it.

Two layers now:

- **The reset.** A client change clears `list`, `selected` and `selectedId`
  before fetching. `loadList(pick)` forces the newest, and uses a functional
  `setSelectedId` updater because on a client change it runs in the same tick
  as the reset, so a `selectedId` read from the closure is still the previous
  client's.
- **The render guard.** `mine` checks `selected.client_id === clientId`, so a
  briefing is only ever drawn on the client it belongs to. With the reset
  deliberately broken, this turns the leak into a loading state.

**The test was worthless until it drove the real control.** The first version
used `page.goto` to change client, which is a full page load: the panel
remounts, its state is destroyed, and the bug cannot happen. **It passed
against the broken code in both directions.** The switcher navigates inside the
router, the panel stays mounted, and the stale id survives, which is how this
reached the live platform in the first place. `drive33.mjs` clicks
`.client-switcher-item`.

**The sweep.** Any `if (!selected) setSelected(list[0])` in a component keyed
on a client is the same bug waiting. Three candidates in `frontend/src`:

| Component | Verdict |
|---|---|
| `StrategistBriefingPanel` | The reported bug. Fixed |
| `organic/SeoDriftPanel` | **Same bug.** A stale drift report stayed on screen under the next client, and Compare sent the previous client's `baseline_id`. Fixed the same way |
| `StrategistPanel` | Imported by nothing — dead since `StrategistBriefingPanel` replaced it — and its loader has no guard, so it never had the bug |

`compareToBaseline` looks its baseline up with `WHERE id = $1 AND client_id =
$2`, so the stale id found nothing rather than another client's snapshot. Both
backends were correctly scoped; both frontends were not. **The per-client
scoping in this codebase is consistent on the server and ad hoc in the
components**, which is the shape of every bug in this section.

**No lint rule for it, deliberately.** A static check for "a client-scoped
component resets its selection" produces false positives on every component
that legitimately holds a selection across a prop change, and a guard that
cries wolf gets suppressed. The guard here is the drive-the-real-switcher
pattern in `drive33.mjs`: copy it when a panel holds a selection.

#### The pillar on a queue item (29 Oct 2026)

Falcon's first real queue came back nine items long with **every row reading
ACCOUNT-WIDE**. The synthesis knows which pillar each item came from, having
just read all four analyses, but the line shape had nowhere to put it, so
`generate`'s `r.pillar || 'cross'` caught everything.

Survivable while a filter sat above the list. Once every row carried its own
chip, the chip was noise.

The line shape is now `[CRUCIAL][PAID][A1] action :: why`. `peelTags` takes the
tags off the front in either order, as a loop rather than a wider regex: a
greedy tag group eats an action that genuinely starts with a bracket
("[Urgent] call the dev") and silently drops those words. No tag still means
`cross`, which is the honest answer for attribution work that no pillar owns,
rather than a guess from the text.

#### The empty queue, and why a prompt is not a guarantee (29 Oct 2026)

The first briefing generated under the tightened prompt came back with **no
queue at all**: one line of prose and "Nothing on the queue from this
briefing", on an account with a dead Pixel and three silent pillars.

The cause was a sentence I wrote the same day. The synthesis prompt said:

> If nothing material changed, write exactly one line saying so and nothing
> else.

**On a first briefing nothing has changed by definition**, so the model wrote
the line and read "nothing else" as the whole output rather than the section.
Five Claude passes, paid and owned recommendations sitting inside the pillar
analyses, and every one of them discarded.

Both halves are fixed:

- **The prompt** scopes that sentence to its section, adds a first-briefing
  branch (nothing has changed, so the queue is the entire deliverable and must
  not be empty), and says the page has no figures below the prose, which is
  what the model was writing about.
- **The code** has a floor under it. `queueFor(synthMd, sections)` falls back
  to the pillars' own recommendations when the synthesis wrote no queue, and
  says so on each item's rationale rather than passing them off as a ranking
  the strategist made. It fires **only into a vacuum**: with a synthesis queue
  present the pillar items stay out, because two lists of the same work is the
  failure they were kept out of the queue to avoid in the first place.

**The lesson is the general one.** A prompt is a request, not a guarantee. When
a model's output is load-bearing — when the page has nothing on it if the model
omits a section — there has to be code that notices. `tests/strategist-fallback.test.js`
guards it, in CI, mutation-tested both ways.

`queueFor` exists as a named function for a reason: the fallback was first
written inline in `generate`, where exercising it needs a database and five
Claude calls, and **a mutation that disabled it passed every test**. Pull the
decision out where it can be tested.

#### The drawer took the chat, and the page kept Generate

Second pass on the drawer, on the account lead's own read of it ("i like the
drawer, its cleaned up the briefing"):

- **`.icon-circle` is the house icon button**, the same 34px circle as the cog
  and plug in the client bar. `.client-topbar-icon` is where the rule started
  and the two share it now; use `.icon-circle` anywhere outside that bar.
- **A kebab (⋮), not a cog.** A cog promises settings. This menu holds the
  chat, the downloads and the archive as well, which is what "extra functions"
  means and what a kebab says.
- **The drawer is `min(1000px, 96vw)` and splits in two**: asking about the
  briefing on the left, configuring it on the right, each column scrolling on
  its own so reading the settings does not drag the thread off screen. Below
  900px they stack, because a chat in a 400px half-column is a worse chat than
  the sub-tab it replaced.
- **The Briefing/Ask sub-tabs are gone.** The chat was a sub-tab, so asking a
  question about the briefing hid the briefing — the one thing you need in
  front of you while asking. Behind the drawer the page keeps it.

**Generate stays on the page.** It was offered for the menu and it should not
go: it is the one action that produces the thing the page exists to show, and
on a client with no briefing the empty state reads "click Generate briefing"
with no button anywhere on screen. A page may have exactly one visible action;
it may not have none.

The chat is mounted only while the drawer is open. A shut drawer should not be
holding a conversation, and reopening resumes the stored thread anyway.

#### An unlabelled number has to say why

`/sales-traffic/:id` returns **`currency_unset`**, and Measure renders a line
under the KPI strip saying the money has no currency and linking to Setup.

Showing no symbol when nobody reported one is right, and on its own it is
unhelpful: the account lead gets a headline revenue figure with no unit,
nothing saying why, and nothing saying what to do. It was reported as a bug
twice, and both times the answer was "set the field in Setup", which is a
worse answer the second time. The page should carry it.

**`currencyIsUnset` is not "the currency is null".** Stores disagreeing also
gives null, and that is a different problem with its own note: setting the
client's currency would paper over a cross-currency sum rather than fix it.
Only "nobody has said" gets the prompt. Mutation-tested both ways.

The note is on the client Dashboard only, not repeated on the four PESO pages'
`PillarMeasure`. One place to be told, four places to be nagged.

#### Deleting a briefing

The archive in the drawer, one `×` per row. `destroy()` **survived the rebuild
with no caller** — the only delete control had been in the left rail, which the
first redesign removed, so the route and its confirm dialog sat there with
nothing to press. A capability with no control reads as missing, and was
reported as missing.

Two details: the delete sits *outside* the select button, so picking a briefing
can never bin it; and the archive renders at `length > 0` rather than
`length > 1`, or a client's only briefing could never be deleted.

#### Two traps

- **Both render functions must sit inside the component.** Adding
  `renderSettingsDrawer` after the component's closing brace is **valid
  JavaScript** — a module-scope function declaration — so `vite build` passes
  and every state reference is undefined at runtime. A build is not a check
  that your braces mean what you think.
- **The tab keys did not change.** The labels are `Strategist` and `SOSTAC`;
  the URL keys stay `strategy` and `plan`, because the Monday email links to
  `?tab=strategy` and every briefing already sent carries that link.

`SOSTAC` rather than `Plan`: it holds Situation, Objectives, Strategy, Tactics,
Action, Control, and while one tab was called Strategy and its neighbour Plan,
the two names said nothing about which was which.

### Every page needs a door

Twice on 29 Oct 2026 a working page turned out to be unreachable. First
`ClientVideoPage`, imported by nothing, so the reel checks and caption
templates mounted on it had never been seen. Then `ReportsPage`: routed,
working, and linked only from a KPI tile that was a link solely when a report
had failed, so in a quiet week nothing in the app opened it. Both were found
by Daniel asking where he was meant to be looking.

`frontend/tests/routeDoors.test.mjs` now walks the routes in App.jsx and fails
when one has no link anywhere in `src/`, top-level and client-scoped
(`/clients/:id/*`) alike. A route whose element is `Navigate` or a
`<Something>Redirect` component is a redirect, not a page, and is skipped.

Both matchers look for a navigation — `to=`, `href=`, `navigate(` — not a
mention of the path. That distinction has now caught the test out twice: the
first version counted a page's own `api.get('/reports')` as a link to itself,
and the client-scoped version counted `ClientTopBar`'s `location.pathname ===`
comparison. Reading a path is not offering one. Genuinely URL-only pages go
in its `URL_ONLY` map with a reason. It catches "no door at all", not "a door
that is sometimes shut" — a conditional `to={cond ? '/x' : undefined}` still
reads as a link, so that judgement stays with you.

`/reports` and `/lab/checker` are both redirects now: Reports and the checker
bench are tabs under Settings → Tools, and the routes are kept so old links
and the Clients report tile keep working. `SettingsTabRedirect` carries the
query string across, so `/reports?status=x` lands on
`/settings?tab=reports&status=x` with the filter intact.

Client-scoped orphans found when that half went in: `/clients/:id/brand` had
no link at all (its only affordance was a node in the Dashboard setup diagram
pointing at `?tab=brand`, a tab with no render block — a dead link inside a
diagram whose whole job was wayfinding). It is now linked from the Setup tab.
`/clients/:id/audiences` and `/clients/:id/ai-visibility` are shells around
`AudiencesPanel` and `AIVisibilityPanel`, which already live inside Paid and
Owned; they are recorded in `CLIENT_URL_ONLY` as pending removal.

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

### Navigation: the two panels (30 Oct 2026)

**There are no horizontal tab strips left in a client section.** Every
destination is a row in the section panel, the narrow column between the nav
and the page. If you are adding a screen, you are adding a row to
`frontend/src/nav/sections.js`, not a tab.

Why it changed: a strip holds four or five items. Owned had 28, so they were
folded two levels deep into single-open accordions behind group tabs, and
`?tab=site_audit` was rewritten to `?tab=optimise` with a section opened inside
it, so a link to a tool could not be shared. Give each job a row with its own
`?tab=` and the accordion has nothing left to do.

What this means in practice:

- **`nav/sections.js` is the single source of truth.** Written out literally,
  a row per destination, so a screen with no way in shows as a missing line
  rather than as a working page nobody can open (this codebase has shipped that
  three times). `tests/sectionPanel.test.mjs` reads each page's own
  `useTabParam` whitelist and checks both directions. A tab you add to a page
  and not to the panel fails that test; so does a row naming a tab the page
  does not accept, which would silently land on the page's default.
- **Every group is open.** The first version kept one open at a time to avoid
  scrolling; Daniel's read after using it was "i dont want pages hidden. thats
  more clicks", and he is right that the cost sits in the wrong place — a
  collapsed group charges a click on every visit to save a scroll that costs
  nothing. A heading still collapses by hand. Do not seed the collapsed-set
  state to change that: the effect that resets it on a section change also
  runs on mount, so an initial value is cleared before the first paint.
- **`scope` is `'client'` or `'global'`.** The panel needs it: it used to
  require a client id before rendering anything, so Settings' rows never
  appeared and the panel looked unwired rather than broken.
- **Every screen is a path segment**, `/clients/:id/<leaf>/<slug>`, and
  `/settings/<slug>`. There is no `?tab=` left in the app and no redirect from
  the old scheme: nothing external links into OMI (the only outward URLs are
  the `/coverage` and `/watch` token pages), so 21 legacy aliases and 11
  redirect routes were deleted rather than carried.
- **A row has two names and they are allowed to differ.** `tab` is what the
  page compares against; `slug` is what the URL says, defaulting to `tab` with
  underscores hyphenated. They differ on 23 rows where the key predates the
  name the section settled on (Paid's Draft is `concepts`, Earned's Track is
  `coverage`, Shared's Workbench is `produce`). Renaming the keys would mean
  blind string surgery across six large files — `'ads'` is also a connector
  type, `'audit'` an API path — for nothing the URL can see.
- **Pages read `useScreen('<section>')`**, which returns the page's own key.
  `useTabParam` survives only for a page embedded inside another (Outreach,
  the analyst chat), which is the one place a query param is still right.
- **A numbered step is for a real sequence only** (the Produce pipelines). A
  vertical row can print "4" but cannot show you that three are behind it, so
  those keep an in-page `StepRail` as well. Everything else is a directory.
- **`PageShell`'s `tabActions` is the section's action row** — the drawer
  openers and the one control that applies section-wide. It used to render only
  when `tabs` was passed, so removing the strips silently dropped Paid's
  Playbook, Earned's Share and Shared's DM bot openers while every test stayed
  green. It stands on its own row now.
- **A drawer mounts at page level, never inside a tab**, with its opener in
  that action row, and the row holds two or three at most. That ceiling is what
  stops the junk-drawer problem: a section needing a fourth drawer has
  something in there that should be a page.
- **`tests/lib/tabDoors.mjs` counts a panel row as a door**, which it is and a
  better one than the in-page links it looks for.

Widths and colours are measured, not chosen, and the numbers have no slack in
them worth spending. In Brockmann at 14px the widest nav row is "Shared" plus
its Social chip at 110px, so the 170px nav indents 24px rather than 40px (at 40
the lane is 106px and the chip clips). The widest panel row is `Keyword
footprint` at 124px against a 142px lane, so a 150px panel breaks it. The nav
is `#000000` because the logo has a black background and `#0b0b0c` shows an
edge — **do not put a gradient back on `.app-nav`**, there was one and that was
the cause. `#000` against the panel's `#222` is only 1.32:1, so the 1px `#333`
divider is doing the separation, not the fill.

### Layout inside the page responds to the page (30 Oct 2026)

`.app-main` is a named container (`container: appmain / inline-size`) and
in-content layout uses `@container appmain (...)`, not `@media`. Chrome is no
longer one width — the nav collapses, the panel opens — so a viewport query
cannot see a content box that has already shrunk.

If you write a breakpoint for something inside the page, write a container
query, and rebase the threshold: the gap between the window and the content box
is 322px above 768px (nav, border, padding) and 32px at or below, where the nav
is `position: fixed` and out of the flow. `tests/containerQueries.test.mjs`
fails a viewport query that lays out content inside `.app-main`.

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

### The Costs panel reported the whole Anthropic account (31 Oct 2026)

`usageTracking.js` called `/v1/organizations/usage_report/messages` with no
filter, so the Anthropic card showed every key on the organisation and
presented it as what OMI costs to run. On this account that is roughly four
times the real figure: a separate mail app on its own key was $55 of an $89
month. The account lead's instruction was explicit — "i dont want OMI to factor
in all claude api costs - only OMI api costs."

The report takes `api_key_ids[]`. OMI holds the key *secret* and the report
wants the key *id*, and nothing converts one to the other — but the admin key
can list the organisation's keys, each with a `partial_key_hint` of the form
`sk-ant-api03-R2D...igAA`, and a hint matches a secret on its two visible ends.
That is `services/anthropicKeyScope.js`. **When no key matches, the card shows
no figure and says why.** An org-wide total is not a fallback; it is the bug.
`ANTHROPIC_OMI_KEY_IDS` in Settings is the manual override for a rotated key or
an admin key that cannot list.

The rows are checked locally as well, by grouping on `api_key_id`. If the
bracket serialisation were ever wrong the API would ignore the filter and
answer with the whole organisation, which looks like a number rather than an
error. **A null key id is kept, not dropped** — null is also what the report
returns when the grouping is missing, so discarding those would turn a dropped
parameter into "you spent nothing this month". A mutation test caught exactly
that.

Three pricing faults surfaced on the way, all silent, all in `costLog.js`:

| | Was | Actually | Effect |
|---|---|---|---|
| Opus 4.8, Opus 5 | 15 / 75 | 5 / 25 | over-reported 3x, on the model behind ten call sites |
| Fable 5 | 3 / 15 | 10 / 50 | under-reported 3.3x |
| Cached writes | read from a flat field the report never sends | `cache_creation: { ephemeral_5m…, ephemeral_1h… }` | every cached write cost nothing |
| Model attribution | no `group_by`, so `model` was null | grouped by model | the whole month priced at the Sonnet fallback |

**If you touch pricing, check the published list rather than the table.** It
was wrong for months and nothing complained. Models the table does not carry
now land in `UNPRICED` and are reported in the card's raw payload instead of
being quietly charged at the default, and cache reads take the model's own
multiplier (0.05x on Opus 5.5 and Sonnet 5.5, 0.025x on Fable 5.1).

One thing left: the endpoint is now marked legacy in favour of
`/v1/organizations/analytics/usage`. Migrating is its own piece of work.

### Six dead links, and the scan that now catches them (31 Oct 2026)

The review reported one: Snapshot Studio's "All leads" button went to a blank
page. `/leads` is not a route — there is a `leads/:id` and the list is at
`/biz-dev/leads`. The scan written to catch this found five more, four of them
left behind when Database and Biz dev moved out of Settings (task #54):
`/settings/journalists`, `/settings/proposals` (three sites) and
`/settings/tenders`.

`routeTargets.test.mjs` already had a scan for this, and it only looked at
`/clients/…` paths. That prefix belongs to the router and nothing else, so it
can match every quoted occurrence. A top-level path has no such marker: the
first version of the new scan reported `/g` (a regex flag), `/100` (a score),
`/logo-black` (an image) and sixteen backend routes whose `api.get` sat on the
line above. **Direction 3 therefore reads only `navigate()`, `to=` and
`href=`**, and accepts the known gap that a path assigned to a variable first
is not seen. A scan with twenty-two false positives is one nobody keeps.

Every one of the six is now built from the section table, the way
`SectionPanel` and `GlobalSearch` do it, so the next move takes the links with
it instead of leaving another literal to rot.

### Search covers credentials now (31 Oct 2026)

"I typed n8n and it found nothing… So i don't think it's searching enough."

Correct: `routes/search.js` covers eight record tables, and the palette matches
the 91 screens from `nav/sections.js`. A credential is in neither, so none of
the 67 keys OMI holds was findable — not n8n, Moz, DataForSEO or Stripe.

The three constants that drove Settings (`KEY_GROUPS`, `CATEGORIES`,
`SUBTAB_CATS`) were local to `SettingsPage.jsx`, which is why nothing else
could see them. They are now `src/settings/catalogue.js`, with
`settingsEntries()` deriving one row per credential: its label, its variable
name, the group it sits in, and the settings slug that renders it, worked out
by reversing `SUBTAB_CATS`. `matchSettings` in `screenSearch.js` ranks them.

Two things worth keeping:

- **A row says which provider it belongs to.** Several providers call their
  key "API token", so the title is "Moz · API token" unless the label already
  names the provider. Matched on whole words, because a substring test called
  every Amazon key a Moz key.
- **An exact-match tier was written and then deleted.** A mutation proved it
  could be removed without any assertion noticing: an exact match is also a
  prefix match, so it only ever changed a tie, and ties were already settled
  alphabetically in the right order. Three tiers, not four.

The ranking test needed labels whose alphabetical order *opposes* tier order.
The first fixture used names where A-to-Z happened to produce the same
sequence as the tiers, so deleting either tier changed nothing and the test
passed on code that no longer ranked at all.

### Avatar reels and trending sounds, same fault (31 Oct 2026)

Reported the same day as the ad-creative fix, and the same bug:
`heygen.js` stored HeyGen's own presigned `video_url`, so an older reel played
as blank video and "open in new tab" answered access denied. Trending sounds
stored `music.playUrl`, TikTok's signed audio CDN link, which 403s when
clicked.

Both now go through `generatedMedia`. Reels are fetched when `refreshOne`
sees `status: completed`; a failed download keeps HeyGen's link rather than
losing a render that has been paid for, and `keepExisting(clientId)` backfills
the rows whose links are still alive, offered from the reels panel.

Two things in the reel path would have broken silently, and are the reason to
look for consumers before storing anything locally:

- **The Drive copy.** `scheduleAsPlan` uploads the reel to Drive by file path
  via `downloadToTemp`, which fetched a URL. With a stored reel that argument
  is a relative path, which is not a URL. It now copies off disk instead, and
  copies rather than hands over the file, because the caller unlinks what it
  is given and the stored reel is the only copy.
- **The publisher.** It does *not* use `video_url`: it serves the Drive copy
  to Meta through a signed media proxy on OMI's own domain
  (`routes/social.js`). That was already right, and the comment at
  `heygen.js:281` shows someone had met the expiry problem before and worked
  around it with Drive rather than fixing the storage.

**The sounds link is the music page now, never `playUrl`.** `playUrl` is kept
as `audio_url` because it is the only thing that could ever play inline, and
`search_term` carries title plus artist, which is what you type into TikTok
or Instagram to find a sound and use it. There was also no cron at all: the
snapshot was written only when somebody pressed refresh and the reader ignores
anything older than seven days, so the list silently emptied a week later.
One global snapshot now refreshes on Mondays.

`frontend/src/utils/storedMedia.js` holds the one rule for "is this kept
here", used by both panels that offer to keep older media. It is stricter
than the inline `startsWith('/api/')` it replaced, which would have counted
`/api/ad-creatives/…` as stored media.

### Generated creative is kept here now (31 Oct 2026)

Every image generator returns a URL on its own CDN, and those URLs expire —
Replicate's within about an hour, Ideogram's within a day. `ad_creative_images`
stored that link as `url`, so the row stayed well formed while the asset behind
it disappeared. What it cost: Launch's export zip wrote the file into
MISSING.txt, the client approval page showed a broken image where the ad was,
and Resize and the fan-out, which both work from an existing image, had to
re-generate and re-pay for work already done.

`services/generatedMedia.js` now fetches the bytes at generation time and
writes them under the client's upload folder, exactly as an upload has always
been stored. `source_url` keeps the provider link, `stored_bytes` records the
size and doubles as the "is it kept" flag (NULL means it is not). A download
that fails never loses the render: the row falls back to the provider URL and
the response says why, which is the only honest option when the generation has
already been paid for.

**The part that is easy to miss.** Storing locally breaks anything that hands
an asset URL to a third party, and there were three such places:

- The **fan-out** ran on the Photoshop API, which fetches the source itself
  from a URL. OMI's files sit behind authentication at a relative path, so it
  could never read them — the fan-out was **already broken for every uploaded
  source** and would have broken for all of them. It now runs on the same fal
  expand path the Resize tool uses, which takes bytes as a data URI.
  `adResize.resizeImage` grew a `sizes` parameter for that: the fan-out wants a
  true 16:9 and the ad-size catalogue's nearest entry is 1.91:1.
- **Resize from the library** called `fetch(img.url)` on a relative path.
  `fetch()` cannot take one, so it threw on every library image and logged it
  where nobody looked while the UI reported a resize of nothing. Also already
  broken for uploads.
- **Video** passes a reference still to Replicate, which reads a URL. A stored
  still is handed over as a data URI instead. An image-to-video model given a
  reference it cannot read does not fail — it produces a clip of something
  else.

If you add anything that sends an asset to an external API, assume the asset is
a local file and send bytes. `generatedMedia.readBytes(row)` is the one way to
get them, and it keeps a remote copy on the way past.

Rows written before this change are backfilled from Launch, per client, and
only the links still alive can be saved. The button disappears when there is
nothing left to keep.

### The design sweep, batch 2 (31 Oct 2026)

Nine small items off the 31 October review, in `ClientPRPage`,
`PressReleaseEditor`, the two `components/organic/` Fix panels,
`RecordingsPage`, `SettingsPage` and `ClientSocialPage`. Four things in here
will bite the next person.

**`.field` has a 16px bottom margin.** Put a `.field` in a grid row beside a
button and the two will not line up: the margin lifts the field off the track
floor while the button with no margin sits on it, so with `align-items: end`
the button lands a clear step below inputs that are level with each other. The
monitor row zeroes it (`.monitor-add .field { margin-bottom: 0 }`) and lets the
grid's own `gap` do the spacing. Any new field-plus-button grid needs the same.

**`.h3` is 14px.** Same size as `.body`. It reads as a heading class and is
not one: a record's title wearing `.h3` is the quietest line on its screen,
which is what the Releases editor did. For the name of the thing you are
editing use `.h1` or `.h2`, both 24px, on an `h2` element where the page
already has an `h1` for the section. `.display` (40px) belongs to the page
masthead. The five `--fs-*` tokens are the whole scale.

**`usePersistedState` is the one way to remember a per-person setting.**
`hooks/usePersistedState.js`, keys prefixed `omi:`. It replaced the eighth
hand-rolled copy of read-localStorage-in-an-initialiser,
write-it-in-an-effect, and **two of those eight had no `try/catch`**
(`ClientChatPage`'s model picker, `ApprovePage`'s reviewer name). An unguarded
read throws where site data is blocked, and it throws during render, so the
page went blank instead of falling back to a default. `ApprovePage` is the page
a client opens from an email, the likeliest of all of them to be opened in a
private window, and a client who cannot load it cannot approve anything. Do
not write another one by hand.

**`.btn-ghost` is a deprecated alias of `.btn-secondary`.** About 110 call
sites keep it rendering; prefer `.btn-secondary` in new code. And a row action
carrying `style={{ padding: '0 var(--s2)' }}` is not a styled button, it is a
button with its vertical padding removed — it reads as coloured text. The two
Fix panels had four of those.

**A table of rows does not get a primary button per row.** Twenty rows with a
primary in each is twenty primaries. Row actions are all `.btn-secondary` and
the labels carry the difference; the one exception is a row whose single job is
to open the record (`Open` on the Record list), which is the yellow.

---

### The 31 Oct review, later batches (31 Oct 2026)

Twelve PRs off one review. What is worth carrying forward is not the list of
changes; it is these.

**The expiring-provider-link fault has now appeared three times in one day**, and
the fix has a settled shape. Migrations 223 (ad creative), 224 (avatar reels),
225 (library clips): add `source_url` and `stored_bytes` to whatever table
holds the row, fetch the bytes through `services/generatedMedia.js`, point
`url` at the local copy, keep the provider link in `source_url`, and give the
table a partial index on "still somebody else's". **Assume the fourth exists.**
Any table with a `url` column that a provider wrote is a candidate; grep for
one before building anything that reads media.

**`assets.keepRemote(asset, { check })`** does this for `client_assets`, and
`assets.unstored(clientId)` is the backfill's question. The `check` is the URL
guard, injectable only so a test can serve from loopback. No caller in the app
passes one, and the default refuses loopback, private ranges and link-local —
a provider answering with 169.254.169.254 would otherwise have this box fetch
its own cloud credentials and file them in a client's folder as a video. **A
drive that injects a permissive check must first assert the default refuses
its own origin**, or the drive becomes evidence the guard is off.

**Both media services hardcode `backend/uploads`.** `socialCaptionRender.js`
and `generatedMedia.js` build their store from `__dirname`, not from an env
var. `UPLOAD_ROOT` is not a thing. A test fixture has to be written there
(it is gitignored) and cleaned up after.

**`adExport.readAsset` is the one asset reader.** `socialExport.js` reuses it,
plus `toCsv`, `slug` and `extFor`. The two exports answer the same question
about different records and the place they must not disagree is "where did
this asset go". Do not write a third.

**`utils/fieldEdit.js`** holds the rule for two things editing one field, which
is the ordinary case on Shared's Review screen: the post's fields on the left,
a Claude refine chat on the right, both writing the same hook and caption.
`fieldState` tells "I changed this" apart from "somebody changed it under me"
by comparing the record against the value **at focus**, not against the draft.
Comparing against the draft is arithmetically identical to `dirty`, so the
warning fires on every keystroke — a mutation proved that while every test
still passed.

**The section panel's markup is `.sp-group` → `.sp-heading` → `.sp-label`.**
Read groups as groups. An earlier drive inferred headings by walking text
nodes beside `.sp-heading-mark`; that works on Settings and returns *nothing*
on Shared, so it passed by luck of markup.

---

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

### Two decisions that changed when the explanation arrived (31 Oct 2026)

Worth recording as a working practice rather than as two facts.

The 31 Oct review's deletion answers were "Earned Measure: delete" and
"Shared autopilot: delete". Both were given before anyone had written down
what either thing actually did. Rather than act on them, the previous session
built the replacement for the autopilot first (the batch download, PR #1881),
wrote the explanation into `docs/omi/review-31-oct.md`, and left both
deletions. Put back with the explanation attached, **both answers changed**:
the autopilot is kept but off for every client unless deliberately turned on,
and Earned's cross-campaign total was folded into Coverage rather than lost.

Two things generalise. A deletion decided without the explanation is not a
decision yet, and the cheap move is to build the replacement first so the
answer is not forced. And sitting on it is not the other option: carrying the
question across sessions is how a decision goes stale. Ask once, with the
explanation and with the original answer as the default option.

What came out of it in code: migration 227 flips
`clients.social_autopilot_paused` to default `true` and pauses every existing
client, because the old default `false` meant live and every client created
since migration 046 was on a cron that posts to Instagram, Facebook and
LinkedIn with nobody clicking go. `tests/autopilot-off.test.js` is in CI and
holds the default, the publisher's filter and the screen's wording. Earned's
Measure group, its Reports row and `PrBacklinkRoi` are gone;
`PrBacklinkTotal` puts three tiles at the top of Coverage.

### The video timeline is being built, surface first (31 Oct 2026)

`docs/omi/video-timeline-spec.md`, whose section 7 is the build log and the
place to add to. Daniel chose **option C, build it**, with **WebCodecs** for
the preview, and said to go straight at the timeline with no interim fix. The
surface and the model are in; the preview is not.

**The edit is one object now.** `dev/platform/shared/edl.mjs` is the edit
decision list: a list of blocks, each naming a clip index and an in/out point
within it, laid end to end on one track. It is pure, it is the only place the
arithmetic lives, and both sides use it. `Timeline.jsx` edits it,
`compile()` turns it into the cut list, and `editProcessor.cutEdl()` renders
that. The EDL rides in the existing `edit_jobs.ops` JSONB as `ops.edl`, so no
migration and reopen works unchanged.

Four things to know before touching any of it:

- **Never compare a block length to `MIN_ITEM` directly.** `(5 + 0.05) - 5` is
  0.049999999999999822, so an exact comparison deletes blocks that are exactly
  the minimum length, and deletes them at 5s while keeping them at 1s. Use
  `atLeastMin(from, to)`. Times are pinned to the microsecond by `secs()` for
  the same reason: without it two blocks that should abut are drawn with a
  hairline between them.
- **`compile()` output carries its own `clip` index, so read that, never the
  position.** compile drops blocks (no URL, a cut too short to be a cut), so
  `items[i]` and `compiled[i]` are not the same block. Getting this wrong
  renders the right cut from the wrong footage, and nothing downstream catches
  it.
- **`clipPaths` in the processor is index-aligned with `clips`, with nulls.**
  It used to be built by pushing only the files that existed, which shifted
  every index after a missing clip. That was harmless while clips were whole
  and in order and silently wrong once indices mean something.
- **One video track, on purpose.** Stacked tracks mean overlay compositing,
  which the processor cannot do. Do not draw a second track: a track that
  renders to nothing is the page lying about its output, which is the whole
  complaint this work answers.

**The filmstrip is in, and it runs in the browser, not on the server.** The
spec said ffmpeg-on-upload; that cannot work, because a clip on the Edit page
is a local `File` with a `blob:` URL until Render is pressed, so the strip
would be blank for exactly as long as the timeline is in use. `utils/
filmstrip.js` seeks a `<video>` and draws to a canvas instead. Two traps in
that hook, both of which took a browser to find and neither of which throws:
its effect must be keyed on the clip **ids**, never on the clips array, because
the page replaces that array whenever a duration lands from the metadata probe;
and there must be no mutex across effect runs, because a teardown plus a held
mutex deadlocks the loop and every block then says "reading frames" forever.
It is one pump for the life of the component that takes another pass when the
clip list changes. The placement arithmetic is in `utils/filmstripPlace.js`,
import-free so it can be unit-tested, and its interval is half-open so a split
does not draw the boundary frame on both sides.

Still open, in the order they are worth doing: **2.4 waveform** (one session;
decide server-vs-browser at the start of it rather than assuming, because
decoding a whole audio track is a different order of cost from twelve seeks,
and `silenceCut.js` already computes something adjacent server-side), then
**2.2 the frame-accurate preview**, which waits on the
capability probe at https://claude.ai/artifact/6NujtFbjeRAkpurKH619mU coming
back from Daniel's real devices. If a plain seek already lands inside a frame
on his footage, the preview is cheaper than scoped; if Safari has no
`VideoDecoder`, proxies are needed as a fallback. Then the EDL's render half,
transitions, overlays, and the render queue.

The scope's estimate for 2.5 was wrong in a useful direction: an arbitrary EDL
does **not** need one ffmpeg filter graph. Cut each block, normalise it the way
`combineClips` already normalises a whole clip, and stream-copy concat the
results. The inputs-differ-in-everything problem the scope worried about was
already solved in `combineClips` and is reused. The filter graph is still
needed for transitions, because `xfade` overlaps two inputs and a concat
cannot.

### Why the social report names LinkedIn as OMI's own record (31 Oct 2026)

Not an oversight, and not a task to pick up. The report reads the connected
Instagram account's own feed, so a reasonable next step looks like doing the
same for LinkedIn. It is blocked outside the code, and the block is worth
knowing before somebody spends a session discovering it.

OMI connects to LinkedIn **as a member**, not as an organisation:
`connectors/linkedin.js` resolves a `memberUrn` from `/v2/userinfo` and posts
through `ugcPosts` as that member. Reading an organisation's posts needs
`r_organization_social`, which requires two things no commit provides: the
connected person holding an admin, content-admin or direct-sponsored-content
role on the client's LinkedIn page, and LinkedIn's own approval of the scope.
There is no "list my own posts" endpoint for a member token at all. Reach and
impressions need organisation-level scopes on top of that, which the
connector's own comment at `fetchPostEngagement` already recorded.

So closing this gap is an access exercise first (re-scope the OAuth, connect
as an organisation, get LinkedIn's approval) with a small code tail, not a
build. Until then "LinkedIn figures are OMI's own record of what it
published" is the accurate thing to print, and the report prints it. Same for
TikTok, which has no reachable organic API without the client's own login.

The general rule this is an instance of: where a number cannot be defended,
say which account it came from rather than implying a read that is not there.

### The .db tests had rotted, and now there is one command (31 Oct 2026)

`npm run test:db` in `dev/platform/backend`, with a real Postgres:

```
DB_HOST=/tmp DB_PORT=55434 DB_USER=postgres DB_NAME=omi npm run test:db
→ 11 passed, 1 failed
```

These are the tests CI cannot run, because it has no Postgres, so they are
deliberately out of `platform-checks.yml`. The cost of that is rot, and on 31
October **three of twelve could not run at all**:

- `assets.db.test.js` and `client-php-audit.db.test.js` could not insert their
  fixtures. `clients.slug`, `users.password_hash` and
  `social_batches.client_id` had each become NOT NULL since the fixture was
  written. Both fixed.
- `design-routes.db.test.js` required `supertest`, which was not in
  `package.json` and never had been. It is now a dev dependency, and the suite
  passes with 40 assertions.

So the client asset library, the PHP audit and the design routes were all
running unguarded while a green CI said otherwise.

**Two traps in this area, both of which cost something already.**

**`design-routes` needs a scratch database, not the shared one.** It stands up
its own minimal schema, where `clients` is two columns. Run it against `omi`
and it fails on a trigger that already exists; "fix" its fixture to supply the
product's NOT NULL `slug` and it then breaks on the empty database it is
actually for. That repair was made and reverted within the hour. The runner
script creates and drops a scratch database for it, and the list of tests
needing one is at the top of `tests/run-db-tests.sh`.

**`social-captions.db.test.js` is not self-contained and is still red.** It
reads `social_posts WHERE id = '5555…'` without creating it, and TRUNCATEs
`client_assets` before asserting on a brand kit drawn from them, so it has only
ever passed on rows another test left behind. Making it green means writing a
fixture whose palette yields `accent === '#C8701E'`, and reverse-engineering an
input to satisfy an assertion is how you get a test that passes for the wrong
reason. It needs whoever knows the intended palette. Daniel was asked on 31
October and had not answered.

Run the script after any migration that adds a NOT NULL column, and before
claiming that a `.db` test protects anything.

## 10. Fast facts / gotchas checklist

- **A slug that equals a different row's tab key is a trap, and one exists.**
  Shared has `tab: 'review'` at slug `brief` and `tab: 'perf_insights'` at slug
  `review`. The round trip holds, so nothing is broken; pass a slug where a tab
  is expected and you land on the other screen with no error, and both render.
  `tests/sectionPanel.test.mjs` records every such collision with that one
  allowlisted.
- **A hardcoded client path must be built from the section, base included.**
  `routeTargets` direction 2 reads literal `/clients/…` strings and cannot
  evaluate an interpolated segment, so
  `` `/clients/${id}/convert/${slugForTab(...)}` `` is reported as a dead
  screen. Write `` `${SECTIONS.convert.base(id)}/${slugForTab(...)}` ``, which
  is what the other links do.
- **Settings slugs moved on 31 Oct**: `ai` → `models`, and `gen`, `scraping`
  and `alerts` are new. `other` is gone, its four groups re-filed. Anything
  linking to `/settings/ai` or `/settings/other` is dead.
- **The Shared autopilot is off for every client and must stay that way by
  default.** `clients.social_autopilot_paused` defaults to `true` since
  migration 227. It is the one thing in OMI that acts without a human
  clicking go, and it was kept rather than deleted on exactly that condition.
  `tests/autopilot-off.test.js` guards it.
- **`roWrite()` returns `disabled: false`, and a JSX spread beats the props
  written before it.** So `disabled={…} {...roWrite(…)}` throws the disabled
  away. Shared's batch download and the bulk report delete were both built
  that way and neither was ever disabled. Pass `disabled` *inside* `roWrite`;
  `tests/readOnlyDisabled.test.mjs` scans all 171 of them.
- **`PostCard` is an editor, so a post's hook and caption are input values,
  not text.** `innerText` misses them, and a browser assertion looking for a
  hook on Shared's Produce or Review will pass vacuously. Read the card by the
  value of the input it holds.
- **A tick state that something downstream consumes has to be persisted.**
  Shared's Review ticks live under `omi:shared_ticks`, keyed by batch, because
  untick three, refresh, and an unpersisted set hands the download nine.
  `null` means every post, which is not the same as a set of every current id:
  a batch loads its posts after its id.
- **Auto-merge fires within ~3 minutes of CI going green**, so a commit pushed
  while a PR is open joins it and a commit pushed after the merge needs a new
  PR. Open the PR in the same breath as the push, not after writing it up.
- **A section's URL base is not its name.** `nav/sections.js` keeps the
  pillar's old leaf: Paid is `/clients/:id/ads`, Earned `/clients/:id/pr`,
  Shared `/clients/:id/social`, Owned `/clients/:id/seo`. Guessing
  `/clients/c1/earned/monitor` in a browser drive costs a whole run. Read
  `base` and `slugOf` (which is `row.slug || row.tab.replace(/_/g, '-')`)
  rather than the label.
- **`RecordingsPage` only ever renders embedded inside a client**, from
  `ClientVideoTab` at Produce → Record. There is no global recordings screen,
  so `clientId` is always set and anything keyed on "am I scoped to a client"
  has exactly one answer.
- **An asset URL you send to an external API has to be bytes, not a path.**
  Generated creative is stored on this box (`generatedMedia.js`), so
  `/api/brand/file/...` is authenticated and relative: the Photoshop fan-out,
  `fetch()` in the library resize and Replicate's reference still were all
  silently broken by exactly that. `generatedMedia.readBytes(row)` is the way
  in.
- **The Anthropic spend card is scoped to OMI's own API key.** Not the
  organisation. If it says it cannot identify the key, that is deliberate: no
  figure beats the account's figure labelled as OMI's.
- **`CLAUDE_PRICES` in `costLog.js` was wrong by 3x on three models for
  months.** Check it against the published price list before trusting a cost
  figure, and after adding a model.
- **The admin usage report sends cached writes as
  `cache_creation: { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens }`**
  and no flat `cache_creation_input_tokens`. Reading the flat field alone
  prices a long cached prompt at nothing.
- **A stub that holds state has to be reset at the start of a drive**, never at
  the end, and the Launch backfill stub holds state. The second run of a drive
  that tidies up afterwards fails for reasons unrelated to the code. There is a
  `POST /api/stub/reset-backfill?mode=all|none|partial` for it.
- **`innerText` reports what CSS rendered, not what the JSX says.** A
  `.caption` is uppercased, so `/Keep a copy/` fails where `/keep a copy/i`
  passes. Two drives have now lost time to this.
- **Do not use `pkill` in this container.** A pattern broad enough to catch a
  background node server also matches the shell running the command, and the
  tool call dies with exit 144 mid-script. Stop background tasks with
  `TaskStop`.
- **No client section has a horizontal tab strip.** A new screen is a row in
  `frontend/src/nav/sections.js`, checked both ways by
  `tests/sectionPanel.test.mjs`. See §5 for the panel, the measured widths, and
  why `.app-nav` must stay flat `#000000`.
- **In-content breakpoints are `@container appmain (...)`, not `@media`**, and
  the thresholds are rebased (−322px above 768, −32px below). §5.
- **A number that reaches a client report has to be one you can account for.**
  Earned's "new referring domains" counted every domain the whole site gained
  in a 21-day window after a release, with nothing tying a domain to the
  release: one campaign read 939. `first_seen` in `dfs_referring_domains` is
  **DataForSEO's discovery date**, not when the link appeared, so a newly
  indexed site dumps years of history into one window — never read it as "this
  link is new". The panel leads on `pitched_rds`, domains matching an outlet
  the campaign emailed. When a figure cannot be defended, the fix is a smaller
  honest number, not a caveat under a big one.
- **`dfs_referring_domains` has no unique index on
  `(client_id, captured_at, domain)`.** A capture written twice duplicates
  rows, so count `DISTINCT domain` or a re-run reads as extra coverage.
- **`.grid-2` and `.grid-3` are modifiers for `.grid`.** On their own they set
  columns on a block element and nothing happens. `className="grid grid-2"`.
- **`src/services/mimeText.test.js` fails 4 assertions in a cloud session and
  is not broken.** That container's Node 22.22.0 decodes windows-1252 as if it
  were ISO-8859-1: `new TextDecoder('windows-1252').decode(Buffer.from([0x92]))`
  returns U+0092, a C1 control, rather than a curly apostrophe. The box
  (22.23.4) and CI both get it right, checked on 31 Oct 2026, so journalist
  replies are read correctly in production. Confirm before spending time on it:
  `node -e "console.log(JSON.stringify(new TextDecoder('windows-1252').decode(Buffer.from([0x92]))))"`
  — `"’"` means the environment is fine and the failure is local.
- **`SideDrawer` renders its children while shut** (it slides rather than
  unmounts), so a browser check that grabs `.first()` of anything may be
  holding a closed drawer's field. Target by placeholder or within a scope.

- **Leave this guide truer than you found it** (§8). Correct what your change
  made wrong, record what a future agent would otherwise learn the hard way,
  and nothing else. It is a handover, not a changelog.
- OMI = `platform.octobercomms.com` (`dev/platform`). Events app =
  `*.pages.dev` (`dev/october-platform`). Never confuse them.
- Deploy is **dispatched for you** by `auto-merge-claude.yml` after a merge
  touching the platform paths (auto-merge bypasses `on: push`, so the workflow
  calls `platform-deploy.yml` itself). Verify the run; dispatch only if none
  appeared. §3.
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
- **Shops are `services/ecomTypes.js`, not a literal pair.** The check
  `connector_type === 'shopify' || 'woocommerce'` was written out in five
  places and adding Stripe meant editing five and hoping. One of them was an
  if/else, so a client on any third shop silently got no e-commerce section in
  their report.
- **A connector's own currency, never a hardcoded symbol.** The report builder
  printed £ on every e-commerce row whatever the store billed in. Harmless
  while every shop was sterling; the first dollar client makes it a wrong
  number in a direction nobody checks. Every ecom summary carries `currency`.
- **Stripe quotes amounts in the currency's smallest unit**, and the divisor
  is per currency — 1000 is £10.00 but ¥1000. It comes from the runtime's ISO
  4217 data (`Intl.NumberFormat(...).resolvedOptions().maximumFractionDigits`)
  rather than a table in the file, because a hardcoded list goes stale
  silently. `docs.stripe.com` is outside this container's allowed domains, so
  Stripe's own table has never been checked against ISO here.
- **`false ?? null` is `false`, and that is the point.** A boolean column
  being set to false is the only write anyone makes to it, so a falsy check in
  a PATCH/PUT handler discards the one value that matters.
- **Mutate the code and watch the test fail.** Three tests in one session
  passed for the wrong reason — an `||` clause that was always true, a case
  that never matched the code path it named, and `getBoundingClientRect()`
  reporting a box inside a closed `<details>` (use `checkVisibility()`). All
  three were written carefully. Care is not the control; mutation is.
- **A scripted edit needs `assert old in s`.** A python `.replace()` that
  matches nothing changes nothing and says nothing, and the suite goes green
  with the new assertions never run.
- L1 masthead stays **big** (display title + kicker), matching Settings.
- Two "Leads" screens — name which one. Owned→Email→Leads is two-pane;
  Biz dev→Leads stays a table.
- L5 pattern = add an `embedded` prop to the detail modal, then `ListDetail sidebar`.
- Don't brand OMI "nvelope".
- The real next prize is **Phase 3 (GTM Brain)**, not more table refactors.
