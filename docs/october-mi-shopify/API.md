# Platform API contract — October MI Shopify app

The Shopify app calls two endpoints on the October Marketing Intelligence
platform. **Status: the platform-side routes are now implemented** (backend
`src/routes/shopifyApp.js`, connector `shopify_app`, migration
`067_shopify_app.sql`). This document remains the contract they're built to
match.

Base URL: `https://platform.octobercomms.com` (overridable via
`OMI_PLATFORM_BASE_URL`).

## Identification & signing (both endpoints)

Every request the app sends carries:

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `X-OMI-Source` | `shopify-app` |
| `X-OMI-Shop-Domain` | the `*.myshopify.com` domain |
| `X-OMI-Signature` | hex HMAC-SHA256 of the **raw request body** keyed with the shared `OMI_FORWARD_SECRET` |

The platform must recompute the HMAC over the exact raw body with the shared
secret and reject mismatches (401). This is independent of Shopify's own
webhook HMAC, which the app verifies on the *incoming* side before forwarding.

Signing is implemented in `app/utils/platform.server.js` (`signPayload`).

---

## 1. `POST /api/shopify-app/install`

Called when a merchant submits their 24-character pairing token in the embedded
admin.

### Request body

```json
{
  "source": "shopify-app",
  "shop_domain": "my-store.myshopify.com",
  "access_token": "shpua_…",
  "pairing_token": "3f9ak2lp7qz8wn4rd6sm0c1v"
}
```

- `access_token` is the Shopify Admin API access token for the offline session,
  passed so the platform can (optionally) call the Admin API directly for
  backfills. The platform should store it encrypted.
- `pairing_token` is the 24-character token generated in the merchant's October
  dashboard (Settings → Integrations).

### Expected response (200)

```json
{
  "ok": true,
  "client_id": "cli_abc123",
  "client_name": "Hillcroft Gardens Ltd"
}
```

The app persists `client_id` / `client_name` in its local `StorePairing` row
and flips the admin to the "Connected to [client name]" state.

### Errors

- `401` invalid `X-OMI-Signature`.
- `422` unknown/expired `pairing_token`. The app shows a "couldn't verify that
  token" banner.

---

## 2. `POST /api/shopify-app/webhook`

Called for every HMAC-verified Shopify webhook (commerce events, app/uninstalled
and the GDPR compliance topics). The app forwards a normalised envelope wrapping
the raw Shopify payload.

### Request body (envelope)

```json
{
  "source": "shopify-app",
  "shop_domain": "my-store.myshopify.com",
  "topic": "ORDERS_CREATE",
  "api_version": "2025-01",
  "received_at": "2026-06-08T12:34:56.000Z",
  "payload": { "...": "the raw Shopify webhook payload, unmodified" }
}
```

`topic` uses Shopify's webhook topic constant form (e.g. `ORDERS_CREATE`,
`CUSTOMERS_REDACT`, `SHOP_REDACT`). The full set the app forwards:

```
ORDERS_CREATE, ORDERS_UPDATED, ORDERS_CANCELLED, ORDERS_FULFILLED,
REFUNDS_CREATE, CUSTOMERS_CREATE, CUSTOMERS_UPDATE, PRODUCTS_CREATE,
PRODUCTS_UPDATE, PRODUCTS_DELETE, INVENTORY_LEVELS_UPDATE, THEMES_PUBLISH,
CHECKOUTS_CREATE, APP_UNINSTALLED,
CUSTOMERS_DATA_REQUEST, CUSTOMERS_REDACT, SHOP_REDACT
```

### Expected response

`200`/`204` on success. The app returns `200` to Shopify regardless of the
platform's response (logging failures) so Shopify does not enter aggressive
retry loops; the **platform owns durable retry/queueing** for forwarded events.

### GDPR handling on the platform side

- `CUSTOMERS_DATA_REQUEST` / `CUSTOMERS_REDACT`: the platform is the system of
  record for any retained customer data and must fulfil the request.
- `SHOP_REDACT`: the platform purges the shop's data. The app independently
  deletes its own local rows for the shop.

Forwarding is implemented in `app/utils/platform.server.js`
(`forwardWebhook`, `submitPairing`).
