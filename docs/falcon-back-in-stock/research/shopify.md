# Falcon Enamelware: Shopify platform research (back-in-stock and preorder, no app)

Date: 2026-09-23. Research only.

**Method caveat:** the network egress proxy blocked direct fetches of help.shopify.com, shopify.dev, community.shopify.com, community.shopify.dev and changelog.shopify.com. Every finding below comes from WebSearch result snippets of those pages, which are summarised by a search model and are not verbatim quotes. Anything marked CONFIRMED means the snippet from an official Shopify page states it. Check anything load-bearing on the live page before building.

Legend: **CONFIRMED** = Shopify docs say so. **LIKELY** = indirect evidence (community posts, third-party sources, inference). **UNKNOWN** = no good evidence; verify in the live admin.

---

## 1. Flow triggers: inventory and metafields

- **CONFIRMED.** The trigger is now called **"Product variant inventory quantity changed"**. It was previously called "Inventory quantity changed". It fires on a variant inventory change from an order, a manual edit or an app. https://help.shopify.com/en/manual/shopify-flow/reference/triggers/product-variant-inventory-quantity-changed
- **CONFIRMED.** The trigger exposes the `productVariant` object (id, `inventoryQuantity`, product and so on) and **`inventoryQuantityPrior`**, the previous quantity. The docs pattern is `inventoryQuantity >= X AND inventoryQuantityPrior < X`, so the workflow runs only the first time a threshold is crossed. Sources: same page, and the community thread https://community.shopify.dev/t/shopify-flow-not-triggering-product-variant-inventory-quantity-changed-when-inventory-updates-come-from-accumula-mortar-lightspeed-sync/25747
- **LIKELY.** The quantity is the variant total across all locations. For per-location stock, read `productVariant.inventoryItem.inventoryLevels`. https://community.shopify.com/t/creating-a-shopify-flow-trigger-based-off-of-a-specific-locations-inventory/284273/2
- **LIKELY (gotcha).** Some third-party inventory syncs (Accumula/Mortar/Lightspeed) have been reported not to fire this trigger. Test with Falcon's own stock-update route (manual, CSV or ERP). https://community.shopify.dev/t/shopify-flow-not-triggering-product-variant-inventory-quantity-changed-when-inventory-updates-come-from-accumula-mortar-lightspeed-sync/25747
- **CONFIRMED.** There are simpler triggers too:
  - **"Product variant back in stock"** fires when stock goes from ≤0 to ≥1.
  - **"Product variant out of stock"** fires when stock goes from ≥1 to ≤0.
  - Shopify recommends the inventory-quantity-changed trigger when location or thresholds matter.

  Sources: https://help.shopify.com/en/manual/shopify-flow/reference/triggers/variant-back-in-stock and https://changelog.shopify.com/posts/shopify-flow-new-triggers-for-product-variant-back-in-stock-and-out-of-stock
  - **Gotcha (inference):** preorder variants use "continue selling", so stock goes negative. For example, at −40, receiving 30 units gives −10 and "back in stock" does **not** fire. Back-in-stock alerts should fire on `inventoryQuantity > 0` after a change, not on the receipt event.
- **Metafield-change trigger:**
  - **LIKELY no native Flow trigger** for "metafield value changed". Community feature requests remain open, and the third-party app "Flow Trigger Extensions" sells this trigger. https://community.shopify.dev/t/feature-request-metafield-value-changed-trigger-in-shopify-flow/36334 and https://apps.shopify.com/flow-trigger-extensions
  - **CONFIRMED** that on 2026-07-21 Shopify added metafield-change subscriptions to the app **Events** API: Product (which covers variant metafields), Order, Customer, Collection and Location. That is for apps, not Flow. https://shopify.dev/changelog/metafield-triggers-and-additional-topics-are-now-available-for-events
  - **UNKNOWN** whether Flow has since picked up a matching trigger. Check the trigger picker in Flow.
