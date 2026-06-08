# WordPress plugin ingest (platform side)

Status: **shipped**. The platform side of the October MI WordPress plugin — the
`/api/wp-connect/*` routes the plugin pushes to. Contract:
`docs/october-mi-wp/API.md`.

## Why

The platform used to poll each client's WooCommerce/WP REST API, which every
modern WP host's WAF (Cloudflare, Sucuri, Wordfence) challenges — returning the
JS-challenge HTML page as a `401`. The plugin reverses the direction: the WP
site makes outbound, HMAC-signed calls to the platform, which are never
WAF-challenged. Same data, no breakage.

## Moving parts

| Piece | Location |
|---|---|
| Ingest routes (`/pair`, `/orders`, `/customers`, `/products`, `/inventory`, `/content`, `/seo`, `/form-submission`) | `backend/src/routes/wpConnect.js` |
| Connector that aggregates stored events into the WooCommerce shape | `backend/src/connectors/wordpressPlugin.js` (type `wordpress_plugin`) |
| Storage + one-time pairing tokens | migration `066_wp_connect.sql` (`wp_connect_events`, `wp_pairing_tokens`) |
| Pairing-token generator (dashboard/AM action) | `POST /api/connectors/client/:clientId/wp/pairing-token` |

## Auth model

- `/pair` is the one unsigned call: it exchanges a one-time token (from
  `wp_pairing_tokens`, 7-day expiry, single use) for the `client_id` and a
  freshly generated `refresh_secret`, and activates the `wordpress_plugin`
  connector (storing the secret encrypted in `connectors.credentials`).
- Every other call is verified by `verifySignature`: look up the connector by
  `X-OMI-Client`, recompute `HMAC-SHA256` over the **raw request bytes** with
  the stored `refresh_secret`, compare in constant time, and reject timestamps
  outside ±5 minutes (replay guard). Raw bytes are captured by the
  `express.json({ verify })` hook in `index.js`.

## Mounting

Mounted **before** the global per-IP rate limiter with its own generous limiter
(1200/min), because a busy store's event stream comes from a single IP and
would otherwise trip the dashboard cap. No platform session auth — HMAC is the
auth.

## Read path

`wordpress_plugin.fetchData` aggregates `wp_connect_events` for the report
period and returns the **same shape as the woocommerce connector**
(`summary.total_orders/total_revenue/avg_order_value/daily`, `orders`,
`top_products`), so reports, the Sales & Traffic dashboard and the chat tools
treat plugin-sourced stores identically to REST-polled ones. Latest event per
resource id wins; refunded/cancelled/failed orders are excluded from revenue.

## Migration note

`066` adds `'wordpress_plugin'` to the `connector_type_enum` via
`ALTER TYPE ... ADD VALUE IF NOT EXISTS`, which runs inside the migration
runner's transaction on PostgreSQL 12+ (the value is only used at runtime, not
within the same transaction).

## Inbound draft publish (done)

The Organic → Publish step publishes through the plugin's
`/wp-json/october-mi/v1/draft` route for `wordpress_plugin` connectors
(`contentPublish.publishToWordPressViaPlugin`, bearer = `refresh_secret`),
bypassing the wp/v2 REST API that WAFs challenge. The plugin route only creates
drafts for the client to review; live/scheduled publishing still uses a
WooCommerce REST connector. The Publish panel lists the plugin connector as a
WordPress target alongside WooCommerce.

## Not yet done

- Per-event workers / derived tables: v1 aggregates on read. If event volume
  makes that slow, roll up into per-day summary tables.
- Historic backfill (one-off admin script, per the plugin brief).
