# falcon-stock Worker: code notes

Code-level notes only. The design is `docs/falcon-back-in-stock/ARCHITECTURE.md` §6; install steps live in the docs folder.

## Files

| File | What |
|---|---|
| `worker.js` | The whole Worker. One ES module, no imports. Paste into the Cloudflare dashboard editor as-is. `export default { fetch, scheduled }`; the named exports are pure helpers for tests (Cloudflare ignores them). |
| `tests/worker.test.mjs`, `tests/review-fixes.test.mjs`, `tests/review-fixes-2.test.mjs` | Node built-in test runner. Pure helpers plus mocked-fetch end-to-end tests of `/subscribe`, `/hooks/order`, `/hooks/inventory`, `/c`, `/k` and the daily job. |
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
| `SHOPS` | JSON var | Per store (`uk`, `us`, `eu`): `domain` (myshopify domain), `storefront` (public storefront URL, used in product links), `origins` (array of origins allowed by CORS on `/subscribe`: the storefront, the `https://{store}.myshopify.com` domain and any theme-preview origin; when missing, only `storefront` is allowed), `sender` `{name,email}`, `templates` `{bis,delay_uk,delay_us_notice,delay_us_consent,staff}` (Brevo IDs), `staff_email`, `withdrawal_url` (EU only). Optional: `reply_to` `{email,name}` (Brevo `replyTo`), `logo_url` (sent as the `logo_url` param). |
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
| `OPTIONS/POST /subscribe` | CORS: `Origin` must be in `SHOPS[body.store].origins` (fallback: `storefront`) | Returns `{ok:true}` or `{ok:false,error:"invalid_email"\|"bot"\|"unknown_variant"\|"server"}` (403 `forbidden` for a wrong origin). |
| `POST /hooks/order` | `X-Falcon-Key` | `{store, order_id}` (GID or number). **Flow must call this for every order (no condition)**, see below. Non-2xx on hold failure so Flow retries. |
| `POST /hooks/inventory` | `X-Falcon-Key` | `{store, variant_id, ...}`. Answers `202 {ok:true, accepted:true}` straight after auth and validation (400 for a bad store or variant id); release and fan-out then run in `waitUntil` inside one 25 s budget (`INVENTORY_BUDGET_MS`). Anything left over is finished by the daily run. Re-reads the live quantity; the Flow quantities are only logged. |
| `POST /hooks/daily` | `X-Falcon-Key` | Optional `{store}`. Same as the cron. |
| `GET/POST /u /k /c` | signed token `t` | GET shows a page with a button; only POST changes anything. |
| cron `0 7 * * *` | | `runDaily` for every store in `SHOPS`. |

## Flow change: the order Flow has no condition

`Falcon – preorder order` used to run only for orders with a `_preorder_date` line. It must now call `/hooks/order` for **every** order: remove the condition. The Worker finds unlabelled oversells itself (below). A normal order costs one order query: the Worker exits early when no line has `_preorder_date` and no line's variant is at or below zero.

## Behaviour worth knowing (including where this goes beyond §6)

- **Unlabelled oversell.** The theme caps quantity per add only, so a customer (or another sales channel) can take an in-stock variant below zero without the pre-order label. For every line **without** `_preorder_date` whose variant's `inventoryQuantity` is now below zero, the units below zero that this order is responsible for (its labelled units for that variant count first, and never more than `-inventoryQuantity`) are treated as pre-order units:
  - variant has a valid pre-order setup (the theme rule via `variantPreorderState`, ignoring the cap, which is checked separately): those units are held like a pre-order line and the order is tagged `preorder`, `preorder-v{id}` and `preorder-unlabelled`. Staff are alerted that the customer was **not shown a date** and must be contacted. An unlabelled line can be held in part (only the units below zero).
  - no valid setup, including policy DENY: not held; tagged `oversold-v{id}` and staff alerted (once: a retry with the tag present does not alert again).
  - untracked variants are ignored.
  - The quantity is read when the hook runs, not when the order was placed; a restock in between means nothing is held.
- **Holds are by line item.** Only fulfillment order line items whose `lineItem.id` is a pre-order line (or the held part of an unlabelled line) are held, one `fulfillmentOrderHold` per variant. A same-variant line in the order that is not a pre-order ships now. Fulfillment orders already held by us are counted first, so a retry never holds units meant to ship.
- **Hold refused** (fulfillment order not OPEN, or a user error): the order is tagged `preorder-hold-failed` and staff get one alert; Flow retries (non-2xx) and later runs do not alert again. The daily job retries every open order tagged `preorder-hold-failed` first; on success it adds `preorder` and removes `preorder-hold-failed`; if it still fails the digest lists it.

