# October Events — security & performance audit

**Scope:** the `october-events` WordPress plugin (`dev/october-events`) and its
companion platform SPA (`dev/october-platform`). Read-only audit, run with the
`october-security` skill (same playbook as the OMI audit). Evidence is given as
`file:line`. Verdicts: ✅ pass · ⚠️ gap/risk · ❌ vulnerability.

**Bottom line.** The money paths and customer data-isolation are solid — server-side
pricing with the ADF-01 over-issue guard, signed webhooks, idempotent issuance,
no customer-to-customer IDOR, prepared SQL everywhere, encrypted secrets at rest,
a properly email-scoped public support chat. Three findings need attention before
they bite, headed by the **door check-in** and the **admin settings secret leak**.

---

## Re-audit — v1.66.15 (concurrency & scale focus)

The original P1–P4 below were **remediated** (random PINs, masked secrets, capability
gating, platform CSP/headers — shipped in the earlier hardening PRs and the 1.66.10
secret-field fix). This re-audit covers the ticketing code added since (partial/
transaction refunds, the Transactions and Failed-payments tabs, event-wide capacity,
manual orders) and the question: **can it handle ~1,000 concurrent buyers?**

**Security stayed clean** — no critical holes. Every `admin_post` handler is
capability + nonce gated; refunds/deletes aren't buyer-reachable; new SQL is all
prepared or int-cast; the new admin views escape output; secrets remain encrypted +
masked. The real risk is **concurrency**, not security:

| Sev | Finding | Evidence | Fix |
|-----|---------|----------|-----|
| ❌ Critical | **Overselling.** Capacity guard reads `event_sold_count()` then inserts with **no lock/transaction anywhere** (grep `GET_LOCK`/`START TRANSACTION`/`FOR UPDATE` = 0). 1,000 concurrent buyers all read "under cap" and all insert. | `Orders::create()` (count→insert), `TicketTypes::availability()` | Per-event `GET_LOCK` around count+insert — **1.66.16** |
| ⚠️ High | **Double-issue.** Stripe webhook + client `/ticket-confirm` both create orders for one payment; idempotency is check-then-act and `payment_id` is non-unique. | `RestApi` confirm/webhook → `Orders::create_cart()` | Per-payment `GET_LOCK` around the cart idempotency check — **1.66.16** |
| ⚠️ Med | **Promo over-redemption** under load (separate read of `max_uses` then increment). | `Promo::increment_usage`, `Orders::create()` | Atomic conditional `UPDATE … WHERE used_count < max_uses` — **1.66.16** |
| Low | Per-ticket insert return value unchecked / no token-clash retry. | `Orders::create()` ticket loop | Check + retry — **1.66.16** |
| ⚠️ High (perf) | **Redundant counts.** `availability()` runs the event-wide COUNT-JOIN **once per ticket type** every checkout render, uncached. | `Checkout::render()` loop → `event_sold_count()` | Per-request memoization — **1.66.17** |
| ⚠️ Med-High (perf) | **Missing composite indexes** — `orders(event_id,status)`, `tickets(order_id,status)`/`(event_id,status)`, `checkins(event_id,venue_name,ticket_id)`. Scans/filesorts at scale. | `Schema.php` (single-column keys only) | Add keys + bump `OE_DB_VERSION` — **1.66.17** |
| ⚠️ Med (perf) | Check-in log screen = ~5 aggregate queries/load. | `render_checkin_log()` | Index + transient-cache chart aggregates — **1.66.17** |
| ⚠️ Low (sec) | Unthrottled public read routes: `checkin-events`, `volunteer-shifts`, `map`, `confirm-payment`; Failed-payments "Refresh" nonce unverified. | `RestApi.php` | Add `rl()` + verify nonce — **1.66.17** |

**Deploy notes:** keep the site behind Cloudflare (IP limiters trust
`CF-Connecting-IP`); `GET_LOCK` is server-global on standard MySQL/MariaDB and the
locks **fail open** (proceed if unobtainable) so they can never block sales.

With 1.66.16 + 1.66.17 in, a 1,000-person on-sale is safe from overselling and fast.