- **No native "Product updated" or "Product variant updated" trigger in Flow.** **LIKELY**: the MESA trigger list and Flow Trigger Extensions both say it needs an app. https://www.getmesa.com/blog/shopify-flow-triggers
- **Manual run from the admin:**
  - **CONFIRMED.** On a product, More actions → **"Run Flow automation"** works only for workflows that use the **Product created** trigger. Orders need Order created, Order paid or Order deleted. Customers need Customer created, deleted, enabled or disabled. Draft orders are also supported. The maximum is 50 resources per bulk run. https://help.shopify.com/en/manual/shopify-flow/manage/manual
  - **LIKELY** there is **no variant-level manual trigger**. A Product created workflow gets the product, so it has to loop over `product.variants` and compare each variant's `falcon.expected_date` with a stored "last notified" metafield.
- **Recommended approach for date changes: "diff metafield" pattern (inference).**
  - Store `falcon.expected_date` and a shadow `falcon.expected_date_notified` on each variant.
  - Either (a) the merchant clicks "Run Flow automation" on the product after editing the date, or (b) a daily **Scheduled time** trigger + **Get product variant data** with a query for preorder variants runs automatically.
  - For each variant where the two dates differ: email the affected customers, then update the shadow with the **"Update product variant metafield"** action. https://help.shopify.com/en/manual/shopify-flow/reference/actions/update-product-variant-metafield
  - Option (a) is instant. Option (b) is a safety net. Use both.

## 2. Get customer data

- **CONFIRMED.** Every Get data action returns **0–100 items**. There is no pagination and no cursor. Shopify's advice is to run the workflow more often, or to filter with a query so each run needs ≤100. https://help.shopify.com/en/manual/shopify-flow/reference/actions/get-customer-data and https://help.shopify.com/en/manual/shopify-flow/create/optimize
- **CONFIRMED.** Results can be looped with **"For each loop (iterate)"**. The list limit is 1,000 items, far above the 100 cap. https://help.shopify.com/en/manual/shopify-flow/reference/actions/for-each
- **LIKELY.** The query uses Admin API customer search syntax, so `tag:restock-1234567890` works, and so do combinations like `tag:restock-request AND tag:restock-123`. https://help.shopify.com/en/manual/shopify-flow/reference/actions/get-customer-data
  - **UNKNOWN:** exact-match versus tokenised matching on hyphenated tags. Test that `tag:restock-123` does not also match `restock-1234`, and that the hyphen is handled. Quoting may help: `tag:'restock-123'`.
- **Getting past 100 (inference):**
  - After emailing each customer, **remove the `restock-{variant_id}` tag**, or swap it for `restocked-{id}`.
  - Re-run the workflow, either scheduled hourly or triggered by an "is there more?" check, until the query returns 0.
  - Removing the tag also stops duplicate emails.

## 3. Get order data

- **CONFIRMED.** The cap is the same 100 results. It works with Scheduled time and For each. https://help.shopify.com/en/manual/shopify-flow/reference/actions/get-order-data and https://help.shopify.com/en/manual/shopify-flow/getting-started/concepts/advanced-workflows
- **LIKELY.** The query uses Admin `orders` search syntax. It supports `tag:`, `fulfillment_status:unfulfilled` (and `partial`), `sku:` and `status:open`. **It has no `variant_id` filter.** https://shopify.dev/docs/api/admin-graphql/latest/queries/orders
  - Recommended query: `tag:preorder AND fulfillment_status:unfulfilled AND sku:FALC-XXX`, or tag orders per variant, for example `preorder-{variant_id}`, when they are created.
  - **Gotcha:** use `fulfillment_status:partial` as well, because orders with in-stock lines already shipped become partially fulfilled.
  - Inside the loop, confirm the specific line item is still unfulfilled and not refunded (`lineItems.unfulfilledQuantity > 0`).
- **LIKELY.** The Flow template text mentions "orders from the past 60 days" as an example query, not a hard limit.
- **UNKNOWN** whether Flow can read orders older than 60 days. Flow normally has read_all_orders access. Verify with a preorder more than 60 days old.
- **Alternative:** **"Get fulfillment order data"** can query on-hold fulfillment orders directly. https://help.shopify.com/en/manual/shopify-flow/reference/actions/get-fulfillment-order-data

## 4. Send HTTP request

