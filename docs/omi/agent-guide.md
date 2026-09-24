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

## 5. The design system + the 6 shells

### Design tokens (`index.css :root`)
- Type scale `--fs-*`, spacing `--s1..--s10`, radii `--r-sm/md/lg/pill`,
  colours, `--warm`/`--warm-soft`.
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
| **Proposal** | Re-reads the site, combines snapshot + call notes, writes in the ROAR structure, matches proof by sector (×3) and problem (×2), prices Advanced before Basic. ~1 min, runs on Opus. | Daniel triggers |
| **Approval** | One screen: the proposal exactly as the prospect sees it, beside recipients, matched proof and why, pricing. **Nothing sends without a click.** | Daniel |
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
`components/proposal/ProposalDocument.jsx` (one renderer shared by the internal
preview and the live page, so what is approved is what is sent).

**Not live until Daniel does these.** Check before claiming the pipeline works:
- Google Calendar connected in Settings → Biz dev → Booking.
- Booking embed snippet pasted into `octobercomms.com/book/`.
- `GOCARDLESS_URL_ADVANCED` / `GOCARDLESS_URL_BASIC` set, else acceptance ends
  on a thank-you screen and is followed up by hand.
- `PIPELINE_ALERT_EMAIL`, `PIPELINE_TERMS_URL` set.
- **Case studies added to the proof library.** It ships with 5 testimonials and
  4 credentials and *zero* case studies, only two of them from architects, so
  "matched proof" is a default until that is fixed. This is the weakest link in
  the whole pipeline; say so rather than overselling the matching.

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
- L1 masthead stays **big** (display title + kicker), matching Settings.
- Two "Leads" screens — name which one. Owned→Email→Leads is two-pane;
  Biz dev→Leads stays a table.
- L5 pattern = add an `embedded` prop to the detail modal, then `ListDetail sidebar`.
- Don't brand OMI "nvelope".
- The real next prize is **Phase 3 (GTM Brain)**, not more table refactors.
