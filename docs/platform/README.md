# OMI Platform — Developer Documentation

**OMI (October Marketing Intelligence)** is the October Performance Marketing
Platform: a multi-tenant SaaS that gives marketing teams reports, SEO, social,
ads, PR/outreach, ecommerce analytics, and AI tooling per client.

- **Code:** `dev/platform/` (backend Node/Express, frontend React/Vite, video worker)
- **Docs:** `docs/platform/` (this folder — technical reference) and `docs/omi/` (strategy, feature briefs, integration plans)
- **Production:** https://platform.octobercomms.com — PRs against `main` auto-merge and auto-deploy (GitHub Action SSHes into the VPS); no manual merge/deploy. See [deployment.md](deployment.md#continuous-deployment-github-actions)
- **Do not** brand the platform "nvelope" (that's a separate product).

> **Cloudflare note:** PRs get a `october-platform.pages.dev` Cloudflare comment.
> That preview is the **ADF / October Events app** (`dev/october-platform`), **not OMI**.
> OMI has no Cloudflare preview and no merge gate — it auto-merges and auto-deploys
> via a GitHub Action that SSHes into the VPS. Treat those comments as "no action".

---

## How to use these docs (for agents)

This documentation is meant to be **read first** and **kept current**. When you
work on OMI:

1. **Read the relevant file(s) below** before diving into code — they'll save you
   from re-deriving the architecture each session.
2. **Update them when you change things.** If you add a route, service, table,
   page, env var, or external integration, update the matching doc in the same
   PR. Keep entries one-line and skimmable; this is a map, not a tutorial.
3. **Keep the "Last verified" date** at the bottom of each file current when you
   touch it.
4. These docs describe *structure and conventions*. Detailed feature briefs and
   plans live in `docs/omi/` — link to them rather than duplicating.

If something here contradicts the code, the **code wins** — fix the doc.

---

## Contents

| Doc | What's in it |
|-----|--------------|
| [architecture.md](architecture.md) | System overview, tech stack, request flow, deploy topology, repo layout |
| [backend.md](backend.md) | Express server, auth/middleware, rate limiting, full route catalogue, service domains |
| [frontend.md](frontend.md) | React app shell, routing, pages, components, context/hooks/api client, styling, build |
| [data-model.md](data-model.md) | PostgreSQL schema reference — core tables, domain groupings, conventions, key relationships |
| [integrations.md](integrations.md) | The AI layer (Claude/DeepSeek routing), external providers, the encrypted settings store |
| [deployment.md](deployment.md) | `deploy.sh`/`update.sh`, migrations runner, PM2, nginx, the video worker, env vars |
| [conventions.md](conventions.md) | Coding conventions, security patterns, multi-tenancy rules, how to add things |

## Existing feature docs (already in this folder)

- [social-posts-planner.md](social-posts-planner.md) — social planner feature
- [ctr-boosters.md](ctr-boosters.md) — CTR booster notes
- [security-audit.md](security-audit.md) — security posture

See `docs/omi/` for the larger library of feature briefs, integration plans, and
strategy docs (DataForSEO cutover, lead enrichment, video auto-edit, Shopify
ingest, contacts intelligence, local SEO toolkit, and more).

---

_Last verified: 2026-08-18 (against `dev/platform` @ branch `claude/omi-overview`)._
