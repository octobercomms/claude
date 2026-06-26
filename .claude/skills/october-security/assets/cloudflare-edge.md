# Edge security — Cloudflare (IP ban, WAF, rate limiting)

IP banning and broad abuse-blocking belong at the **edge**, not in app code.
App-level `express-rate-limit` blunts spam, but a determined attacker is best
stopped before the request reaches the origin. Cloudflare sits in front of both
October apps (OMI's box and the October Events Pages app), so use it.

## 1. IP Access Rules (the "I wish I could IP ban" gap)
Dashboard → **Security → WAF → Tools → IP Access Rules**. Add a rule:
- **Block** a single IP, a CIDR range, or a whole ASN/country.
- Scope: this website (or account-wide).
Use this for a live attack — paste the offending IP, action **Block**, done.
This is the capability the rate-limit-only setup is missing; no code change.

## 2. Rate limiting rules (per-endpoint, at the edge)
Dashboard → **Security → WAF → Rate limiting rules**. Example for login abuse:
- If URI path equals `/api/auth/login` and method is `POST`
- Then **Block** when more than **10 requests per 1 minute** per client IP
- Duration: 10 minutes.
Mirror the app's own `authLimiter` so brute-force is stopped at the edge too.

## 3. WAF Managed Rules + Bot Fight Mode
- Turn on **Cloudflare Managed Ruleset** (OWASP-style protections).
- Enable **Bot Fight Mode** (or Super Bot Fight Mode) to filter scripted abuse.
- For APIs hit only by your own frontend, consider a **WAF custom rule** that
  challenges/blocks requests whose `Origin`/`Referer` isn't your app.

## 4. Make sure the origin sees the real IP
The app must trust Cloudflare's forwarded IP or every rate limit/ban keys off
Cloudflare's IP instead of the user's:
- Express: `app.set('trust proxy', 1)` (OMI already does this) so
  `req.ip` / `express-rate-limit` use `CF-Connecting-IP` via `X-Forwarded-For`.
- Lock the origin's firewall so it **only** accepts traffic from Cloudflare IP
  ranges — otherwise an attacker who learns the origin IP bypasses the edge
  entirely.

## 5. Always-on hygiene
- **Always Use HTTPS** + **HSTS** (Edge Certificates) — on for both apps.
- DDoS protection is automatic on Cloudflare; no setup needed.

## Quick reference — responding to a live attack
1. WAF → IP Access Rules → Block the source IP/range/ASN.
2. Add/*tighten* a Rate limiting rule on the targeted path.
3. Confirm the origin firewall only allows Cloudflare ranges.
4. Watch **Security → Events** to confirm the blocks are landing.
