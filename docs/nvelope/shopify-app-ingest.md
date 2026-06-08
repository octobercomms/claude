# Shopify app ingest (platform side)

Status: **shipped**. The platform side of the October MI public Shopify app —
the `/api/shopify-app/*` routes the app forwards to. Contract:
`docs/october-mi-shopify/API.md`.

## Moving parts

| Piece | Location |
|---|---|
| Ingest routes (`/install`, `/webhook`) | `backend/src/routes/shopifyApp.js` |
| Connector that aggregates stored events into the Shopify shape | `backend/src/connectors/shopifyApp.js` (type `shopify_app`) |
| Storage, pairing tokens, GDPR audit | migration `067_shopify_app.sql` (`shopify_app_events`, `shopify_pairing_tokens`, `shopify_gdpr_requests`) |
| Pairing-token generator (dashboard/AM action) | `POST /api/connectors/client/:clientId/shopify/pairing-token` |
| Shared signing secret | `OMI_FORWARD_SECRET` (Settings; same value in the app's env) |

## Auth model

Both endpoints are authenticated by a **shared-secret HMAC**
(`OMI_FORWARD_SECRET`) over the raw request body — independent of Shopify's own
webhook HMAC, which the app verifies on the incoming side before forwarding.
`verifyForwardSignature` recomputes and compares in constant time; raw bytes
come from the `express.json({ verify })` hook in `index.js`.

- `/install`: validates the one-time pairing token, stores the shop's Admin API
  access token (encrypted) and upserts the `shopify_app` connector
  (`store_label` = shop domain, so multi-store clients get one row each).
- `/webhook`: a normalised envelope `{ shop_domain, topic, api_version,
  received_at, payload }`. Commerce topics are stored in `shopify_app_events`;
  `APP_UNINSTALLED` disconnects the connector; GDPR topics are handled
  specially (below). Always 200s so the app doesn't enter Shopify retry loops —
  durable retry/queueing is a platform follow-up.

## GDPR

Every `customers/data_request`, `customers/redact`, `shop/redact` is audited in
`shopify_gdpr_requests`. `SHOP_REDACT` purges the shop's events and disconnects
+ clears the connector's credentials. `CUSTOMERS_REDACT` best-effort deletes
stored events for the named customer. `CUSTOMERS_DATA_REQUEST` is audited; the
platform is the system of record and fulfils out of band.

## Read path

`shopify_app.fetchData` aggregates stored `ORDERS_*` events for the period into
the **same shape as the custom-OAuth shopify connector**
(`summary.total_revenue/total_orders/avg_order_value/total_refunds/net_revenue/
financial_status_breakdown/daily`, `top_products`, `orders`). Latest event per
order id wins. Coexists with the existing `shopify` connector for migration.

## Not yet done

- Durable retry/queue for forwarded webhooks (currently stored synchronously).
- Embedded-admin "synced events this week" count could read
  `shopify_app_events`; wiring the app's status panel to a platform stats
  endpoint is a follow-up.
- A future cleanup could unify `shopify_pairing_tokens` and
  `wp_pairing_tokens` into one generic `pairing_tokens` table.