- **CONFIRMED.** Available only on the **Grow ("Shopify"), Advanced and Plus** plans. **Not on Basic.** Flow itself runs on Basic. https://help.shopify.com/en/manual/shopify-flow/reference/actions/send-http-request
  - **UNKNOWN: which plan each of the three Falcon stores is on.** If any is on Basic, the Brevo call is impossible from Flow and needs a relay or different mechanism.
- **CONFIRMED.** **Flow secrets:** created under Flow → Settings, referenced as `{{secrets.handle}}` in the URL, headers or body, redacted from run logs. This is where the Brevo `api-key` goes. https://help.shopify.com/en/manual/shopify-flow/reference/actions/send-http-request and https://shopify.dev/changelog/flow-improved-send-http-request-action-enables-secure-connections-and-returns-data-to-the-workflow
- **CONFIRMED.** The response (status and body) comes back to the workflow and can be parsed with **Run code**. Same changelog.
- **CONFIRMED.** Flow waits 30 seconds for a response, then closes the connection and **retries later**. https://help.shopify.com/en/manual/shopify-flow/reference/actions/send-http-request
  - **UNKNOWN:** the exact retry policy for 429 and 5xx (count and backoff). Also unknown whether a retry can double-send. Put an idempotency key in the Brevo payload (`headers` or `tags`) and keep Brevo calls fast.
- **LIKELY.** There is no documented per-action Flow rate limit. Throughput is bounded by plan-based API limits. https://help.shopify.com/en/manual/shopify-flow/create/troubleshoot
  - The Brevo transactional API has its own rate limits. Check the Brevo plan.

## 5. Send Admin API request and fulfilment holds

- **CONFIRMED.** "Send Admin API request" runs **mutations only**, not queries. It excludes:
  - deprecated mutations
  - some app-specific mutations (**subscription**, marketing activity and discount)
  - async or Job-returning mutations
  - mutations that don't implement Node

  https://help.shopify.com/en/manual/shopify-flow/reference/actions/send-admin-api-request
- **UNKNOWN:** whether "Send Admin API request" is available on Basic. It is not documented as plan-gated.
- **CONFIRMED.** There are native Flow actions:
  - **"Hold fulfillment order"**: places a hold on **every** fulfillment order of the order, or only the one fulfillment order when the trigger supplies one, such as **"Fulfillment order ready to fulfill"**. https://help.shopify.com/en/manual/shopify-flow/reference/actions/hold-fulfillment
  - **"Release fulfillment order holds"**: releases **all** holds on a fulfillment order. It needs a fulfillment order ID in context. https://help.shopify.com/en/manual/shopify-flow/reference/actions/release-fulfillment-hold
  - Related triggers are "Fulfillment order placed on hold", "Fulfillment order holds released" and "Fulfillment order split".
- **CONFIRMED.** Holds apply **per fulfillment order**, and a fulfillment order can carry up to 10 holds per app.
  - `fulfillmentOrderHold` accepts **`fulfillmentOrderLineItems`**. Only those lines are held. **Shopify moves the non-held lines to a new `remainingFulfillmentOrder`**, so an explicit `fulfillmentOrderSplit` first is unnecessary.
  - Since API 2025-01 a `handle` is needed for multiple holds.

  Sources: https://shopify.dev/docs/api/admin-graphql/latest/mutations/fulfillmentOrderHold and https://shopify.dev/changelog/apply-multiple-holds-to-a-single-fulfillment-order
- **CONFIRMED.** `fulfillmentOrderSplit` exists and moves given line items and quantities into a new fulfillment order. https://shopify.dev/docs/api/admin-graphql/latest/mutations/fulfillmentOrderSplit
- **LIKELY** that both `fulfillmentOrderHold` (with line items) and `fulfillmentOrderReleaseHold` are allowed in Send Admin API request. They are synchronous, return a FulfillmentOrder (a Node) and are not subscription or discount mutations.
  - **UNKNOWN** until tested in the Flow action's mutation picker.
