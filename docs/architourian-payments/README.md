# Architourian Payment Links

A small WordPress admin plugin that generates **Stripe payment links** for tour
balances from inside wp-admin. Staff type a customer name, a note and the amount
to pay, and get a shareable Stripe link with a QR code. Every link is logged and
its paid/unpaid status can be pulled back from Stripe.

- **Code:** `dev/architourian-payments/`
- **Plugin slug / text domain:** `architourian-payments`
- **Releases:** GitHub Releases tagged `arpl-v<version>` (built by the
  `architourian-payments-release.yml` Action; installed via the plugin's
  built-in self-updater).

## Why it exists

Tour final balances change (numbers drop out, extras get added), so the amount
can never be pre-set — it has to be typed in each time. This tool makes that a
10-second job and keeps a record of what was sent and what's been paid, without
leaving WordPress.

## How it works

1. **Settings** (`Payment Links → Settings`): paste a Stripe **secret key**
   (`sk_test_…` or `sk_live_…`), pick Test/Live mode and a default currency.
   Keys are stored in WordPress options and never echoed back into the page.
2. **Create** (`Payment Links`): enter customer, note and amount → the plugin
   calls Stripe to create a one-off **Price** (with an inline product) and a
   **Payment Link** for it, then stores a row in `{prefix}arpl_links`.
3. **Share**: copy the link, show the QR code (rendered locally, no third-party
   service), open it, **or email it** to the customer.
4. **Email** (`?arpl_compose=<id>`): an editable draft (subject + message, with
   `{customer}` / `{amount}` / `{note}` placeholders) is pre-filled from the
   template settings. The branded HTML wrapper, the amount box, a tracked
   **Pay now** button and an open-tracking pixel are added automatically. Sent
   via **Brevo's transactional API** (`/v3/smtp/email`), or `wp_mail` if no
   Brevo key is set.
5. **Track**: every link carries an unguessable `token`. Emailed buttons point at
   `?arpl_go=<token>` (logs a **clicked** event, then 302s to Stripe) and embed
   `?arpl_open=<token>` as a 1×1 pixel (logs **opened**, deduped for 2 min).
   *Refresh status* queries Stripe and logs **paid**. The log's Activity column
   shows opened / clicked / sent counts so staff know whether to chase.
6. **Chase**: the *Chase* button reopens the compose screen with the reminder
   template; it can be sent as many times as needed, each logged.

### Activity events (`{prefix}arpl_events`)

`sent`, `reminder`, `opened`, `clicked`, `paid` — one row each, with timestamps,
summarised per link for the Activity column and the compose summary.

### Stripe API surface used

All via `wp_remote_*` — no SDK/Composer dependency:

| Action | Endpoint |
|--------|----------|
| Create amount | `POST /v1/prices` (inline `product_data[name]`) |
| Create link | `POST /v1/payment_links` |
| Check paid | `GET /v1/checkout/sessions?payment_link=…` |
| Close link | `POST /v1/payment_links/{id}` (`active=false`) |

The Stripe secret key needs permission to write Prices & Payment Links and read
Checkout Sessions (a standard secret key covers all of these). Webhooks are **not**
required — status is pulled on demand.

## Files

```
dev/architourian-payments/
  architourian-payments.php        Plugin bootstrap, constants, updater wiring
  includes/
    class-arpl-settings.php        Stripe + Brevo keys, mode, currency, templates
    class-arpl-stripe.php          Thin Stripe REST client (wp_remote_*)
    class-arpl-store.php           arpl_links + arpl_events tables + CRUD
    class-arpl-email.php           Brevo sender + branded HTML email + templates
    class-arpl-track.php           Public open-pixel + click-redirect endpoints
    class-arpl-admin.php           Dashboard, compose/send screen, action handlers
    class-arpl-updater.php         Self-update from monorepo GitHub Releases
  assets/
    js/admin.js                    Copy-to-clipboard + QR modal
    js/qrcode.min.js               Vendored QRCode lib (davidshimjs/qrcodejs, MIT)
    css/admin.css                  Admin styling
  bin/build-zip.sh                 Builds architourian-payments-<version>.zip
  readme.txt                       WP-readable plugin metadata
```

## Releasing a new version

1. Bump the version in **both** the plugin header and the `ARPL_VERSION`
   constant in `architourian-payments.php` (the release Action fails if they
   disagree), and add a `readme.txt` changelog entry.
2. Merge to `main`. The `architourian-payments-release.yml` Action builds the
   zip and publishes a `arpl-v<version>` Release.
3. The live site's self-updater offers it as a one-click update.

## Security notes

- All state-changing actions go through `admin-post.php` with `manage_options`
  capability checks and nonces.
- Secret keys are write-only in the UI (blank submit keeps the stored key).
- Use **Test mode** with `sk_test_…` keys to trial without real charges.
