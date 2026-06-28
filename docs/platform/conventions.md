# OMI — Conventions & How to Add Things

## Repo rules (from root `CLAUDE.md`)

- **Code** lives in `dev/platform/`; **docs** live in `docs/platform/` (technical)
  and `docs/omi/` (strategy/briefs). Don't leave `.md` docs in the code folder
  (except toolchain files like `package.json`, configs).
- The product is **OMI / October Marketing Intelligence**. Never brand it
  "nvelope". `nvelope.co` is a separate product — leave its assets alone.

## Security & multi-tenancy (non-negotiable)

- Every per-client route uses `authenticate → loadVisibleClientIds →
  requireClientAccess({ paramNames: ['clientId'] })`. If a client id arrives via
  body/query, guard it with `assertClientAccess`/`checkClientIdFromBodyOrQuery`.
- Always scope queries `WHERE client_id = $1`. Never trust a client id from the
  request without an access check.
- Admin-only mutations use `requireAdmin`.
- Secrets go in the **settings store** (encrypted) or `.env` — never hardcoded,
  never returned to the client unmasked.
- Public/token endpoints (reports, approvals, unsubscribe, PR portal, tracking
  pixels) use **HMAC-signed tokens or unguessable UUIDs** with expiry — keep that
  pattern; don't expose enumerable ids.
- Webhooks (WordPress, Shopify, SES, Meta DM) verify **HMAC over the raw body**.

## Coding conventions

- **Backend:** CommonJS (`require`). Routes are thin; logic lives in `services/`.
  Handlers wrap in `try/catch` and `res.status(err.status || 500).json({ error })`.
  Throw `Error` with a `.status` for HTTP codes.
- **Frontend:** function components + hooks. All backend calls go through
  `utils/api.js`. Toasts via `useToast`. URL-synced tabs via `useTabParam`. Match
  surrounding style; use the design tokens / CSS variables, not ad-hoc colours.
- **LLM features:** call `callClaude({ feature, ... })` so the feature is routable
  and cost-tracked. Add new features to `aiModels.js` `FEATURES` with the right
  `sensitive` flag. Don't bypass the chokepoint.
- **Commits:** end with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` and the
  `Claude-Session:` trailer. **Never** put the model id in commits/PRs/code.
- **PRs:** open ready-for-review against `main`; body ends with the Claude Code
  attribution line.

## How to add common things

- **A route:** create `routes/foo.js` (with the auth/clientAccess middleware),
  mount it in `index.js`, put logic in `services/foo.js`, document it in
  [backend.md](backend.md).
- **A table / column:** add `backend/migrations/NNN_name.sql` (next number,
  idempotent SQL). It applies on next deploy. Document it in
  [data-model.md](data-model.md).
- **A connector / integration:** add a `services/<provider>.js`, store creds in
  the settings store or connector `credentials`, add UI in `SettingsPage`/
  connectors, document it in [integrations.md](integrations.md).
- **An env var:** add it to `.env.example`, read it via `process.env` (or
  `getSetting` if it should be DB-managed), document it in
  [deployment.md](deployment.md).
- **A page/component:** add under `frontend/src/pages|components`, wire routing in
  `App.jsx`, document it in [frontend.md](frontend.md).

## Gotchas worth knowing

- **Serper free tier** rejects the `site:` operator and `num>20`.
- **DeepSeek** is China-hosted — only route non-`sensitive` features there.
- **IG outreach prospects** detach (not delete) when a search is deleted
  (`search_id` → NULL); the Done tab is client-wide and a "not attached" strip
  reclaims them.
- **Cron/timestamps** run in `Europe/London` (set in `ecosystem.config.js`).
- **Cloudflare PR comments** = the ADF app, not OMI — no action.
- The global rate limit is **2500/15min per IP**; auth endpoints are 20/15min.

---

_Last verified: 2026-06-28._