- **Recommended Flow ("Preorder hold"):**
  1. Trigger **Order created**, or **Fulfillment order ready to fulfill**, which gives the single fulfillment order.
  2. Add a condition: any line item has a `customAttributes` key `_preorder_date`.
  3. Run **Add order tags** `preorder`.
  4. Send Admin API request `fulfillmentOrderHold`:
     - `id` = the fulfillment order
     - `fulfillmentHold.reason: OTHER`
     - `reasonNotes: "Preorder – expected {{date}}"`
     - `handle: "falcon-preorder"`
     - `fulfillmentOrderLineItems` = only the preorder lines. Build that list with Run code: map line item → fulfillment order line item ID.
  5. The in-stock lines land in an open fulfillment order and ship now.
- **Gotchas:**
  - **Merchant must verify:** the native "Hold fulfillment order" action is all-lines, so it cannot hold only preorder lines.
  - Check whether Falcon's 3PL or shipping app handles split and held fulfillment orders correctly.
  - Customers get charged shipping once. **UNKNOWN:** whether split shipping changes their shipping-rate expectations.

## 6. Native preorder via selling plans vs "continue selling + Flow hold"

- **CONFIRMED.** Selling plans support `category: PRE_ORDER` with deferred fulfilment. The billing policy can be full upfront; `ON_FULFILLMENT` remaining-balance charging was added in 2026-01. Delivery policy uses `fulfillmentTrigger` (`ASAP`/`EXACT_TIME`/`UNKNOWN`/`ANCHOR`). https://shopify.dev/docs/apps/build/purchase-options/deferred and https://shopify.dev/changelog/due-on-fulfillment-payment-term-available-for-pre-orders
- **CONFIRMED.** Merchant setup of pre-orders in the admin assumes **"the pre-order app that you installed … from the Shopify App Store"**. There is no native merchant UI to create a preorder selling plan. https://help.shopify.com/en/manual/products/purchase-options/pre-orders/setup
- **CONFIRMED.** `sellingPlanGroupCreate` needs `write_products` plus `write_purchase_options` or `write_own_subscription_contracts`, which are **protected scopes**.
  - "Custom apps created in the Shopify admin can't use subscriptions, pre-order or TBYB". It needs a Partner-Dashboard app with approved access.

  Sources: https://shopify.dev/docs/api/admin-graphql/latest/mutations/sellingplangroupcreate and https://shopify.dev/docs/apps/build/purchase-options/deferred/build-deferment-solution
- **LIKELY NOT possible via Flow.**
  - "Send Admin API request" excludes subscription-type mutations.
  - The GraphiQL app has returned "access denied" for `sellingPlanGroupCreate`. https://community.shopify.com/t/sellingplangroupcreate-access-denied/43504
  - Even if it worked, the selling plan is owned by the creating app and is **deleted 48 hours after that app is uninstalled**. https://shopify.dev/docs/api/admin-graphql/latest/objects/SellingPlanGroup
- **LIKELY.** Selling plans give native **Scheduled** or **On hold** fulfillment orders for only the preorder lines, so in-stock lines ship now and the preorder lines release themselves on a date. https://www.stoqapp.com/blog/should-preorders-be-held-or-scheduled
  - **UNKNOWN:** the exact mapping from `fulfillmentTrigger` to fulfillment order status. The expectation is `EXACT_TIME`→SCHEDULED and `UNKNOWN`→ON_HOLD.
- **CONFIRMED.** A vintage theme passes a plan with an input named `selling_plan` (value = plan ID) in the `/cart/add` form or `/cart/add.js` payload. The theme needs its own plan selector and JavaScript to sync it with the variant selector. https://shopify.dev/docs/storefronts/themes/pricing-payments/preorder-tbyb/add-preorder-tbyb-to-your-theme and https://shopify.dev/docs/themes/pricing-payments/purchase-options/support-purchase-options
- **CONFIRMED.** Shopify has no first-party free pre-order app. Every store-listed option is a third-party app. https://apps.shopify.com/categories/marketing-and-conversion-upsell-and-bundles-pre-orders

**Recommendation: "continue selling + line-item property + Flow partial hold".** Reasons:

1. Selling plans cannot be created without an app. Admin custom apps are barred, Flow's API action excludes subscription-type mutations, and the plans are app-owned. The brief says no preorder app, so selling plans need a Partner custom app anyway.
2. `fulfillmentOrderHold` with `fulfillmentOrderLineItems` already gives the key behaviour: only preorder lines held, in-stock lines shipping now. Payment is full at checkout either way, so deferred billing is not needed.
3. Everything stays in Shopify primitives Falcon controls (variant metafields, the `_preorder_date` property, tags and Flow) on all three stores, without app-uninstall data loss.

