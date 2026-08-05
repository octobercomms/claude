# Shopify data enrichment — platform-side plan

How much of a connected Shopify store's data OMI actually *uses*, and the
staged plan for widening it. This is the platform-side companion to the app
docs in this folder: the app (Surface 2) streams the signals; this note is
about what the platform does with them on the Data page and in reports.

Applies to **both** Shopify connectors, which return an identical summary
shape so everything downstream treats them the same:

- `dev/platform/backend/src/connectors/shopify.js` — pull-based custom-OAuth
  connector (fetches orders from the Admin REST API on read).
- `dev/platform/backend/src/connectors/shopifyApp.js` — push-based app
  connector (aggregates HMAC-verified webhook events from
  `shopify_app_events`).

**Advisory-first.** Every tier below is read-only. OMI reads store data and
turns it into insight; it never writes back to Shopify. Write-back (tagging
customers, drafting products, editing inventory) is a deferred, explicit
opt-in — see *Deferred* at the end — and would require new scopes and a
separate consent step, never a silent scope bump.

## Tier 0 — surface what we already fetch (shipped)

The order fetch already pulled several fields that were dropped on the floor
before reaching the client. Tier 0 adds **no new API scopes and no new
requests** — it just aggregates fields already on each order and passes them
through to the Data page.

Added to the connector `summary`:

| Field | Meaning | Source (already fetched) |
|-------|---------|--------------------------|
| `total_discounts` | promo/discount value given away in period | `order.total_discounts` |
| `discounted_orders` | count of orders with any discount | `order.total_discounts > 0` |
| `new_customer_orders` | orders from first-time buyers | `order.customer.orders_count <= 1` |
| `returning_customer_orders` | orders from repeat buyers | `order.customer.orders_count > 1` |
| `guest_orders` | orders with no customer record | `order.customer` absent |

Already present but previously not surfaced to the client, now passed through:
`total_refunds`, `refunded_orders`, `net_revenue`, and `top_products`.

`routes/salesTraffic.js` rolls these across every connected store into a
`result.ecom` block (derived rates: `refundRate`, `discountRate`, returning
share; net revenue derived from summed gross − refunds so it holds for
multi-store clients). `ClientSalesTrafficPage.jsx` renders a second stat strip
(net revenue, refund rate, discount share, returning share) and a **top
products by revenue** table under the existing KPIs.

**Value:** refund rate, discount leakage, repeat-purchase rate and best
sellers — immediate merchandising/retention signal — with zero new
permissions.

### Note on the webhook refunds path

`shopifyApp.js` reads refunds from the `refunds` array on `ORDERS_UPDATED`
order payloads (Shopify fires an order update whenever a refund is issued), so
refunds are already captured. `REFUNDS_CREATE` is intentionally **not** in the
read topic filter: its payload is a refund object, not an order, so folding it
into the order-keyed aggregation would create phantom orders. Leave it as an
ingest-only signal.

## Tier 1 — light pulls behind existing read scopes (deferred, low-lift)

Uses scopes the store already granted; adds a small number of read calls.

- **Low-stock / inventory health** — `read_inventory` is already granted;
  surface variants below a threshold as an advisory list.
- **Fulfilment latency** — `order.fulfillment_status` + fulfilment timestamps
  (already on the order) → median time-to-ship, unfulfilled backlog.
- **SEO / catalogue health** — products missing meta descriptions, alt text,
  or with thin copy (`read_products`), as an advisory checklist.

Each is a read-only *skill* the analyst can run; none writes to the store.

## Tier 2 — advisory intelligence (deferred)

- Cohort / repeat-purchase curves from `orders_count` over time.
- Discount ROI: AOV and repeat rate of discounted vs full-price cohorts.
- Abandoned-checkout signal (the app already forwards `checkouts/create`).

## Deferred — write-back (explicit opt-in only, not planned)

Anything that mutates the store — customer tagging, draft products, inventory
edits, price changes — stays out of scope. It would need new write scopes, a
per-client consent step surfaced in the connector UI, and an audit trail. OMI
stays advisory unless the client explicitly turns a specific write action on.

## Files

- `dev/platform/backend/src/connectors/shopify.js` — summary enrichment (pull).
- `dev/platform/backend/src/connectors/shopifyApp.js` — summary enrichment
  (webhook), kept shape-identical to the pull connector.
- `dev/platform/backend/src/routes/salesTraffic.js` — `result.ecom` roll-up.
- `dev/platform/frontend/src/pages/ClientSalesTrafficPage.jsx` — Data page UI.
