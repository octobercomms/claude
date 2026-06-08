# October Marketing Intelligence — Shopify app

An embedded Shopify admin app that connects a merchant's store to their
**October Marketing Intelligence** (OMI) account and streams real-time commerce
signals — orders, refunds, customers, products, inventory, theme publishes and
abandoned checkouts — to the October platform.

This is **Surface 2** of OMI (the Shopify equivalent of the WordPress lead
capture plugin). The code lives in `dev/october-mi-shopify/`; these docs live in
`docs/october-mi-shopify/`.

## What it is

- **Embedded Shopify admin app** built on the standard Shopify Remix app
  template (Remix + Polaris + App Bridge).
- **Read-only**: it requests only read scopes and never writes to the store.
- **Pairing-based**: after install, the merchant pastes a 24-character pairing
  token from their October dashboard — the same uniform UX as the OMI WordPress
  plugin — to link the store to their client account.
- **Webhook-driven**: store activity is forwarded to the platform in real time
  via HMAC-verified webhooks.

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Remix (`@remix-run/*` v2, Vite) |
| Shopify integration | `@shopify/shopify-app-remix` v3 |
| UI | `@shopify/polaris` v12 + `@shopify/app-bridge-react` v4 |
| Session store | Prisma (`@shopify/shopify-app-session-storage-prisma`) — SQLite in dev, Postgres in prod |
| Webhook API version | `2025-01` |
| Auth | Shopify managed install + new embedded auth strategy (token exchange) |

## Scopes (justified)

`read_orders, read_customers, read_products, read_inventory, read_themes`

Each maps directly to a sync surface:

- `read_orders` — orders, refunds, fulfilments, abandoned checkouts.
- `read_customers` — customer create/update signals.
- `read_products` — product catalogue create/update/delete.
- `read_inventory` — inventory level changes.
- `read_themes` — theme publish events (storefront change signal).

No write scopes are requested.

## Local development

Prerequisites: Node 18.20+/20.10+, a [Shopify Partner](https://partners.shopify.com)
account, and the Shopify CLI (`npm i -g @shopify/cli@latest`).

```bash
cd dev/october-mi-shopify
npm install
cp .env.example .env          # fill in values, or let the CLI manage them
npm run config:link           # bind to your Partner app (writes client_id)
npm run dev                   # = shopify app dev — opens a tunnel + dev store
```

`shopify app dev` runs `prisma generate && prisma migrate deploy` (via
`shopify.web.toml`), starts the Remix dev server, opens a tunnel, and updates the
app URLs in the Partner dashboard automatically.

To build/run a production bundle locally:

```bash
npm run build
npm run start
```

## Pairing flow

1. Merchant installs the app from the App Store listing → standard Shopify OAuth
   (token exchange) runs via the template auth routes.
2. The embedded admin (`/app`) shows **"Pair this store with your October
   Marketing Intelligence account"** with a single 24-character pairing-token
   input.
3. On submit, the app POSTs
   `{ shop_domain, access_token, pairing_token }` to
   `https://platform.octobercomms.com/api/shopify-app/install` (signed with the
   shared forwarding secret; see `API.md`).
4. On success the platform returns `{ client_id, client_name }`; the app stores
   the pairing locally and the admin flips to **"Connected to [client name]"**
   with a green status dot, last-sync timestamp, events-this-week count, and a
   deep link to the client's dashboard at `platform.octobercomms.com`.

## Webhooks (real-time sync)

Registered in `shopify.app.toml` and handled at `/webhooks/events`
(`app/routes/webhooks.events.jsx`):

| Topic | Signal |
|-------|--------|
| `orders/create` | new order |
| `orders/updated` | order changed |
| `orders/cancelled` | order cancelled |
| `orders/fulfilled` | order fulfilled |
| `refunds/create` | refund issued |
| `customers/create` | new customer |
| `customers/update` | customer changed |
| `products/create` | new product |
| `products/update` | product changed |
| `products/delete` | product removed |
| `inventory_levels/update` | stock level change |
| `themes/publish` | storefront theme published |
| `checkouts/create` | abandoned-cart signal |

Plus `app/uninstalled` (`/webhooks/app/uninstalled`) to clean up local sessions
and notify the platform.

Each handler verifies the Shopify HMAC (via `authenticate.webhook`), then
forwards a normalised envelope to
`https://platform.octobercomms.com/api/shopify-app/webhook`.

## GDPR / mandatory compliance webhooks

Shopify App Store approval **requires all three**. They are registered as
`compliance_topics` and handled at `/webhooks/gdpr`
(`app/routes/webhooks.gdpr.jsx`):

- `customers/data_request` — relayed to the platform (system of record for any
  retained data).
- `customers/redact` — relayed to the platform to purge the customer's records.
- `shop/redact` — deletes all local rows for the shop (sessions + pairing) and
  tells the platform to purge the shop's data.

This app stores **no customer PII at rest** (it forwards, it does not retain), so
data-request/redact are primarily relays; `shop/redact` performs local cleanup.

## HMAC verification

- Incoming Shopify webhooks: verified by `authenticate.webhook(request)`, which
  checks `X-Shopify-Hmac-Sha256` against the app API secret and returns 401 for
  unverified requests. A standalone, auditable implementation also lives in
  `app/utils/hmac.server.js` (`verifyShopifyHmac`) for any raw/custom endpoint.
- Outgoing forwards to the platform: signed with HMAC-SHA256 over the request
  body using `OMI_FORWARD_SECRET` and sent as `X-OMI-Signature` so the platform
  can trust the source. See `API.md`.

## Deployment target

- Host: **`shopify-app.octobercomms.com`** (the `application_url` /
  `redirect_urls` in `shopify.app.toml`).
- Distribution: **public Shopify App Store** listing
  (`distribution = AppDistribution.AppStore`).
- Session store: switch the Prisma datasource to PostgreSQL and set
  `DATABASE_URL` accordingly. A `Dockerfile` is included for containerised
  deploys (`npm run docker-start` runs migrations then serves).

> Infra provisioning for `shopify-app.octobercomms.com` is documented only; it is
> not provisioned by this repo.

## Out of scope (v1)

Billing/charging (the app starts free), theme app extensions, and translations.
See `STATUS.md`.