---

## Top priorities (fix first)

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| P1 | 🔴 High | **Check-in PIN = event post ID** (guessable, public), spoofable IP throttle, and `/checkin-manifest` then hands out every live ticket token + attendee name | Random per-event PINs; don't trust `X-Forwarded-For`; gate the manifest behind the strong PIN |
| P2 | 🔴 High | **Admin Settings echoes decrypted secrets into the page** (Stripe/PayPal/Claude/SES/AWS/GitHub keys in `value="…"`) | Render masked placeholder; treat blank submit as "keep existing" |
| P3 | 🟠 Med | **Staff CRM/campaign/volunteer/AI APIs gated at `edit_posts`** (Contributor/Author), not `manage_options` | Bump to `manage_options`; add a rate limit to the AI endpoints |
| P4 | 🟠 Med | **No CSP/security headers on the platform host** (and it holds the WP app-password in `localStorage`) | Add a `_headers` file with CSP + the standard set |

---

## Threat 1 — API abuse / rate limiting / DoS

- ✅ Public mutating checkout/volunteer endpoints carry per-IP transient limiters
  (`RestApi::rl()`): `ticket-intent` (15), `ticket-promo` (20), `paypal-create`
  (15), `waitlist-join` (20), `volunteer-signup` (10), support chat (15/min).
- ✅ Customer `/submit` uses `require_login_rate_limited` (10/min/user).
- ⚠️ **`/ticket-confirm` and `/paypal-capture` have no limiter** (`RestApi.php`
  ~`520`, ~`586`). Functionally safe (server-trusted), but each call hits the
  Stripe/PayPal API for any attacker-supplied id → API amplification / minor
  cost-DoS. **Fix:** add `rl('ticket_confirm', 30)` / `rl('paypal_capture', 30)`.
- ⚠️ **IP throttle trusts forwarded headers.** `client_ip()` reads
  `X-Forwarded-For`/`X-Real-IP` from the request (`RestApi.php:183-190`), so every
  per-IP limiter (incl. the check-in PIN throttle) is bypassable by spoofing a
  fresh IP per request. **Fix:** use `REMOTE_ADDR` as the floor; only trust
  forwarded headers from a known proxy (Cloudflare ranges).
- ℹ️ Hard IP bans belong at the edge (Cloudflare WAF), not app code — see the
  skill's `cloudflare-edge.md`.

## Threat 2 — auth / IDOR / multi-tenant isolation

- ✅ **No customer-to-customer IDOR.** Every customer route derives the account
  from `Account::ensure(get_current_user_id())` — never request input — and
  queries by `submitter_account_id` (`/dashboard`, `/listings`, `/account`,
  `/submit`). `/confirm-payment` re-checks `submitter_account_id === account_id()`
  before advancing (ADF-06). Pass another account's id → you still only get your own.
- ✅ Door-staff PIN check is timing-safe (`hash_equals`, `CheckIn.php:54`).
- ❌ **P3 — Management APIs under-privileged.** `current_user_can('edit_posts')`
  gates the whole staff surface: `ContactsRest`, `CampaignsRest`, `Tasks\Rest`,
  `Volunteers\Rest`, `Reports\Rest`, `AI\Rest`, `Planning\Rest`. In default WP,
  **Contributor/Author** hold `edit_posts`. Such a user could export the entire
  contact CRM (`/contacts`, `/contact/{id}/activity`), delete contacts/lists,
  import CSVs, **send a campaign to the whole audience** (`/campaigns/{id}/send`),
  read volunteer PII (`/volunteers/opportunity/{id}`), and run the staff AI over
  all data. **Fix:** require `manage_options` (or a dedicated `oe_manage` cap) on
  these. Keep `edit_posts` only where Authors genuinely belong (the task board, if
  intended).
- ⚠️ GET handlers for `/planning/event/{id}` and `/volunteers/opportunity/{id}`
  check post *type* but not a per-object capability (the write paths correctly add
  `edit_post($id)`). Lower severity in a single-tenant install; fix alongside P3.

