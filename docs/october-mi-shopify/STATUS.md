# Status & TODO — October MI Shopify app

## v1 scope (this scaffold)

- [x] Hand-scaffolded Shopify Remix app template layout (Remix + Vite + Polaris
      + App Bridge), faithful to `shopify app init` conventions.
- [x] `shopify.app.toml` with name, read-only scopes, application_url, webhook
      API version `2025-01`, embedded, and webhook subscriptions.
- [x] Prisma session store (`Session` model) + `StorePairing` model, with an
      initial migration.
- [x] `app/shopify.server.js` configuring `shopifyApp(...)` (auth, session
      storage, App Store distribution, new embedded auth strategy).
- [x] Standard Shopify OAuth via template auth routes (`auth.$`, `auth.login`).
- [x] Embedded admin pairing UX: single 24-character pairing-token input →
      POST to `/api/shopify-app/install` → "Connected to [client name]".
- [x] Connection status (green dot, last sync, events this week, dashboard
      deep link) in `app/routes/app._index.jsx`.
- [x] Commerce webhooks (orders/refunds/customers/products/inventory/themes/
      checkouts) + `app/uninstalled`, forwarded to `/api/shopify-app/webhook`.
- [x] All three mandatory GDPR webhooks (`customers/data_request`,
      `customers/redact`, `shop/redact`) with real handlers.
- [x] HMAC verification: Shopify incoming via `authenticate.webhook`, plus a
      standalone `app/utils/hmac.server.js`; outgoing forwards signed with
      `OMI_FORWARD_SECRET`.
- [x] Docs: README, API contract, this status note.

## Deferred / out of scope (v1)

- Billing & charging — app starts free; no Billing API integration.
- Theme app extensions / web pixel extension.
- Translations / localisation (UI is British English only).
- Platform-side `/api/shopify-app/*` route implementations — **separate future
  PR** (see `API.md` for the contract).
- Backfill/initial historical import via the Admin API (the access token is
  forwarded so this can be added platform-side later).
- Provisioning of `omi.octobercomms.com` infra (documented, not built).

## Verified in this PR

- `package.json` and `tsconfig.json` parse as valid JSON.
- `shopify.app.toml`, `shopify.web.toml`, `migration_lock.toml` parse as valid
  TOML.
- All plain `.js` server files pass `node --check`.
- `.jsx` files: brace/paren balanced and self-reviewed (cannot `node --check`
  JSX without a bundler, which isn't available offline). Not run end-to-end —
  `npm install` + `shopify app dev` require network + a Partner app.

## Shopify App Store review checklist

- [x] **GDPR mandatory webhooks** — all three implemented and HMAC-verified
      (returns 401 on bad signature via `authenticate.webhook`).
- [x] **Scopes justified** — read-only only; each scope maps to a sync surface
      (see README). No write scopes.
- [x] **OAuth / embedded** — managed install + token exchange; embedded via App
      Bridge; uses session token auth.
- [x] **Webhook HMAC verification** on every webhook route.
- [ ] **Listing assets** — app icon, screenshots, feature media, app name,
      tagline, detailed description, pricing (free), support URL, privacy policy
      URL. *To produce before submission.*
- [ ] **Privacy policy URL** published and linked in the listing + app.
- [ ] **App tested on a development store** end-to-end (install → pair → events
      flowing → uninstall cleanup).
- [ ] **Performance check** (Shopify's automated install/load checks).
- [ ] **Contact / emergency developer details** in the Partner dashboard.
- [ ] Confirm `client_id` set in `shopify.app.toml` and URLs point at
      `omi.octobercomms.com` before submission.
