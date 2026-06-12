# October Events — planning platform

The friendly front-end for the October Events plugin (see `dev/october-events`).
Per the agreed architecture it's a **thin SPA over the plugin's REST API** — no
database of its own, no sync. WordPress stays the single source of truth.

- **Code:** `dev/october-platform/` (static: HTML/JS/CSS, **no build step**)
- **Host:** Cloudflare Pages at `platform.atlantadesignfestival.net`, auto-deployed
  on merge to `main` (`.github/workflows/october-platform-deploy.yml`)
- **Backend:** the plugin's `oe/v1/planning/*` endpoints

## Design system

The platform uses the shared October **"Marketing Intelligence"** look so the
products feel like one family: a dark left **sidebar** (logo + nav + signed-in /
sign-out), a cream canvas, an overline + big bold page title with the date, a row
of **stat cards** (the first highlighted dark), and white **section cards** with
yellow pill accents and green/amber status dots. Display type is *Space Grotesk*
(falls back to the system font). All layout/colour lives in `assets/styles.css`
via CSS custom properties, so re-skinning is a token change.

## Dashboard (landing)

The default view after sign-in:

- **Stat cards** — Events ready (`green/total`), Open tasks, Volunteer slots
  (`filled/capacity`), and Needs attention (blocked tasks + signups to review).
- **Getting started** — a checklist that ticks itself off as you set things up
  (confirm an event to green, add a task, set up a volunteer opportunity; email
  sending shown as "soon"), each with a button through to the relevant view.
- **Workspace cards** — Events / Tasks / Volunteers with quick counts, a status
  dot, and "Open →".

It reads the existing list endpoints in parallel and degrades gracefully if any
one is unavailable.

## Phase 1 — Elayne's Events board (this build)

- A **board** grouping every event by status — *In progress / Draft / Confirmed* —
  each card showing a **completion meter** and what it still needs.
- Click a card to open an **editor drawer**: the planning fields (title, dates &
  times, price, location, organiser, description, ticketed, sessions, notes), a live
  **readiness checklist**, **Save**, and **Confirm — go green** (disabled until the
  required fields are complete; confirming publishes the event).
- Mirrors the plugin's wp-admin behaviour exactly — same data, friendlier surface.

## Tasks board

A second view (top-nav **Events | Tasks**) over the plugin's `oe/v1/tasks` API —
the team's shared, department-grouped task list (replacing the single-user Notion
board):

- Four status columns — **To do / In progress / Blocked / Done** — with a count
  per column.
- Each card shows the **department**, assignee and due date, with an inline
  **status** dropdown to move it across the board in one click.
- A quick **add-task** bar (title + department + due date) at the top, and an
  **edit drawer** (title, department, status, due date, assignee, notes, delete).

## Volunteers board

A third view (top-nav **Volunteers**) over the plugin's `oe/v1/volunteers` API
(October Events 1.8.0) — Ashleigh's management surface for volunteer signups:

- A grid of **opportunity cards**, each showing role/location, a **filled vs
  capacity** meter across its shifts, whether signups are open, and a badge for
  how many signups still need a decision.
- Click a card for the **drawer**: every shift with its signups, a per-signup
  **status** dropdown (Pending / Confirmed / Declined / No-show), a **check-in**
  toggle, **remove**, and an **add-volunteer** form (name / email / phone) to
  place someone on a shift manually.

## Auth (Phase 1)

Sign in with a WordPress **Application Password** (the user does this once):

1. In WordPress: **Users → Profile → Application Passwords** → create one.
2. In the platform login: enter the **Site URL**, your **username**, and that
   application password. It's sent as HTTP Basic auth (no cookies, works
   cross-origin) and stored only in your browser's `localStorage`.

> A nicer **magic-link** sign-in is planned (see `docs/october-events/PLATFORM-SCOPE.md`);
> Application Passwords are the pragmatic Phase-1 choice — built into WordPress, no
> extra code.

WordPress core already sends permissive REST CORS (it echoes the request Origin and
allows the `Authorization` header), so the cross-origin calls work out of the box. If
a security plugin later locks CORS down, we'll add an explicit allow for the platform
origin in the plugin.

## Cloudflare Pages setup (one-time)

1. Create a Pages project named **`october-platform`** (Direct Upload).
2. Add two GitHub repo secrets: **`CLOUDFLARE_API_TOKEN`** (scope: *Pages → Edit*)
   and **`CLOUDFLARE_ACCOUNT_ID`**.
3. Point the custom domain **`platform.atlantadesignfestival.net`** at the project
   (one CNAME).

After that, every merge to `main` that touches `dev/october-platform/**` redeploys
automatically. (You can also use Cloudflare's native Git integration instead — set
the project's root directory to `dev/october-platform` with **no build command** — in
which case the workflow is unnecessary.)

## Local preview

It's static, so just serve the folder:

```
cd dev/october-platform && python3 -m http.server 8080
# open http://localhost:8080
```

Sign in against your real (or staging) WordPress site.

## Structure

```
dev/october-platform/
  index.html          app shell
  assets/
    app.js            shell + Dashboard + Events + Tasks + Volunteers (vanilla ES modules)
    api.js            oe/v1 REST client (App-Password Basic auth)
    styles.css        October brand (cream / rust / near-black)
  _redirects          Cloudflare SPA fallback
  package.json        metadata + `npm run check` (node --check the JS)
```

## Roadmap (next)

- **Federation:** read events from **both** sites (ADF + Architecture Tours) and the
  shared org layer from the ADF **hub** (per the platform scope).
- **Magic-link** auth; role-scoped views (Elayne = events, Ashleigh = volunteers).
- Sales dashboard, editorial log — as the plugin exposes them.
