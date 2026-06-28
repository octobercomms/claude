# OMI — Architecture

## What it is

A multi-tenant performance-marketing platform. Each **client** (tenant) has
connectors (data sources), reports, SEO/social/ads/PR/outreach tooling, and AI
features. **Users** are either `admin` (see everything) or `viewer` (scoped to
assigned clients via the `user_clients` join).

## Tech stack

| Layer | Tech |
|-------|------|
| Backend | Node.js 20, Express 4, PostgreSQL (via `pg`), JWT auth, PM2 |
| Frontend | React 18.3, Vite 6, React Router 6, Recharts, react-markdown |
| AI | Anthropic Claude (Fable/Sonnet/Opus) + DeepSeek, routed per-feature |
| Video | Separate worker box: Remotion/ffmpeg, Whisper captions, Claude Vision QA |
| Infra | Ubuntu VPS, nginx reverse proxy + TLS (Let's Encrypt), PM2 process mgr |
| Email | Nodemailer (Gmail app password) or AWS SES |

## Repo layout (`dev/platform/`)

```
backend/
  src/
    index.js          # Express bootstrap, router mounts, rate limiters, scheduler
    db.js             # pg Pool (Postgres)
    middleware/       # auth.js (JWT), clientAccess.js (multi-tenant guards)
    routes/           # 43 route files — HTTP layer
    services/         # ~93 service files — business logic + integrations
    connectors/       # per-provider data connectors
    utils/            # settings store (encrypted), helpers
    assets/ data/     # static assets, seed data
  migrations/         # ~110 numbered SQL files + run.js
  ecosystem.config.js # PM2 config (TZ=Europe/London)
  package.json
frontend/
  src/
    App.jsx main.jsx  # router + shell
    pages/            # 28 page components
    components/       # 46 components (+ organic/ paid/ social/ subdirs)
    context/ hooks/ utils/ styles/
  package.json  vite.config.js
worker/               # video worker (runs on a separate machine)
nginx/platform.conf   # reverse proxy + TLS + security headers
deploy.sh             # one-time VPS provisioning
update.sh             # continuous deploy (git pull → migrate → build → pm2 reload)
```

## Request flow

```
Browser (SPA, /var/www/platform)
   │  fetch /api/* (httpOnly cookie auth)
   ▼
nginx :443  ──proxy──►  Express :3001
   │                       │ authenticate (JWT cookie/Bearer)
   │                       │ loadVisibleClientIds → requireClientAccess
   │                       ▼
   │                    route handler → service → pg Pool → PostgreSQL
   │                                          └─► external APIs (Claude, DataForSEO, …)
   ▼
SPA fallback: try_files … /index.html
```

- **Auth:** JWT in an httpOnly cookie (or `Authorization: Bearer`), 24h TTL. Role
  is re-read from the DB on every request so changes take effect immediately.
- **Multi-tenancy:** every per-client route runs `authenticate → loadVisibleClientIds → requireClientAccess`. Admins get `null` (all clients); viewers get a UUID list from `user_clients`. Handlers also filter `WHERE client_id = $1`.
- **Secrets:** API keys/OAuth creds live encrypted in the `platform_settings` table (AES-256-GCM), read via `getSetting()`. Bootstrap secrets (DB, JWT, encryption key, admin seed) come from `.env`.

## Background processing

- **Scheduler** (`services/scheduler.js`) runs *inside* the API process via
  `node-cron`, pinned to `Europe/London`. Jobs: weekly/monthly reports, PR
  coverage monitoring + digests, rank checks, IG discovery autopilot, social
  autopilot, strategist, email-reply polling, usage snapshots, link sweeps.
- **Video worker** is a *separate* process on its own box. It polls
  `/api/video/worker/*` with a shared `WORKER_TOKEN`, and runs the auto-edit
  pipeline (ingest → roughcut → caption → grade → export). See
  [deployment.md](deployment.md#video-worker).

## Deploy topology

- Push to `main` → `update.sh` runs on the VPS: `git pull` → run migrations →
  `npm ci` backend → build frontend → rsync to `/var/www/platform` →
  `pm2 reload october-platform` → sync nginx if changed.
- One API process (`october-platform`, port 3001) behind nginx. Video worker
  runs elsewhere. Postgres is local to the VPS.

See [backend.md](backend.md), [frontend.md](frontend.md),
[data-model.md](data-model.md), [integrations.md](integrations.md),
[deployment.md](deployment.md).

---

_Last verified: 2026-06-28._