Costs:
- Holds must be released by a Flow action rather than auto-releasing on a date. A Scheduled Flow can emulate this.
- Checkout and admin show no native "pre-order" labelling.
- `preorder_limit` must be enforced in theme or Flow. Checkout does not enforce it.

Revisit selling plans only if Falcon later wants deposits or charge-later.

## 7. Customer form (`form 'customer'`, `contact[tags]`)

- **CONFIRMED.** `{% form 'customer' %}` is the **newsletter sign-up form**. It creates a customer and **sets email marketing consent to subscribed** (`accepts_marketing = true`). https://shopify.dev/docs/storefronts/themes/customer-engagement/email-consent
  - **This conflicts with the brief.** Using it for back-in-stock will opt every requester into marketing, including people who did not consent. That is a GDPR/PECR issue for the UK and EU stores.
- **LIKELY: tags are NOT reliably added for existing customers.** Several community threads report that the customer form only tags **new** customers. For an already-registered or already-subscribed email, nothing happens: no success, no error, no tag.
  - https://community.shopify.com/t/shopify-form-only-adds-tag-to-new-customers/329172
  - https://community.shopify.com/c/technical-q-a/update-existing-customer-tags-with-newsletter-form/m-p/1714069
  - https://community.shopify.com/t/customer-form-not-working-for-already-subscribed-customers/167265
  - https://community.shopify.com/c/online-store-and-theme/no-error-message-when-user-subscribes-a-newsletter-with-an/m-p/1381611
- **UNKNOWN (test in each live store)** for an existing customer:
  - whether new tags are appended
  - whether existing tags are overwritten
  - whether consent flips to subscribed
  - whether a hidden `contact[accepts_marketing]=false` is honoured
- **Alternatives:**
  - The Shopify Forms app. **LIKELY:** it can update existing customers and tag them, with optional marketing consent. https://community.shopify.com/c/technical-q-a/update-existing-customer-tags-with-newsletter-form/m-p/1714069
  - Capture straight into Brevo with a Brevo form or contact attribute `restock_variant_ids`, with no Shopify marketing consent involved. Brevo then sends the transactional alert on a Flow HTTP call.

## 8. Liquid on the product page (vintage theme)

- **CONFIRMED.** `variant.inventory_quantity`, `variant.inventory_policy` (`deny`/`continue`), `variant.inventory_management` (`shopify` or nil) and `variant.metafields.falcon.expected_date` are all available on the Liquid `variant` object in any theme. Vintage themes are included. https://shopify.dev/docs/api/liquid/objects/variant
- Use `.value` for typed metafields, for example `variant.metafields.falcon.expected_date.value | date: '%-d %B %Y'`. **LIKELY.** https://shopify.dev/docs/api/liquid/objects/metafield
- **LIKELY: `{{ product | json }}` does NOT include `inventory_quantity`**. It was removed from the product JSON serialisation years ago. https://community.shopify.com/t/variant-inventory-quantity-always-returning-0/23709/3
  - Fix: render a per-variant map yourself, for example a `<script type="application/json">` holding `{ id: {qty, policy, mgmt, date, limit} }` built in a Liquid loop. `Shopify.OptionSelectors`' `onVariantSelected` callback then reads it.

## 9. Notification templates

- **CONFIRMED/LIKELY.** Order confirmation: `{% for line in subtotal_line_items %}` … `line.properties` includes underscore-prefixed keys. The default template just skips them with a `first_char != '_'` check, so `line.properties['_preorder_date']` is readable. https://help.shopify.com/en/manual/fulfillment/setup/notifications/email-variables and https://www.printitmyway.com/blog/shopify-hidden-line-item-properties-underscore
- **LIKELY.** Shipping confirmation loops `fulfillment.fulfillment_line_items`. Use `line.line_item.properties['_preorder_date']` and `line.line_item.variant.metafields…`. Other templates use `line.properties`. https://community.shopify.com/t/why-doesnt-shipping-confirmation-email-display-line-item-properties/314764
- **LIKELY.** `line.variant.metafields.falcon.expected_date` works in notifications. Rich types (file, JSON and so on) do not, but date and integer are fine. https://community.shopify.com/c/shopify-design/can-you-display-product-variant-metafields-in-order-confirmation/td-p/2326035
  - **UNKNOWN**: whether `.value` is needed in the notification context. Test with Preview.
