# OMI security audit — October Marketing Intelligence (`dev/platform`)

Audited against the four canonical "vibe-coded app" failure modes (see the
`october-security` skill). **Verdict: passes all four.** One optional gap
(edge IP-ban). Date of audit: 2026-06.

## 1. API abuse / rate limiting / IP ban — ✅ (one optional gap)
- `helmet` + `express-rate-limit` + pinned CORS; `app.set('trust proxy', 1)` so
  limits key off the real client IP behind Cloudflare (`backend/src/index.js`).
- Brute-force defence: `authLimiter` = **20 / 15 min** on `/api/auth/login` and
  `/api/auth/change-password`. Global limiter = **600 / 15 min** on `/api`.
  Per-webhook limiters on wp-connect / shopify-app / video-worker.
- ⚠️ **Gap:** no in-app IP ban (the `/api/security` route is the audit feature).
  **Fix at the edge, not in code** — Cloudflare WAF / IP Access Rule. Steps in
  the skill's `assets/cloudflare-edge.md`. Low priority; rate limiting already
  covers most abuse.

## 2. Auth / sessions / multi-tenant isolation — ✅
- JWT signed with `process.env.JWT_SECRET` (no weak fallback), **`expiresIn:
  '24h'`** (`routes/auth.js`).
- Token in an **`httpOnly` + `secure` + `sameSite=lax` cookie** — not in
  localStorage, not readable by page scripts (`middleware/auth.js`). Bearer
  header accepted as a fallback.
- Role **re-read from the DB every request** → instant revocation.
- **Multi-tenant authorization enforced on every client-scoped route**:
  `getVisibleClientIds` + `canAccessClient` / `requireClientAccess` →
  **403** on a client outside the caller's scope (`middleware/clientAccess.js`).
  All 21 user-facing route files apply it; the 10 that don't are public/webhook/
  worker endpoints authenticated by **HMAC signature / shared-secret token**
  (wpConnect, shopifyApp, videoWorker, unsubscribe, prAddon). **No IDOR found.**

## 3. Secrets on the frontend — ✅
- No API keys in the frontend bundle; no `VITE_`/`import.meta.env` secrets. The
  only `sk-ant-` string is a **placeholder** in the admin key form
  (`SettingsPage.jsx`).
- All AI/API calls run server-side; keys live in backend env / encrypted DB.
- Settings GET returns masked `••••••••` (selects key *name*, never value); the
  decrypt/"reveal" endpoint is `requireAdmin`-only (`routes/settings.js`).

## 4. Exposed `.env` / secrets in git — ✅
- `.env` + `.env.*` gitignored; only `.env.example` placeholders committed.
- Secrets **encrypted at rest** in the DB (`utils/encryption.js`).
- No real secret in any committed file.

## Adjacent — ✅
- Passwords hashed with **bcrypt** (`services/users.js`).
- **Parameterised SQL** throughout; the few `${...}` interpolations are fixed
  column/table names from code, not user input.
- Built-in self-audit: `services/securityAudit.js`, `POST
  /api/security/audit/run` — run it from Settings for a live pass/fail.

## 5. Dependencies — ✅
- `npm audit` is **clean: 0 vulnerabilities** (critical/high/moderate/low all 0).
- Highs/lows are kept clear with `npm audit fix` (semver-compatible only).
- The 4 moderate `file-type` ASF-parser advisories (transitive via the old
  `jimp@0.22 → @jimp/core → file-type@16.5.4`) were cleared by **upgrading to
  `jimp@1.6.1`**, which drops that dependency chain entirely. jimp v1 is
  ESM-only, so the two CommonJS consumers (`adResize.js`, `visualise.js`) load it
  lazily via `await import('jimp')` and use the v1 API (`new Jimp({width,height,
  color})`, `resize({w,h})`, `cover({w,h})`, `greyscale()`, `getBuffer('image/png')`);
  `Jimp.read`, `composite`, `mask`, `blur` are unchanged. The expand/stitch and
  masked-composite image paths were re-verified end-to-end against jimp 1.6.1.

## Recommendations
1. **(Optional, do at the edge) Cloudflare IP Access Rule + a login rate-limit
   rule** — closes the only gap. See `cloudflare-edge.md`.
2. Lock the origin firewall to **Cloudflare IP ranges only** so the edge can't
   be bypassed via the origin IP.
3. Keep running the built-in audit after significant auth/route changes.
4. Watch that **new client-scoped routes** add the `requireClientAccess` guard —
   that's the one place a future regression could open an IDOR.