## Threat 3 — secrets exposed to the client

- ✅ Secrets encrypted at rest with libsodium `secretbox` (`Crypto.php`); keys
  prefer wp-config constants over the DB; `.env`/secrets not in git; no API keys
  in the SPA bundle; `oe/v1/brand` returns only theme/brand/feature fields.
- ❌ **P2 — decrypted secrets rendered into the admin DOM.**
  `admin/views/settings.php:253` (all API keys), `:338` (SES password), `:397`
  (AWS secret), `:431` (GitHub token) emit the *decrypted* value into
  `value="…"` of a `type="password"` field, with a client-side show/hide toggle.
  Encrypted at rest, then fully re-exposed to the browser — shoulder-surf /
  extension / cached-DOM exposure for anyone with admin-page access. **Fix:**
  render `value="" placeholder="••••••• (saved)"` when a secret exists, and on
  save treat an empty field as "keep existing" (the pattern already used for
  constant-pinned keys at `:249`).

## Threat 4 — `.env` / secrets in git

- ✅ No `.env` tracked (`git ls-files` clean); `.gitignore` covers `.env*`;
  secrets encrypted in the DB; no real secret in any committed file.

## Payment & ticketing (tamper-resistance)

- ✅ **Amount tampering blocked (ADF-01).** Orders are priced server-side from
  `TicketTypes`; `ticket_confirm` trusts only the PaymentIntent's own metadata +
  `amount_received`; `create_ticket_order_from_meta` rejects when computed total >
  captured (`RestApi.php:826`).
- ✅ **PayPal can't be forged/replayed.** `paypal-create` stashes the trusted cart
  in a transient keyed by the PayPal order id; `paypal-capture` verifies via
  PayPal's API (`status === COMPLETED`, real captured amount), is idempotent on the
  capture id, and a forged `paypal_order_id` has no stash → rejected.
- ✅ **Idempotent issuance** on `payment_id` / capture id (`Orders::by_payment`).
  ⚠️ No DB `UNIQUE(payment_id)` / `UNIQUE(token)` constraint → a tiny TOCTOU window
  under truly concurrent confirm+webhook; add unique indexes to make it airtight.
- ✅ **Webhook signature verified** (`StripeConnector::parse_webhook`); unsigned
  rejected in prod unless an explicit dev-only constant is set (ADF-02).
- ✅ **Free/comp path** only triggers on a server-computed `< 50¢` total; comp
  orders are admin-only (`manage_options` + nonce).
- ✅ **Promo** clamps discount to subtotal, floors total at 0, recomputed
  server-side. ⚠️ `increment_usage` is a non-atomic read-modify-write → `max_uses`
  can be overshot slightly under concurrency. Fix with a conditional
  `UPDATE … WHERE used_count < max_uses`.
- ✅ **Refunds** only via the admin handler (`manage_options` + nonce); the correct
  capture is targeted (Stripe PI / PayPal capture id). Note: full-refund-only.

## Check-in (the priority — P1)

- ❌ **Default PIN is the event post ID.** `TicketTypes::pin()` returns the event
  post ID when no custom PIN is set (`TicketTypes.php:143-146`). Post IDs are
  sequential and routinely public — and `/checkin-events` returns event IDs +
  titles **unauthenticated** (`RestApi.php:121`, `CheckIn::events`). So the PIN is
  derivable with zero guessing.
- ❌ **Throttle bypassable** — keyed off the spoofable forwarded IP (see Threat 1).
- ❌ **Manifest leaks the admission credential.** Past the PIN, `/checkin-manifest`
  returns **every active ticket's token + attendee name + type** plus the
  checked-in set (`CheckIn::manifest`). Tokens are the admission credential (the
  public ticket page and `checkin-scan`/`checkin-sync` accept the raw token), so
  this enables attendee-list disclosure, ticket forging/cloning, and fake check-ins.
  (No email is exposed.)
