# OMI — Deployment & Operations

Production: a single Ubuntu VPS running Postgres + the API behind nginx, plus a
separate video-worker box. Deploys over SSH on merge to `main`.

## Scripts

### `deploy.sh` (one-time VPS provisioning)
Installs system packages, Node 20, PM2, PostgreSQL; creates the
`octoberplatform` DB/user; lays down `/opt/october-platform`; installs backend
deps; runs migrations; builds the frontend to `/var/www/platform`; installs the
nginx config; issues a Let's Encrypt cert for `platform.octobercomms.com`;
starts PM2 with `ecosystem.config.js` and registers the startup hook.

### `update.sh` (continuous deploy — runs on each release)
1. `git fetch` + hard reset to `origin/main` (source at `/opt/october-source`).
2. **Run migrations** from the backend dir — **fails the deploy if a migration fails** (before any restart).
3. `npm ci --omit=dev` backend.
4. (Optional) pre-build the WordPress plugin zip.
5. `npm install` + `vite build` frontend → rsync `--delete` to `/var/www/platform`.
6. `pm2 reload october-platform --update-env` (graceful, zero-downtime).
7. If `nginx/platform.conf` changed: back up, `nginx -t`, reload (restore backup on failure; degrade gracefully without sudo).
8. (Optional) deploy the companion Shopify app if its `.env` exists.

## Migrations (`backend/migrations/run.js`)

- Loads `.env`, connects via `src/db.js`, ensures
  `schema_migrations(version, applied_at)`.
- Discovers `NNN_name.sql` files in lexicographic order, **skips already-applied**,
  runs each in a `BEGIN…COMMIT` transaction (rollback on failure, exit 1).
- **Forward-only** (no down migrations). Write idempotent SQL
  (`ADD COLUMN IF NOT EXISTS`, `ALTER TYPE … ADD VALUE IF NOT EXISTS`).
- To add a migration: create the next number, e.g. `109_my_change.sql`. It runs
  automatically on next deploy. ~110 files currently (latest 108).

## Process management (`ecosystem.config.js`)

- One PM2 app: **`october-platform`** → `src/index.js`, `NODE_ENV=production`,
  **`TZ=Europe/London`** (so crons/timestamps match UK schedules through DST).
- `autorestart`, `max_restarts: 10`, `max_memory_restart: 1G`.
- The **cron scheduler runs inside this process** (not separate).
- The **video worker is a separate process on its own box** (see below).
- Ports: API **3001** (proxied by nginx); nginx **80/443**.

## nginx (`nginx/platform.conf`)

- 80 → 443 redirect; TLS 1.2+ on `platform.octobercomms.com`; root
  `/var/www/platform`.
- Security headers: HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
  and a strict CSP on the SPA location.
- Routing: `/` SPA fallback (`try_files … /index.html`); `/api/` → `:3001`
  (5-min read timeout, 128M body for brand uploads); **`/api/video/`** → `:3001`
  (1GB body, 10-min timeouts, `proxy_request_buffering off`); `/auth/`, `/pdfs/`,
  `/coverage-attachments/` → `:3001`.
- Gzip on. **No nginx-layer rate limiting** — Express handles it (see
  [backend.md](backend.md)).

## Video worker (`worker/`)

Separate machine. Polls `POST /api/video/worker/claim` with
`Authorization: Bearer ${WORKER_TOKEN}` every `POLL_INTERVAL_MS` (default 5s),
one job at a time (`SKIP LOCKED`; scale by running more workers with distinct
`WORKER_ID`). Pipeline: **ingest → roughcut → caption (Whisper) → grade (Claude
Vision, loops back to roughcut if score < threshold) → export**. Needs
`ffmpeg`/`ffprobe`, `OPENAI_API_KEY` (captions), `ANTHROPIC_API_KEY` (grading).

## Database (`src/db.js`)

PostgreSQL via `pg` `Pool`. SSL on in production (`rejectUnauthorized: false`),
off in dev. Singleton pool used everywhere via `pool.query(sql, params)`.

## Environment variables (`.env`)

Bootstrap secrets live in `.env`; most provider keys live in the **settings
store** (see [integrations.md](integrations.md)). Key ones:

| Group | Vars |
|-------|------|
| DB | `DB_HOST/PORT/NAME/USER/PASSWORD` |
| Security | `JWT_SECRET`, `ENCRYPTION_KEY` (AES-256; validated on boot), `ADMIN_USERNAME`/`ADMIN_PASSWORD` |
| URLs/port | `PLATFORM_URL`, `PORT` (3001), `NODE_ENV` |
| OAuth apps | `GOOGLE_*`, `META_*`, `LINKEDIN_*`, `SHOPIFY_*`, `AMAZON_*`, `ZOHO_*` (+ redirect URIs) |
| Email | `EMAIL_PROVIDER`, `GMAIL_USER`/`GMAIL_APP_PASSWORD`, `SES_*` |
| AI/data | `CLAUDE_API_KEY` / `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `DATAFORSEO_LOGIN`/`PASSWORD`, `GOOGLE_ADS_*` |
| Webhooks | `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET`, `WORKER_TOKEN` |
| Ops | `ALERT_EMAIL`, `STRATEGIST_RECIPIENTS`, `VIDEO_RETENTION_DAYS` |

See `backend/.env.example` and `worker/.env.example` for the full list.

---

_Last verified: 2026-06-28._
