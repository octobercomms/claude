# Security audit — October Events / ADF platform (`dev/october-platform`)

Audited against the four canonical failure modes (see the `october-security`
skill). This app is a **backend-less static SPA** (Cloudflare Pages) that logs
into WordPress sites and talks **directly** to their REST API. That shape moves
where each threat lives. Date of audit: 2026-06.

## How this app authenticates (context)
- Login = **WordPress Application Password** sent as HTTP **Basic auth**
  (`btoa(user:apppw)`), per request (`assets/api.js`).
- Credentials stored in **plaintext `localStorage`** (`oe_platform_sites`).
- The real API + authorization + AI keys live in the **WordPress plugin**
  (`dev/october-events`), not here. This frontend holds no server secrets.

## 1. API abuse / rate limiting — ⚠️ (lives elsewhere)
A static site can't rate-limit. It must happen in:
- the **WordPress plugin's** REST routes (`dev/october-events`) — especially any
  login/credential-validation path, and
- **Cloudflare** in front of the WP site (the API origin) and the Pages app.
- [ ] Action: confirm the October Events plugin rate-limits its `oe/v1`
  endpoints; add a Cloudflare rate-limit rule on the WP REST API. IP-ban via
  Cloudflare IP Access Rules (`cloudflare-edge.md`).

## 2. Auth / sessions / isolation — ⚠️ (delegated to WordPress)
- No JWT/session of its own — every request carries the App Password; WordPress
  enforces that user's capabilities. Multi-tenant isolation is **per-site**
  (separate base URLs) plus WP roles.
- [ ] Action: verify every `oe/v1` route in the plugin sets a proper
  `permission_callback` (capability check) — that's where "User A sees User B's
  data" would originate, not in this frontend.
- **App Password = a full, reusable credential** for that WP user. Guidance:
  use a **dedicated least-privilege WP user** per connection, and revoke the
  App Password (WP → Users → Profile) when a laptop is lost or access ends.

## 3. Secrets on the frontend — ⚠️ (credential-in-browser by design)
- ✅ No hardcoded API keys; vendor JS (GrapesJS, newsletter preset) is **local**,
  not hot-linked from a CDN.
- ⚠️ The **App Password sits in plaintext `localStorage`** and the app has
  **44 `innerHTML` sinks** (`assets/app.js`). If any sink renders unsanitised
  data from the WP API (event/contact/campaign text, AI assistant output), an
  XSS could **exfiltrate the App Password**. There is an `esc()` helper — but
  its coverage across all 44 sinks needs verifying.
- **Fixes (highest value first):**
  1. **Add a `_headers` CSP file** (ready template in the skill:
     `assets/security-headers.template`). `script-src 'self'` + `connect-src
     'self' https:` is the single biggest XSS mitigation here. *Not yet present.*
  2. **Audit the 44 `innerHTML` uses** — ensure every dynamic value goes through
     `esc()` (or switch to `textContent`/templating for untrusted data).
  3. Consider `sessionStorage` (clears on tab close) over `localStorage` for the
     App Password, and a "sign out everywhere" that wipes it.

## 4. Exposed `.env` / secrets in git — ✅ (n/a for the static app)
- No `.env`, no server secrets in this app. (The plugin's secrets — e.g. the AI
  key — live in WordPress options in `dev/october-events`; audit there.)

## Other
- ⚠️ **No HTTPS enforcement** on the Site URL. Basic-auth creds over `http://`
  cross the wire in cleartext. Fix: normalise/require `https://` in `setCreds`/
  `call` (`assets/api.js`), and rely on Cloudflare **Always Use HTTPS** + HSTS.

## Recommendations (ranked)
1. **Add `_headers` with CSP + security headers** (template ready) — biggest win
   for the localStorage-credential risk. *Ready to apply on request.*
2. **Enforce HTTPS** on the connected site URL in `api.js`.
3. **Sweep the 44 `innerHTML` sinks** for unescaped untrusted data.
4. **Confirm `permission_callback` + rate limiting in the `dev/october-events`
   plugin**, and add Cloudflare rate-limit/IP rules on the WP API.
5. Operational: least-privilege, revocable WP App Passwords per connection.