- **Fixes:** (1) auto-generate a random 6–8 digit PIN per event; never derive from
  the post ID. (2) Enforce a minimum PIN length. (3) Throttle on `REMOTE_ADDR`, add
  a per-event global attempt ceiling. (4) Don't return raw tokens by PIN alone at
  internet scale — gate the manifest behind a real door-staff session/signed device
  token, or at minimum the strong PIN from (1).

## AI endpoints

- ✅ **Public support chat is well-scoped:** email proven via a hashed, attempt-
  capped 6-digit code with anti-enumeration; HMAC session token (1h TTL); the
  verified email is **bound into the tool executor server-side** so prompt
  injection can't widen scope; 15 turns/IP/min.
- ⚠️ **Cost ceiling is loose** — only per-IP. A verified attacker on rotating
  IPs/IPv6 can drive unbounded Claude tool-loops. **Fix:** per-email turn cap +
  global daily message ceiling / spend budget.
- ⚠️ **Staff `/assistant` + `/campaigns/copilot`: no throttle** and `edit_posts`
  (see P3). Cost-DoS by a low-priv user. **Fix:** `manage_options` + a light cap.

## SQL / SSRF / email / redirects

- ✅ **SQL injection: clean.** ~110 `$wpdb->` sites all use `prepare()` / casts;
  ORDER BY and table names are literals; LIKE uses `esc_like`.
- ✅ **No open redirect / SSRF in web paths.** Campaign click redirect is HMAC-
  signed (`Campaigns::verify_link`, constant-time, falls back to `wp_safe_redirect`);
  SNS webhook host-allow-lists `sns.*.amazonaws.com`; other connectors use constant
  hosts.
- ✅ **No email header injection** (subjects/names `sanitize_text_field`'d before
  `wp_mail`; bodies fully escaped). **Unsubscribe is HMAC-verified** — no arbitrary-
  address unsubscribe / IDOR.
- ⚠️ **AI Stories feed fetch** (`Cron.php:295`, `fetch_feed` over admin URLs) uses
  the non-safe HTTP path; `esc_url_raw` doesn't block `169.254.169.254`/localhost/
  RFC1918. Admin-gated + cron, but on shared hosts it's a metadata-SSRF vector.
  **Fix:** `wp_http_validate_url()` (or a private/loopback/link-local deny) per URL.
- ℹ️ Ticket-email QR is fetched from `api.qrserver.com` with the token in the URL
  (`Transactional.php`) — a third party sees every token at render. A local/data-URI
  QR would keep tokens in-house.

## Platform SPA (`october-platform`)

- ✅ No secrets in the bundle; auth is the user-typed WP Application Password
  (Basic auth), stored in `localStorage`; `esc()` is applied consistently at the
  ~40 `innerHTML` sinks (assistant markdown is escaped-then-formatted); CORS is
  pinned to an admin-configured allow-list (never `*`).
- ❌ **P4 — no CSP / security headers.** `dev/october-platform` ships only
  `_redirects` — no `_headers`, so no CSP, `X-Frame-Options`/`frame-ancestors`,
  `X-Content-Type-Options`, `Referrer-Policy`, HSTS. Because the WP app-password
  lives in `localStorage`, any XSS = full WP API credential theft, and a CSP is the
  defense-in-depth net for any escaping miss. **Fix:** add `dev/october-platform/_headers`
  with a strict CSP (`default-src 'self'; connect-src 'self' <wp hosts>; img-src
  'self' https: data:; frame-ancestors 'none'; base-uri 'none'`), `nosniff`, and
  `Referrer-Policy`. (Tune `connect-src` to the WP REST hosts; the email-preview
  inline styles may need `style-src 'unsafe-inline'`.)

---

# Performance

Two root causes dominate (uncached per-row meta/title lookups, and an autoloaded
+ un-memoized settings option), plus a few unbounded queries and SPA re-render
wins. Ranked by real impact at festival scale.

## Plugin (PHP / MySQL)

1. 🔴 **`/stats` N+1 (~500 queries).** `Reports/Rest.php:52-57` loops
   `Events::status($id)` over bare IDs with no primed meta cache → one
   `wp_postmeta` SELECT per event, on the most-hit KPI endpoint. **Fix:**
   `update_meta_cache('post', $ids)` before the loop, or a single grouped
   `SELECT meta_value, COUNT(*) … GROUP BY meta_value`. ~500 → 1–2.
