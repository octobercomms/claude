---
name: october-security
description: Security-audit and harden any October app against the common "vibe-coded app" failure modes. Use when the user wants a security review/audit, asks "is my app secure", wants to check for exposed secrets / API keys / .env leaks, rate limiting / brute-force / IP-ban / DoS protection, broken authentication, session/JWT issues, multi-tenant data isolation / IDOR ("User A seeing User B's data"), CSP / security headers, or wants to harden a new or existing app. Covers both server-backed apps (Express/Node, like OMI / dev/platform) and backend-less static SPAs (like the October Events / ADF app, dev/october-platform). For a generic line-by-line diff review use the security-review plugin skill instead; use THIS for whole-app posture against the four canonical threats.
metadata:
  version: 1.0.0
---

# October Security Audit

A repeatable, October-specific security pass. It's organised around the four
failure modes that sink vibe-coded apps, then a broader checklist. Use it to
audit an existing app or to set the bar for a new one.

The two apps already audited are the worked examples — read their findings in
`docs/platform/security-audit.md` (OMI, server-backed) and
`docs/october-platform/security-audit.md` (October Events / ADF, static SPA).

## The four canonical threats

### 1. API abuse — no rate limiting / no IP ban → spam, brute-force, DoS
**Server-backed (Express):** require `express-rate-limit` + `helmet`; set
`app.set('trust proxy', 1)` so limits key off the real client IP behind
Cloudflare. A **tight limiter on auth** (`/login`, `/change-password` — e.g.
20 / 15 min) is the brute-force defence; a looser global limiter on `/api`.
**Static SPA:** the frontend can't rate-limit — it lives in the backend it
talks to (e.g. the WordPress plugin) **and** at the edge.
**IP ban belongs at the edge, not in app code** — a Cloudflare WAF / IP Access
Rule. See `assets/cloudflare-edge.md`.
- [ ] Auth endpoints have a strict rate limiter
- [ ] Global limiter on the API
- [ ] `trust proxy` set correctly (or limits key off the proxy IP, not users)
- [ ] Edge WAF / IP Access Rule available for hard blocks

### 2. Broken auth / sessions / multi-tenant isolation → "User A sees User B's data"
The company-ending one. Check:
- [ ] **Tokens expire** (JWT `expiresIn`, e.g. 24h) — not "JWTs never expire"
- [ ] **Token isn't reachable by page scripts** — store the session in an
  `httpOnly` + `secure` + `sameSite` cookie, *not* localStorage (XSS can't read
  httpOnly cookies). Avoids token theft and the "tokens colliding" trap.
- [ ] **Stateless signed JWT** (no shared mutable session store to collide
  under concurrency), secret from env with **no fallback** (`JWT_SECRET`, never
  `|| 'secret'`)
- [ ] **Authorization on every record-scoped route** — a logged-in user must
  only reach *their* tenant's data. The IDOR test: pass another tenant's id in
  the URL/body and expect **403**. In OMI this is `requireClientAccess` /
  `assertClientAccess` + `getVisibleClientIds`; every client-scoped route must
  apply it. One route that forgets = a hole.
- [ ] Role/permission re-checked server-side per request (don't trust the JWT's
  cached role; re-read from DB so revocation is instant)
- [ ] Public/webhook/worker routes that skip session auth authenticate another
  way (HMAC signature over the raw body, shared-secret token) — and actually
  verify it with a timing-safe compare

### 3. Secret keys exposed on the frontend → devtools → Ctrl-F `sk-`
- [ ] **No API keys in the client bundle.** All third-party calls (Claude,
  Stripe, Replicate, …) go through the **backend**; keys live in server env.
- [ ] No `VITE_`/`import.meta.env`/`process.env` **secret** baked into frontend
  (only non-secret config like an API base URL belongs there)
- [ ] Settings/admin screens **mask** saved secrets — GET returns `••••`, never
  the real value; any "reveal" endpoint is admin-only
- [ ] Grep the built bundle for `sk-ant-`, `sk_live_`, `whsec_`, `AKIA`,
  `-----BEGIN` — expect nothing but placeholders
- [ ] **Static SPAs that hold a user credential** (e.g. a WordPress Application
  Password in localStorage) can't avoid it being client-side — so compensate:
  least-privilege credential, revocable, **CSP headers** to blunt XSS, and
  enforce **HTTPS** so Basic-auth creds never cross the wire in cleartext

### 4. Exposed `.env` / secrets in git
- [ ] `.env`, `.env.*` gitignored; only `.env.example` **placeholders** committed
- [ ] `git ls-files | grep -i '\.env$'` returns nothing real
- [ ] Secrets **encrypted at rest** if stored in a DB (not plaintext columns)
- [ ] No real secret in any committed file (scan `.env.example`, configs, CI)

## Broader checklist (adjacent, worth a look)
- [ ] Passwords hashed with **bcrypt/argon2** (cost ≥ 10), never plaintext/MD5
- [ ] **Parameterised SQL** everywhere — no user input string-interpolated into
  a query (`${userInput}` inside `query(...)` is the smell)
- [ ] **Security headers** present (CSP, HSTS, X-Content-Type-Options,
  X-Frame-Options/`frame-ancestors`, Referrer-Policy) — see
  `assets/security-headers.template`
- [ ] **CORS** origin pinned (never `*` when credentials are sent)
- [ ] File uploads / body size capped; SSRF-prone fetches validated
- [ ] Dependencies: `npm audit`; vendor third-party JS locally (or pin + SRI)
  rather than hot-linking a CDN

## How to run an audit

1. **Classify the app**: server-backed (has its own API/DB → all four apply
   directly) or static SPA (threats 1–2 mostly live in its backend + the edge;
   focus the frontend pass on threat 3 + XSS + headers + HTTPS).
2. **Sweep secrets & git** first (fast, high-signal): the greps in threats 3–4.
3. **Trace auth**: middleware → token storage → expiry → per-route
   authorization. For multi-tenant apps, prove the IDOR 403.
4. **Check the edge**: rate limiting + WAF/IP rules (`assets/cloudflare-edge.md`).
5. **Write findings** to `docs/<app>/security-audit.md` as ✅ / ⚠️ / ❌ with
   file:line evidence and a concrete fix per gap. Don't claim "secure" — claim
   "passes these checks; here are the gaps."
6. **Verify, don't trust the middleware's existence** — a guard that exists but
   isn't mounted on a route is worse than none (false confidence).

## October-specific assets
- `assets/cloudflare-edge.md` — IP-ban / WAF / edge rate-limit setup (the
  right home for the "I wish I could IP ban" gap).
- `assets/security-headers.template` — a ready `_headers` file (CSP + the rest)
  for static Cloudflare Pages apps; tune `connect-src`/`script-src` per app.

## If a built-in audit exists, run it
OMI ships a live self-audit (`services/securityAudit.js`, `POST
/api/security/audit/run`) that pass/fails several of these. Prefer running and
extending it over re-deriving by hand.
