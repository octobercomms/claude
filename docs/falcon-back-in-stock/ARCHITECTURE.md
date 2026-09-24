# Falcon stock system: architecture (back-in-stock + preorder)

**Client:** Falcon Enamelware. Three Shopify stores, all on Grow or above:

| Store code | Domain | Currency | Spelling / date format |
|---|---|---|---|
| `uk` | www.falconenamelware.com | GBP | British, `12 November 2026` |
| `us` | us.falconenamelware.com | USD | American, `November 12, 2026` |
| `eu` | eu.falconenamelware.com | EUR | British, `12 November 2026` |

**Replaces:** Purple Dot.
**Installed by:** Claude in Chrome, following `INSTALL.md`. Every part must be installable from a browser: Shopify admin, theme code editor, Flow editor, Cloudflare dashboard, Brevo dashboard. No CLI, no build step.

Research behind these decisions: `research/shopify.md`, `research/brevo-compliance.md` (in this folder).

---

## 1. What the system does

1. **Notify me.** A variant is sold out and not on preorder. The customer leaves their email. A new sign-up gets one "You're on the waitlist" email (a repeat sign-up for the same variant does not). When stock returns they get one back-in-stock email, and they come off the list. Both waitlist emails carry a per-product link ("Don't email me about this product again") and an all-waitlists link. Signing up again for that product clears the per-product opt-out.
2. **Preorder.** A variant is sold out but has an expected date and a cap. The customer sees "Pre-order" and "Ships from {date}. Payment taken today." before adding to cart. Full payment at checkout. An order of only preorder lines has only those lines held.
3. **Mixed basket** (a preorder line plus an in-stock line). The cart asks: **Ship together** (the default: one delivery, the whole order is held until the preorder ships) or **Ship separately** (a "Second delivery" fee line, priced at the store's standard delivery rate; in-stock lines ship now, only the preorder lines are held). The choice is the cart attribute `Delivery preference`. An order without it (express checkout that skips the cart, JavaScript off, no fee price available) is treated as ship together.
4. **Stock arrives.** Held preorder lines are released oldest order first, as far as the new stock covers them. A ship-together order's in-stock lines are released with its last preorder hold, or by the daily check when nothing is left to wait for (the preorder item was refunded, cancelled or released by hand).
5. **Date changes.** Every customer with an open preorder for that variant is emailed the new date, the reason, and their right to cancel. US customers get the FTC-compliant version (see §7). A ship-together order's email adds that the rest of the order ships with it.
6. **Confirmations.** The native Order confirmation and Shipping confirmation carry a preorder block. No separate emails.
7. **Safety checks.** A daily job alerts staff to misconfigured variants, overdue dates, US consent deadlines and cancellation requests.

## 2. Components

```
Storefront (theme)                Shopify                    Cloudflare Worker              Brevo
──────────────────                ───────                    ─────────────────              ─────
notify form ── POST /subscribe ──────────────────────────▶  tag customer (Admin API) ────▶ sign-up email
preorder button → /cart/add
cart delivery choice → cart attribute + "Second delivery" line                              
                                  Order created ─ Flow ───▶ POST /hooks/order  ─▶ tag, hold lines
                                  Inventory changed ─ Flow ▶ POST /hooks/inventory ─▶ release holds,
                                                                                 back-in-stock ─▶ send
                                  Order/Shipping confirmation                    daily cron ─▶ date-change,
                                  (native, preorder block)                                    staff alerts ─▶ send
customer clicks email link ────────────────────────────────▶ /u /k /c pages
```

**Why a Worker and not Flow alone** (from research): Flow's Get data actions return max 100 records with no pagination; Flow has no metafield-changed trigger; oldest-first partial release and the US consent deadlines need state and arithmetic Flow does not handle well; Shopify's customer form subscribes every sign-up to marketing and does not tag existing customers. Flow stays as the event source (visible and switchable in the admin); the Worker does the logic.

**Cost:** Cloudflare Workers Paid ($5/month) for headroom on subrequests and cron. Brevo paid plan (free tier caps at 300/day across all mail). No Shopify app fees.

## 3. Data model

### Variant metafields (namespace `falcon`, create definitions on each store)

| Key | Type | Set by | Purpose |
|---|---|---|---|
| `expected_date` | date | Staff | Expected dispatch date shown to customers |
| `preorder_limit` | number_integer | Staff | Max units sellable below zero. Blank or 0 = preorder off |
| `preorder_note` | single_line_text_field | Staff (optional) | Extra line, e.g. "From the January container" |
| `delay_reason` | single_line_text_field | Staff, when moving a date | One-sentence reason used in the date-change email |
| `notified_date` | date | **Worker only** | Date customers were last told. Differs from `expected_date` → date-change emails |
| `delay_count` | number_integer | **Worker only** | Number of delays notified for the current preorder run |

**Preorder is ON for a variant when all are true:** inventory tracked by Shopify; inventory policy = continue selling; `expected_date` set and not in the past; `preorder_limit` > 0; units sold below zero < `preorder_limit`.

Staff rule: never set "Continue selling when out of stock" without both `expected_date` and `preorder_limit`. The theme blocks purchase in that case and the daily job alerts staff, but other sales channels would still sell it.

### Tags

| Object | Tag | Meaning |
|---|---|---|
| Customer | `restock-request` | Has ever joined a waitlist |
| Customer | `restock-{variant_id}` | Waiting on this variant |
| Customer | `restock-notified-{variant_id}` | Was emailed that this variant is back |
| Customer | `restock-optout-{variant_id}` | Asked (per-product link) not to be emailed about this variant again. The fan-out skips them. Removed when they sign up for it again |
| Order | `preorder` | Contains at least one preorder line, and every hold succeeded (idempotency marker) |
| Order | `preorder-v{variant_id}` | Contains a preorder line for this variant (Flow/Admin search has no variant filter) |
| Order | `preorder-unlabelled` | Held units were sold below zero without the pre-order label: the customer was not shown a date |
| Order | `oversold-v{variant_id}` | Sold below zero without the label and the variant has no valid pre-order setup: not held, staff alerted |
| Order | `preorder-hold-failed` | A hold was refused; staff alerted once; the daily job retries |
| Order | `preorder-released-v{variant_id}` | Hold released for this variant |
| Order | `preorder-delay-v{variant_id}-{n}` | Delay notice n sent for this variant (numbered per order and variant) |
| Order | `preorder-keep-by-v{variant_id}-{YYYY-MM-DD}` | US: customer must confirm this item by this date |
| Order | `preorder-kept-v{variant_id}-{n}` | US: customer confirmed this item after its delay n |
| Order | `preorder-cancel-requested` | Customer asked to cancel at least one item via email link (admin search) |
| Order | `preorder-cancel-requested-v{variant_id}` | Customer asked to cancel this item |
| Order | `preorder-cancel-requested-v{variant_id}-on-{date}` | Worker: when that request arrived (drives the 3-day staff chase) |
| Order | `preorder-cancel-due-v{variant_id}` | US: consent deadline for this item passed; staff must cancel and refund it |
| Order | `preorder-over-cap` | Order took the variant past its cap |
| Order | `preorder-notice-v{id}-{n}-{old_date}-{new_date}` | Worker: date-change notice already sent (stops duplicates) |
| Order | `ship-together` | Mixed order, ship together (chosen, or no `Delivery preference`): in-stock lines held with the preorder |
| Order | `ship-separately` | Mixed order, customer chose ship separately: only preorder lines held |
| Order | `split-fee-missing` | Ship separately chosen but no "Second delivery" line; staff alerted once (the choice is honoured anyway) |
| Order | `split-fee-unneeded` | "Second delivery" line on an order that does not need it (ship together, or not mixed); staff alerted once to refund it |
| Order | `ship-together-released` | Worker: the ship-together holds of this order have been released |

Variant IDs are the numeric ID (e.g. `44012345678901`), never the GID.

### Order attribute (from the cart attribute)

| Attribute | Values | Set by |
|---|---|---|
| `Delivery preference` | `Ship together` \| `Ship separately` | Theme (`delivery-choice`), only on mixed baskets. Missing = ship together. The Worker matches key and value case-insensitively; a value containing "separately" means split |

**Mixed basket** (shared contract, theme and Worker): at least one preorder line and at least one other line, the "Second delivery" line not counted. The Worker also counts units it holds as unlabelled oversell as preorder lines, and ignores lines with `requiresShipping: false` or nothing left to ship. An order of only preorder lines (even for several variants) is not mixed.

### Fulfilment holds

| Handle | Notes | Holds |
|---|---|---|
| `falcon-preorder` | `Pre-order, expected {date}` | Preorder lines, one hold per variant |
| `falcon-ship-together` | `Ship together with pre-order` | The rest of a ship-together order (whole fulfillment orders) |

### "Second delivery" product (split fee, one per store)

Title `Second delivery`, handle `second-delivery`, SKU `SECOND-DELIVERY`, one variant priced at the store's standard delivery rate, not a physical product, no inventory tracking, on the Online Store channel but hidden from search and collections (`INSTALL-THEME.md` 1a). Its variant id goes in both `falcon_split_fee_variant_id` (theme) and `SHOPS[store].split_fee_variant_id` (Worker). The Worker removes fee lines before every preorder, mixed and oversell rule.

### Line item properties (added by the theme on preorder add-to-cart)

| Property | Example | Visible |
|---|---|---|
| `_preorder_date` | `2026-11-12` | Hidden (underscore). Machine-readable record of the date promised |
| `Pre-order` (UK/EU) / `Preorder` (US) | `Ships from 12 November 2026` | Shown in cart, checkout, order and notifications |

## 4. Theme (per store, vintage theme, jQuery + `Shopify.OptionSelectors`)

Files under `dev/falcon-back-in-stock/theme/`:

- `snippets/falcon-config.liquid`: the only file that differs per store. Assigns `falcon_store` (`uk|us|eu`), `falcon_worker_url`, `falcon_turnstile_sitekey`, `falcon_preorder_label` (`Pre-order` / `Preorder`), `falcon_date_format`, `falcon_split_fee_variant_id` (the store's "Second delivery" variant id; while `REPLACE_ME` the delivery choice is hidden and mixed baskets ship together).
- `snippets/falcon-variant-data.liquid`: renders `<script type="application/json" id="FalconVariantData">` with, per variant: `id, available, inventory_quantity, inventory_policy, inventory_management, state (in_stock|preorder|notify), expected_date (ISO), expected_date_label (formatted), preorder_note, max_qty`. **State is computed in Liquid** using the rule in §3. `product | json` does not carry inventory quantity, so this is the source for JS.
- `snippets/restock-notify-form.liquid`: replaces the merged version. Posts JSON via `fetch` to `{worker}/subscribe`. Cloudflare Turnstile widget. Email, optional newsletter checkbox (sets consent only if ticked; single opt-in, decided), hidden variant ID. Inline success and error messages; no page reload. No Shopify customer form.
- `snippets/preorder-message.liquid`: the "Ships from {date}. Payment taken today." block plus optional note, and the two hidden/visible line item property inputs, placed inside the add-to-cart form above the button.
- `snippets/preorder-cart-line.liquid`: renders a line's visible properties in cart and quick cart, and a basket notice when the cart contains preorder lines, worded by the delivery choice: "Everything ships together when the pre-order arrives." (together, the default), "Pre-order items ship separately when they arrive. Anything in stock ships now." (separately), "Pre-order items ship when they arrive." (only preorder lines).
- `snippets/delivery-choice.liquid`: cart page only, mixed baskets only. Two radio options (together selected by default; separately shows the fee price). Saves the cart attribute `Delivery preference`, adds or removes the single "Second delivery" line (quantity 1) with jQuery AJAX, and on every cart load reconciles the cart with the contract. Shows nothing when no fee price can be found or JavaScript is off (the order then ships together). The cart template also locks the fee line (no quantity buttons, no remove link).
- `templates/product.liquid`: full UK template with all changes; install notes list the edits for US/EU.
- JS: one block in the product template. On variant change reads `FalconVariantData`, switches between three states (Add to cart / Pre-order + message / Notify form), updates property inputs, sets quantity `max` to `max_qty` for preorders. Must work with no JS for the variant on page load (server-rendered state).
- The theme's `app.js` (not in repo) may submit the add-to-cart form by AJAX. Install must verify it serialises the whole form so properties are sent.
- Remove from `theme.liquid`: Dotdigital script; the `restockNotifySubmitted` sessionStorage modal swap (no longer used). UK: fix the broken Klarna `<scriptasyncsrc` tag.

## 5. Native notifications (Settings → Notifications, per store)

Files under `dev/falcon-back-in-stock/theme/notifications/`:

- `order-confirmation-preorder-block.liquid`: inserted into Order confirmation. For each line with `_preorder_date`: expected dispatch date (from the property, not the metafield, so it shows what was promised), that we will email when it ships, that we will tell them if the date moves, and their right to cancel for a full refund before dispatch. If the order also has in-stock lines, it reads `Delivery preference`: "Everything in this order will ship together when the pre-order arrives." (together or missing) or "In-stock items ship now. Pre-order items ship when they arrive." (separately). The "Second delivery" line is ignored.
- `shipping-confirmation-preorder-block.liquid`: inserted into Shipping confirmation. If the shipped lines include preorder lines: "Your pre-order is on its way. Thank you for waiting." If preorder lines remain unshipped, say so with their date.
- UK/EU wording and US wording in the same file, switched on `shop.currency` or a store code assigned at the top.

## 6. Cloudflare Worker `falcon-stock`

Single file `dev/falcon-back-in-stock/worker/worker.js` (ES module, no dependencies, pasteable into the Cloudflare dashboard editor). Pure logic is exported from the same file as named exports for the tests; there is one source file.

### Environment (Cloudflare → Worker → Settings → Variables and secrets)

| Name | Type | Notes |
|---|---|---|
| `SHOPS` | JSON var | `{"uk":{"domain":"falcon-uk.myshopify.com","storefront":"https://www.falconenamelware.com","origins":["https://www.falconenamelware.com","https://falcon-uk.myshopify.com"],"sender":{"name":"Falcon Enamelware","email":"hello@falconenamelware.com"},"templates":{"bis":1,"waitlist_joined":6,"delay_uk":2,"delay_us_notice":3,"delay_us_consent":4,"staff":5},"staff_email":"...","withdrawal_url":null,"split_fee_variant_id":"44012345678901"}, "us":{...}, "eu":{...,"withdrawal_url":"https://eu.falconenamelware.com/pages/withdrawal"}}` |
| `ADMIN_TOKEN_UK`, `ADMIN_TOKEN_US`, `ADMIN_TOKEN_EU` | secret | Admin API access token per store (custom app) |
| `BREVO_API_KEY` | secret | |
| `TURNSTILE_SECRET` | secret | |
| `FLOW_KEY` | secret | Shared secret Flow sends in `X-Falcon-Key` |
| `LINK_SECRET` | secret | HMAC key for email links |
| `API_VERSION` | var | `2026-07` |
| `WORKER_URL` | var | Public Worker URL, used to build email links from the cron run |
| `DRY_RUN` | var | `"true"` sends all customer mail to staff_email instead; used during install |

Cron trigger: `0 7 * * *` (daily 07:00 UTC).

Admin API scopes per store: `read_products, write_products, read_inventory, read_customers, write_customers, read_orders, read_all_orders, write_orders, read_merchant_managed_fulfillment_orders, write_merchant_managed_fulfillment_orders` (+ `read/write_third_party_fulfillment_orders` if a 3PL fulfils).

### Endpoints

| Method + path | Caller | Behaviour |
|---|---|---|
| `POST /subscribe` | Theme | Body `{store, variant_id, email, marketing, turnstile_token}`. CORS allow only that store's `origins` (storefront, myshopify domain, any preview origin; falls back to `storefront`). Verify Turnstile; validate email; confirm variant exists on that store. Find customer by email; create if missing. `tagsAdd ["restock-request","restock-{id}"]`. A sign-up for a variant the customer had opted out of removes `restock-optout-{id}`. If `marketing` true and not already subscribed, set email marketing consent SUBSCRIBED (SINGLE_OPT_IN). Never change consent otherwise. If the customer did not already have `restock-{id}` (a new sign-up), send `waitlist_joined` after the response (`waitUntil`); a failure never fails the sign-up. Respond `{ok:true}` or `{ok:false,error:"invalid_email"|"bot"|"unknown_variant"|"server"}`. |
| `POST /hooks/order` | Flow (Order created, **every order**, no condition) | Header `X-Falcon-Key`. Body `{store, order_id}`. Idempotent (skip if already tagged `preorder`). Early exit (one order query) when no line has `_preorder_date` and no line's variant is at or below zero. Pre-order lines = lines with `_preorder_date`, plus **unlabelled oversell**: lines without it whose tracked variant is now below zero; the units this order took below zero are held if the variant has a valid pre-order setup (tags `preorder-unlabelled`; staff told the customer saw no date), otherwise tagged `oversold-v{id}` + staff alert, not held. Tag order `preorder-v{id}`. Hold by **line item**: only fulfillment order line items whose `lineItem.id` is a pre-order line, one `fulfillmentOrderHold` per variant, reason OTHER, handle `falcon-preorder`, notes `Pre-order, expected {date}`. Hold refused → tag `preorder-hold-failed`, one staff alert, non-2xx (daily job retries). Cap: if variant `inventoryQuantity <= -preorder_limit`, set variant inventory policy DENY (`productVariantsBulkUpdate`); if it went below the cap, tag `preorder-over-cap` and alert staff. **Delivery choice:** fee lines (`split_fee_variant_id`) are removed first. A mixed order is tagged `ship-together` or `ship-separately` from `Delivery preference` (missing = together). Together: once every preorder hold is on, every other OPEN fulfillment order with unfulfilled lines is held whole, handle `falcon-ship-together` (a refusal counts as a hold failure). Separately without a fee line: `split-fee-missing` + alert. A fee line on a ship-together or non-mixed order: `split-fee-unneeded` + alert to refund. `preorder` last. |
| `POST /hooks/inventory` | Flow (Variant inventory quantity changed) | Header `X-Falcon-Key`. Body `{store, variant_id, inventory_quantity, inventory_quantity_prior}`. Responds 202 at once after auth/validation; the work runs in `waitUntil` within a 25 s total budget (daily job completes the rest). Overlapping runs re-read fulfillment orders / customers before each mutation, so nothing is released or emailed twice. (a) **Release:** held preorder lines for the variant exist → `stock_for_preorders = inventory_quantity + held_units`; release holds oldest order first while cumulative units ≤ `stock_for_preorders`; tag `preorder-released-v{id}`. On a `ship-together` order, once no `falcon-preorder` hold with unfulfilled lines is left, release its `falcon-ship-together` holds in the same run and tag `ship-together-released`. (b) **Back in stock:** `inventory_quantity > 0` → waitlist fan-out (below). |
| `GET /u?t=` | Waitlist email links | Confirmation page with a button. Token without `v`: `POST /u` removes every `restock-{id}` tag from the customer (all waitlists). Token with `v` (one product): `POST /u` adds `restock-optout-{v}` and removes `restock-{v}`; other waitlists untouched. |
| `GET /k?t=` | US consent email | Page with "Keep my order" button; `POST /k` tags `preorder-kept-v{id}-{n}`. |
| `GET /c?t=` | Delay emails | Per variant (token carries `v`). Page with "Cancel this pre-order" button; `POST /c` tags `preorder-cancel-requested`, `preorder-cancel-requested-v{id}` and `preorder-cancel-requested-v{id}-on-{date}` and alerts staff naming the item, its unfulfilled quantity and the refund deadline (UK/EU: 14 days; US: 7 working days). If that variant's line is already fulfilled: "already dispatched, use returns" page, nothing tagged. |
| `scheduled` | Cron daily | Jobs below. |
| `POST /hooks/daily` | Manual (staff) | Same as cron, header `X-Falcon-Key`. For "I just changed a date, send now". |

GET never changes state: email scanners prefetch links. Every change is a POST from the confirmation page. Link token: `base64url(payload).base64url(HMAC-SHA256(LINK_SECRET, payload))`, payload `{s:store, a:action, c:customer_id?, o:order_id?, v:variant_id (required for k and c), n:delay_no (per variant)?, d:1 (DRY_RUN only; POST then changes nothing)?, exp}`; expiry 120 days.

### Waitlist fan-out

Page through `customers(query:"tag:'restock-{id}'")` (verify exact match: skip customers whose tags do not include the exact string). Skip (and untag `restock-{id}`, not in DRY_RUN) anyone tagged `restock-optout-{id}`. For each other customer: send Brevo `bis` template (with a per-product opt-out link and an all-waitlists link), then `tagsRemove restock-{id}`, `tagsAdd restock-notified-{id}`. Idempotency key per (store, variant, customer, date). Max 400 customers per invocation; the daily job continues the rest. `DRY_RUN` redirects to staff.

### Daily job, per store

0. **Hold retry.** Open orders tagged `preorder-hold-failed` → run the order hook again; still failing → digest row.
1. **Date changes.** For every variant with `expected_date` (page through products): if `notified_date` is empty (first setup) → open pre-orders whose own `_preorder_date` differs from `expected_date` get the date-change email (old date = their checkout date), then set `notified_date` (no email when nobody differs). If they differ → find open orders `tag:preorder-v{id}` (unfulfilled or partial) whose line for that variant is still unfulfilled and not released; send the right delay email per §7; tag `preorder-delay-v{id}-{n}` (n counted per order and variant); then set `notified_date = expected_date`, `delay_count += 1` (only for a later date; an earlier date sends the UK/EU-style update without consent logic and does not increment). Clear `delay_reason` after sending.
2. **US consent deadlines.** Per (order, variant): `preorder-keep-by-v{id}-{date}` passed and no matching `preorder-kept-v{id}-{n}` → tag `preorder-cancel-due-v{id}` (that item only), staff alert naming the item.
3. **Waitlist leftovers.** Customers tagged `restock-request` with a `restock-{id}` tag whose variant now has `inventoryQuantity > 0` → fan-out.
4. **Release re-check.** Variants with held preorder lines → run release logic (covers missed Flow runs). Then every open `ship-together` order not yet `ship-together-released` with nothing left to wait for (no `falcon-preorder` hold with unfulfilled lines) → release its `falcon-ship-together` holds, digest row "Ship-together order released".
5. **Config alerts.** Variants with policy CONTINUE and missing `expected_date` or `preorder_limit`; `expected_date` in the past with held lines; `preorder-cancel-requested-v{id}` older than 3 days while that line is still unfulfilled. One digest email to staff.

## 7. Email rules (Brevo templates)

Files: `dev/falcon-back-in-stock/emails/*.html` (Brevo template HTML, `{{ params.x }}` syntax) + `docs/falcon-back-in-stock/EMAILS.md` listing params.

| Template | Params |
|---|---|
| `bis` | `store, product_title, variant_title, product_url, image_url, price, remove_url, optout_url` |
| `waitlist_joined` | `store, product_title, variant_title, product_url, image_url, optout_url, remove_all_url`. Sent once per new sign-up for a variant |
| `delay_uk` (UK and EU) | `order_name, order_status_url, product_title, variant_title, old_date, new_date, reason, cancel_url, withdrawal_url, earlier, ship_together` |
| `delay_us_notice` | as above minus withdrawal, US spelling. First delay, definite new date ≤ 30 days after old date: silence = consent sentence |
| `delay_us_consent` | + `keep_url, keep_by_date`. Second or later delay, or > 30 days, or no definite date: customer must click to keep, otherwise cancelled and refunded |
| `staff` | `subject, intro, rows_html` |

Copy rules:
- Back in stock: one product, neutral, no cross-sell, no discount, no newsletter plug; "You asked us to tell you when this was back"; per-product opt-out and all-waitlists links; "Stock is not reserved. This went to everyone waiting for this item."
- Waitlist joined: one product, no price, no buy button, no marketing; per-product opt-out and all-waitlists links.
- Opt-out links go only in the two waitlist emails. Preorder and delay emails are legal notices about an order and carry no opt-out.
- Delay emails: `ship_together` true (order tagged `ship-together`, not yet released) adds "The rest of your order is being held so it all ships together in one delivery."
- UK/EU delay: cancellation is the customer's legal right, full refund including delivery within 14 days; not a goodwill gesture. EU adds the withdrawal link.
- US: FTC Mail Order Rule. Definite new date. Cancel-for-refund offered as an equal option. Refund within 7 working days. The rule itself is law; only the keep-by date choice (the currently promised date, or 7 days after the notice if sooner) needs a quick yes or no from US counsel.
- Brevo: do not enable syncing marketing unsubscribes to transactional. One sender per store.
- No em dashes in customer copy.

## 8. Flows (per store, built by hand in the Flow editor)

| Flow | Trigger | Condition | Action |
|---|---|---|---|
| `Falcon – preorder order` | Order created | **none: every order** (the Worker detects unlabelled oversells and exits early for normal orders) | Send HTTP request POST `{worker}/hooks/order`, header `X-Falcon-Key: {{secrets.falcon_worker_key}}`, body `{"store":"uk","order_id":"{{order.id}}"}` |
| `Falcon – inventory changed` | Product variant inventory quantity changed | `inventoryQuantity > inventoryQuantityPrior` | Send HTTP request POST `{worker}/hooks/inventory`, body with store, variant id, quantities |

## 9. Existing data and Purple Dot

- **Existing waitlist (decided by Daniel):** existing waitlist customers are kept as they are. They stay on the waitlist (the Worker reads the same `restock-{id}` tags, so they carry over automatically) and their marketing consent is not changed. The list is exported once as a record (`INSTALL.md` Phase 0.3); there is no remediation step.
- **Purple Dot:** export its active preorders and waitlist; for each Purple Dot preorder product, set the metafields and policy; keep Purple Dot until its own open orders have shipped or been migrated; then disable the app embed and uninstall.

## 10. Open items to verify during install (from research)

Flow action names and fields in the live editor; whether `tag:'restock-123'` matches exactly; `fulfillmentOrderHold` with line items on this API version; whether the 3PL or stock sync fires the inventory trigger and handles split/held fulfillment orders; custom app creation route (admin "Develop apps" or Dev Dashboard); notification Liquid access to `line.properties` / `line.line_item.properties`; `Order.customAttributes` (the `Delivery preference` attribute) and `LineItem.requiresShipping` on API 2026-07; whether the 3PL leaves `falcon-ship-together` holds alone; Brevo idempotency header name; whether Feedoptimise can map `availability=preorder` and `availability_date` from `falcon.expected_date`.