2. 🟠 **`oe_settings` autoloaded + `Settings::get` not memoized.** The option is
   stored without `autoload => 'no'` (`Settings.php:167`, `Activator.php:25`) and
   `get()`/`all()` re-run `wp_parse_args(get_option(), defaults())` every call;
   `Brand\Rest` + `Features::all()` call it ~20×/request. **Fix:** `autoload 'no'`
   + memoize the merged array in a `static` (bust on `update()`); read the features
   map once.
3. 🔴 **Volunteers nested N+1.** `opportunity_summary/detail` and
   `admin/views/volunteers.php` call `count_for_shift` per shift (+ `spots_left`
   + `shift_full` re-counting) over an unbounded opportunity list. **Fix:** one
   `… WHERE opportunity_id IN (…) GROUP BY opportunity_id, shift_id` and tally in
   PHP. ~500 → ~2–3.
4. 🟠 **Admin list tables: per-row `get_the_title()` with no primed cache** —
   `sales.php:56`, `registrations.php:83`, `checkin-log.php:85`, `waitlist.php:49`,
   `promos.php:56`. **Fix:** `_prime_post_caches(wp_list_pluck($rows,'event_id'))`
   before the view.
5. 🟡 **Dashboard 15 COUNT queries** (`Admin::count_by_status`, 3 × ~5 types).
   **Fix:** one grouped count.
6. 🟡 **Unbounded queries on growing tables:** `Waitlist::all()` (no LIMIT),
   `Contacts::counts()` (4 full scans → fold into one), `Volunteers::all_opportunity_ids`
   / `for_event` (`posts_per_page => -1`), `registrations` hard `LIMIT 500` with no
   paging. **Fix:** paginate / single aggregate.
7. 🟠 **Campaign send:** pulls the whole subscriber base into PHP then one
   `INSERT` per recipient (`Campaigns.php:222-275`). 50k contacts = 50k inserts in
   one request. **Fix:** `INSERT … SELECT` or chunked multi-row inserts; cache the
   campaign per dispatch tick.

✅ Already good: `/brand` sets `Cache-Control: max-age=300`; admin assets gated to
plugin screens; payment SDKs deferred + page-scoped; `Orders::stats/daily_sales`
and `CheckIn::log/stats` properly aggregated.

## Platform SPA

8. 🟠 **No API cache/dedup; every mutation refetches the whole list** (`api.js`
   bare `fetch`; task/contact/list mutations call `…then(renderX)`). Changing one
   row of 500 re-downloads all 500. **Fix:** small in-memory GET cache + in-flight
   dedup keyed by URL, `bust(prefix)` after mutations (extend the `taskMeta`
   pattern).
9. 🟠 **Full `innerHTML` rebuild + per-row listeners on every state change**
   (`app.innerHTML=''`, view wipes, no delegation). **Fix:** patch the changed node;
   one delegated listener per list.
10. 🟡 **Contacts pagination unused** (rebuilds whole `<tbody>`, ignores `offset`);
    **assistant transcript repaint** is O(n²) per send. **Fix:** real pagination;
    append-only chat bubbles.
11. 🟡 **~1 MB animated-GIF logos** load on every page. **Fix:** SVG/WebP (~95%
    smaller; the repo's `webp-image-optimizer` can do it).

✅ Already good: GrapesJS + preset are lazy-loaded only when the email "Refine"
step opens; fonts self-hosted with `font-display:swap`.

## Suggested order of attack (perf)

1. Prime meta cache in `Reports/Rest.php` (#1) — biggest single win.
2. `Settings` memo + `autoload 'no'` (#2) — helps every request.
3. Volunteers query collapse (#3) + `_prime_post_caches` across admin views (#4).
4. SPA API cache/dedup (#8) + in-place patching (#9).
5. Unbounded caps (#6), campaign bulk insert (#7), grouped dashboard count (#5),
   GIF logos (#11).
