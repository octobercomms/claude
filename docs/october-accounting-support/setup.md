# October Accounting Support — setup and hosting

Phase 1 backbone. Code lives in `dev/october-accounting-support/`
(`backend/` + `worker/`); this doc and the brief live here in `docs/`.

## Hosting

Co-locate on the OMI Hetzner box, as its own service with its own database.

- Runs the same stack as OMI (Node, Postgres, a cron worker), so no new runtime.
- Load is trivial: one user, polling every 15 minutes.
- Isolation on shared hardware: a **separate Postgres database** with its own
  credentials, and secrets in a separate `.env` the OMI app cannot read.
- Do not use 20i shared hosting: it does not run a long-lived Node process with
  a background worker, and its isolation is too weak for credentials that reach
  live books and bank data.
- A dedicated €5/mo Hetzner box is an optional upgrade if you want the financial
  credentials physically walled off from OMI.

## Prerequisites

- Node 18+ and a Postgres database (own DB, own user).
- A Xero app registered at developer.xero.com (see below).
- Xero organisation on the Established (multi-currency) plan for GBP/USD/EUR.

## Register the Xero app

1. developer.xero.com → My Apps → New app (web app).
2. Redirect URI must match `XERO_REDIRECT_URI` exactly, e.g.
   `https://accounting.october.example/auth/xero/callback`.
3. Copy the client ID and secret into `.env`.
4. The app requests these scopes: `offline_access`, `accounting.settings.read`,
   `accounting.contacts.read`, `accounting.reports.read`,
   `accounting.transactions`.

## Configure and run

```bash
cd dev/october-accounting-support/backend
cp .env.example .env        # fill in every value
openssl rand -hex 32        # -> SECRETS_KEY
npm install
npm run migrate             # create the schema
npm start                   # backend API on PORT (default 4300)
```

Connect Xero by visiting `/auth/xero/connect` once; tokens are stored encrypted.

```bash
cd ../worker
cp ../backend/.env .env      # or share via the process manager
npm install
npm start                    # background poller
```

## Reconciliation posture

`WRITE_BACK_ENABLED` controls whether approved lines are written to Xero.

- `false` (default): read-only shakedown. Classify and queue only, write
  nothing. Run this for about a week to judge match quality on real books.
- `true`: write approved coded transactions back to Xero. The final reconcile
  click stays with the human; Beany still reviews and adjusts Xero.

## Security notes

- Xero tokens are encrypted at rest (AES-256-GCM, `SECRETS_KEY`). Xero rotates
  the refresh token on every refresh, so always store the newest one.
- Keep `.env` out of git (already in `.gitignore`).
- Put the backend behind HTTPS and restrict access to the review queue.
- Review against the `october-security` skill before exposing it publicly.