- **Idempotency.** Brevo `headers.idempotencyKey` = UUID v5 of a key string (`bis|store|variant|customer|date`, `delay|store|variant|order|delayCount|oldDate|newDate`, `staff|store|...`). Brevo's window is 30 minutes, so Shopify tags are the real record.
- **Order hook ordering.** `preorder-v{id}` (+ `preorder-unlabelled`, `oversold-v{id}`) tags first, then one `fulfillmentOrderHold` per preorder variant (so each variant sits on its own held fulfillment order and can be released on its own), then the cap check, then `preorder` last. The `preorder` tag (the idempotency marker) is only added once every hold succeeded.
- **Release.** Only holds with handle `falcon-preorder` are released (`holdIds`). A held fulfillment order that also carries other items is never released automatically.
- **Overlapping runs** (two inventory events, a Flow retry, the daily job). Release re-reads each order's fulfillment orders just before releasing and releases only holds still present, so nothing is released twice. Released-but-unshipped units stay committed in `inventoryQuantity`, so a run that starts after another's release computes the same total. The fan-out re-reads each customer just before emailing and skips anyone no longer tagged `restock-{id}` or already tagged `restock-notified-{id}`; the Brevo idempotency key is the second line of defence. With a time budget, planning is oldest first, so a partial plan only releases orders the full plan would also release.
- **Waitlist.** Skipped (everyone stays waiting) while the product is not ACTIVE. Send, then one request that adds `restock-notified-{id}` and removes `restock-{id}`. A customer found with both tags is cleaned up without a second email. `/subscribe` removes an old `restock-notified-{id}` so a re-subscriber is emailed next time.
- **`/u` removes every `restock-{id}` tag** (all waitlists), per the email copy. Token payload is `{s, a:"u", c}`.
- **Date-change markers.** Each order emailed about a change gets `preorder-notice-v{id}-{delayCount}-{oldDate}-{newDate}` (new tag type) so a crashed or repeated run never emails twice (the old date is in it because an earlier move and a later move back can share a count and new date). Delay numbers `n` and `delay_count_before` are counted per **(order, variant)** from its `preorder-delay-v{id}-{n}` tags: a delay to one item never makes another item's first delay a "second delay". The old date used per order is its `_preorder_date` if it has had no notice for that variant yet, otherwise `notified_date`; an order whose old date already equals the new date is skipped. `notified_date` / `delay_count` are only updated when every email for that change succeeded. An order with no email address is listed in the digest but does not block that update.
- **Date changed before the first daily run.** If `notified_date` is empty (first setup) the job still loads the variant's open pre-orders: any order whose own `_preorder_date` differs from `expected_date` gets the normal date-change notice (old date = its checkout date; marker and idempotency key use that date), and only then is `notified_date` set. With nobody to tell it is set straight away (in DRY_RUN too). Unlabelled orders have no checkout date and are skipped (staff were told to contact them).
- **Missing `delay_reason`.** For a later date the job waits (and flags it in the digest) until 2 days before the old date, then sends without a reason.
- **Cancel requests (`/c`) are per variant.** The token carries `v` (a token without it is refused). POST adds `preorder-cancel-requested` (order-level, for admin search), `preorder-cancel-requested-v{id}` and `preorder-cancel-requested-v{id}-on-{YYYY-MM-DD}`. If that variant's line is already fulfilled (no unfulfilled units), GET and POST show "This item has already been dispatched" and point to returns; nothing is tagged. The staff email names the item (product, variant, id), the unfulfilled quantity and the refund deadline. The 3-day digest check is per variant and stops once that line is no longer unfulfilled.
- **US deadlines, per variant.** For each variant the latest `preorder-keep-by-v{id}-{date}` is compared with `preorder-kept-v{id}-{max n}`. A deadline counts as passed only after the following UTC day (US customers read "by {date}" in their own time zone), for both `/k` and the daily check. A missed deadline tags only that variant `preorder-cancel-due-v{id}` and the staff alert names the item; a variant already `preorder-released-v{id}` or no longer unfulfilled is not flagged. `/k` (token carries `v`) refuses a stale `n`, a passed deadline or `preorder-cancel-due-v{id}`.
- **DRY_RUN.** On for `true`, `1`, `yes` or `on` (any case). Customer emails go to `staff_email` with a `dry_run_banner` param (fails closed if `staff_email` is missing), under their own Brevo idempotency keys (`dry|...`) so the real send after DRY_RUN is switched off is not dropped as a duplicate. Links in dry-run emails carry `d:1` and a POST with them changes nothing. It also skips the tags and metafields that record "customer was told" (waitlist swap, delay markers, `notified_date` updates) so real customers are still emailed after DRY_RUN is turned off, and caps each batch at 5 emails. Holds, releases and staff alerts run normally.
- **Never automatic:** cancellation, refunds, consent downgrades.
- **Logging.** One JSON line per action (`event` field); emails are masked (`j***@example.com`).

## VERIFY list (Admin API 2026-07 / Brevo)

Search `VERIFY:` in `worker.js`. Also confirm that `tag:'restock-123'` search behaves as expected. The code re-checks exact tags either way.

## Known limits

- **Time zones.** The theme decides "date not in the past" in the shop's time zone; the Worker uses UTC (unlabelled-oversell setup check, date-change job). Around midnight the two can disagree by one day. Accepted.
- **Newsletter consent is single opt-in.** `/subscribe` sets `SUBSCRIBED` / `SINGLE_OPT_IN` when the box is ticked. Whether UK/EU sign-ups need double opt-in is a legal decision still pending; nothing is built for it yet.
- **Unlabelled oversell is judged when the hook runs.** A restock or another order between checkout and the Flow call changes what is held; the daily release re-check corrects holds, not missed ones.
