# falcon-stock Worker: code notes

Code-level notes only. The design is `docs/falcon-back-in-stock/ARCHITECTURE.md` §6; install steps live in the docs folder.

## Files

| File | What |
|---|---|
| `worker.js` | The whole Worker. One ES module, no imports. Paste into the Cloudflare dashboard editor as-is. `export default { fetch, scheduled }`; the named exports are pure helpers for tests (Cloudflare ignores them). |
| `tests/worker.test.mjs` | Node built-in test runner. Pure helpers plus mocked-fetch end-to-end tests of `/subscribe`, `/hooks/order` and `/c`. |
| `tests/index.js` | Lets `node --test tests/` work on Node 22, which does not expand directories. |
| `package.json` | Only `"type": "module"` so Node loads `worker.js` as ESM. No dependencies. |
| `wrangler.toml` | Reference only. |

## Tests

```
node --test dev/falcon-back-in-stock/worker/tests/
# or
node --test 'dev/falcon-back-in-stock/worker/tests/*.test.mjs'
```

Needs Node 19 or later (global `crypto.subtle`, `fetch`, `Request`, `Response`, `FormData`).

## Environment

| Name | Type | Notes |
|---|---|---|
| `SHOPS` | JSON var | Per store (`uk`, `us`, `eu`): `domain` (myshopify domain), `storefront` (origin allowed by CORS), `sender` `{name,email}`, `templates` `{bis,delay_uk,delay_us_notice,delay_us_consent,staff}` (Brevo IDs), `staff_email`, `withdrawal_url` (EU only). Optional: `reply_to` `{email,name}` (Brevo `replyTo`), `logo_url` (sent as the `logo_url` param). |
| `ADMIN_TOKEN_UK` / `_US` / `_EU` | secret | Admin API token per store. |
| `BREVO_API_KEY` | secret | |
| `TURNSTILE_SECRET` | secret | The widget must use action `restock-subscribe` (the theme does). |
| `FLOW_KEY` | secret | Compared in constant time with the `X-Falcon-Key` header. |
| `LINK_SECRET` | secret | HMAC key for `/u` `/k` `/c` links. Rotating it invalidates every link already emailed. |
| `API_VERSION` | var | Default `2026-07`. |
| `DRY_RUN` | var | `"true"`: see below. |
| `WORKER_URL` | var | **Addition to §6.** Public base URL used in email links. Required for the cron run, which has no request URL. |

**Admin API scopes:** as §6, **plus `read_all_orders`**. Without it the Admin API only returns orders from the last 60 days, and preorders can be older.

## Endpoints

| Route | Auth | Notes |
|---|---|---|
| `OPTIONS/POST /subscribe` | CORS: `Origin` must be `SHOPS[body.store].storefront` | Returns `{ok:true}` or `{ok:false,error:"invalid_email"\|"bot"\|"unknown_variant"\|"server"}` (403 `forbidden` for a wrong origin). |
| `POST /hooks/order` | `X-Falcon-Key` | `{store, order_id}` (GID or number). Non-2xx on hold failure so Flow retries. |
| `POST /hooks/inventory` | `X-Falcon-Key` | `{store, variant_id, ...}`. Re-reads the live quantity; the Flow quantities are only logged. Fan-out stops after about 25 s so Flow gets an answer inside its 30 s; the daily run finishes the rest. |
| `POST /hooks/daily` | `X-Falcon-Key` | Optional `{store}`. Same as the cron. |
| `GET/POST /u /k /c` | signed token `t` | GET shows a page with a button; only POST changes anything. |
| cron `0 7 * * *` | | `runDaily` for every store in `SHOPS`. |

## Behaviour worth knowing (including where this goes beyond §6)

- **Idempotency.** Brevo `headers.idempotencyKey` = UUID v5 of a key string (`bis|store|variant|customer|date`, `delay|store|variant|order|delayCount|newDate`, `staff|store|...`). Brevo's window is 30 minutes, so Shopify tags are the real record.
- **Order hook ordering.** `preorder-v{id}` tags first, then one `fulfillmentOrderHold` per preorder variant (so each variant sits on its own held fulfillment order and can be released on its own), then the cap check, then `preorder` last. The `preorder` tag (the idempotency marker) is only added once every hold succeeded.
- **Release.** Only holds with handle `falcon-preorder` are released (`holdIds`). A held fulfillment order that also carries other items is never released automatically.
- **Waitlist.** Send, then one request that adds `restock-notified-{id}` and removes `restock-{id}`. A customer found with both tags is cleaned up without a second email. `/subscribe` removes an old `restock-notified-{id}` so a re-subscriber is emailed next time.
- **`/u` removes every `restock-{id}` tag** (all waitlists), per the email copy. Token payload is `{s, a:"u", c}`.
- **Date-change markers.** Each order emailed about a change gets `preorder-notice-v{id}-{delayCount}-{newDate}` (new tag type) so a crashed or repeated run never emails twice. Delay numbers `n` and `delay_count_before` are counted per order from its `preorder-delay-{n}` tags. An order whose `_preorder_date` already equals the new date is skipped. `notified_date` / `delay_count` are only updated when every email for that change succeeded.
- **Missing `delay_reason`.** For a later date the job waits (and flags it in the digest) until 2 days before the old date, then sends without a reason.
- **Cancel requests** add `preorder-cancel-requested` plus `preorder-cancel-requested-on-{YYYY-MM-DD}` (new tag type), which the 3-day digest check reads.
- **US deadlines.** The latest `preorder-keep-by-{date}` is compared with `preorder-kept-{max n}`. `/k` refuses a stale `n`, a passed deadline or `preorder-cancel-due`.
- **DRY_RUN.** Customer emails go to `staff_email` with a `dry_run_banner` param. It also skips the tags and metafields that record "customer was told" (waitlist swap, delay markers, `notified_date` updates) so real customers are still emailed after DRY_RUN is turned off, and caps each batch at 5 emails. Holds, releases and staff alerts run normally.
- **Never automatic:** cancellation, refunds, consent downgrades.
- **Logging.** One JSON line per action (`event` field); emails are masked (`j***@example.com`).

## VERIFY list (Admin API 2026-07 / Brevo)

Search `VERIFY:` in `worker.js`. Also confirm that `tag:'restock-123'` search behaves as expected. The code re-checks exact tags either way.
