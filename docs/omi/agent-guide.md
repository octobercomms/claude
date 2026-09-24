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
  agency **Biz dev** pipeline (snapshots → proposals → booking).

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

**Cloudflare Pages previews are a red herring for OMI.** PRs get a Cloudflare
Pages comment with a `*.october-platform.pages.dev` preview URL — **that is the
Events app, not OMI.** Ignore it when reviewing OMI. The real OMI review target
is `platform.octobercomms.com` after the manual deploy.

**You cannot run OMI in the sandbox** (no DB/backend). The only pre-merge
verification available is a frontend build:
```
cd dev/platform/frontend && npm run build
```
A clean `vite build` confirms it compiles — it does **not** confirm runtime
behaviour or visual correctness. Say so honestly; don't claim a screen "works"
from a build alone.

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

## 6. The mission / roadmap

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

## 7. Working conventions

- **Branch**: develop on the assigned feature branch (this work used
  `claude/omi-overview-mebbqh`). After a PR merges, **reset the branch to
  latest main** before the next change:
  `git fetch origin main && git checkout -B <branch> origin/main`.
- **Always `npm run build`** in `dev/platform/frontend` before pushing — it is
  the only available check. Fix any error before pushing.
- **One change per PR.** Keep PRs focused; the auto-merge bot merges fast.
- **After every merge, manually trigger `platform-deploy.yml` on `main`** and
  confirm success (see §3). Then reset the branch.
- **GitHub is via MCP tools** (`mcp__github__*`) — there is no `gh` CLI.
- **Attribution**: end commit messages / PR bodies with the Claude Code
  attribution the session provides. Don't put model IDs in commits/PRs.
- **Docs go in `docs/omi/`**, code in `dev/platform/`. Don't leave `.md` docs
  in the code folder. Changes under `docs/**` do **not** trigger the deploy
  (path filter), so doc-only PRs need no deploy.

## 8. What is visible vs invisible (manage expectations)

Most of Phase 2 was **consolidation, not restyling** — several bespoke
components collapsed into one shared component that renders *deliberately
identically*. So "I can't see a difference" is the expected outcome for
L3/L4/L6 and much of L1/L5: fewer moving parts, same pixels. The genuinely
**visible** changes so far are: the button system, the L1 header (kept big),
and the L5 two-pane screens. When you ship invisible consolidation, say so
plainly, and prefer to fold at least one visible improvement into each PR so
progress is obvious on `platform.octobercomms.com`.

## 9. Fast facts / gotchas checklist

- OMI = `platform.octobercomms.com` (`dev/platform`). Events app =
  `*.pages.dev` (`dev/october-platform`). Never confuse them.
- Deploy is **manual after every merge** (auto-merge bypasses `on: push`).
- Sandbox has **no backend** — verify with `vite build` only; never claim
  runtime/visual correctness from a build.
- L1 masthead stays **big** (display title + kicker), matching Settings.
- Two "Leads" screens — name which one. Owned→Email→Leads is two-pane;
  Biz dev→Leads stays a table.
- L5 pattern = add an `embedded` prop to the detail modal, then `ListDetail sidebar`.
- Don't brand OMI "nvelope".
- The real next prize is **Phase 3 (GTM Brain)**, not more table refactors.