- **Gotchas:**
  - Variant metafields show the **current** date, not the date at purchase. Use `_preorder_date` for "what we promised" and the metafield for "current estimate".
  - The object is `line_item` inside `fulfillment_line_items`.
  - Deleted variants give nil.
  - Each store (UK, US, EU) has separate templates, so the edits happen three times.

## 10. Order cancellation

- **CONFIRMED (2026-06-18 changelog).** "Self-serve returns now support cancellations":
  - Buyers can **request** cancellation of **unshipped items** from the order status page in **new customer accounts**.
  - Merchants set rules per market, then approve or decline each request.
  - Approval goes through the standard refund/removal flow.

  Sources: https://changelog.shopify.com/posts/self-serve-returns-now-support-cancellations and https://help.shopify.com/en/manual/fulfillment/managing-orders/returns/self-serve-returns
- **UNKNOWN:** whether it is available on all three stores or EU-only. A community thread titled "Where's the self-serve order cancellation (EU only)?" suggests rollout differences. https://community.shopify.com/t/wheres-the-self-serve-order-cancellation-eu-only/638959
  - It also needs new customer accounts and self-serve returns turned on.
- **Context.** EU Directive 2023/2673, in force since 2026-06-19, requires an easy electronic withdrawal route for EU consumers. https://www.getmacha.com/blog/self-serve-cancellations-for-shopify-orders
- **Simplest compliant route:**
  - Put a "Cancel my preorder" link in the Brevo date-change email.
  - Best target is the native self-serve cancel request on the order status page, where enabled. Fallback is a mailto link or a Shopify Forms/contact form, with the merchant cancelling or refunding the line in the admin.
  - Flow can't cancel from a customer click without an HTTP endpoint.

## 11. Order tags, notes and line-item property detection

- **CONFIRMED.** The actions are **"Add order tags"** and **"Update order note"**. There is no "Add order note" action; Update order note replaces or edits the note. https://help.shopify.com/en/manual/shopify-flow/reference/actions/add-order-tags and https://help.shopify.com/en/manual/shopify-flow/reference/actions/update-order-note
- **CONFIRMED/LIKELY.** Line-item properties appear in Flow as `order.lineItems[].customAttributes` (key/value). There are two ways to check them:
  - A condition on `lineItems / customAttributes / key == "_preorder_date"`, which evaluates "any of" over lists.
  - A **For each** over `order.lineItems`.

  https://community.shopify.com/t/can-we-access-line-item-properties-with-flow-on-new-orders/25380/28 and https://store-dojo.com/en-us/products/2022-12-26
- **Run code** is the cleanest way to build the list of preorder fulfillment-order line-item IDs for `fulfillmentOrderHold`.

---

## Verify in the live admin (UNKNOWN list)

1. The Shopify plan of each store. Send HTTP request needs Grow, Advanced or Plus.
2. Whether Send Admin API request accepts `fulfillmentOrderHold` (with `fulfillmentOrderLineItems`) and `fulfillmentOrderReleaseHold`. Also whether it is available on each store's plan.
3. Whether Flow now has a metafield-changed trigger, given the 2026-07 Events change.
4. Customer form with an existing email: are tags appended, and does consent change? Also whether `contact[accepts_marketing]=false` is honoured.
5. Tag search exactness for `tag:restock-{id}` in Get customer data.
6. Whether Get order data reaches orders more than 60 days old.
7. Send HTTP request retry behaviour on 429/5xx, and duplicate-send risk.
8. Notification Liquid for `line.line_item.properties` in Shipping confirmation, and variant metafield `.value`.
9. Self-serve cancellation availability on the UK and US stores (not just the EU store) with new customer accounts.
10. Whether the 3PL, shipping app or ERP handles held or split fulfillment orders, and whether stock updates fire the inventory Flow trigger.
