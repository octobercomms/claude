# Shopify App Store review — test credentials & instructions

This doc resolves Shopify review requirement **4.5.4 (Include test
credentials)**. Our app gates its functionality behind a pairing token, so the
reviewer cannot test anything until we give them a way through that gate.

> **The rejection in one line:** the reviewer installed the app, hit the
> "Paste your 24-character pairing token" screen, had no October account or
> token, and couldn't proceed. They need either a token or a platform login.
> Their message: _"we will need either the 24-character token or test account
> credentials for the main platform in order to test the app's functionality."_

## Why a single token is not enough

Shopify pairing tokens (`connectors.js` → `POST /client/:id/shopify/pairing-token`)
are **single-use** (`shopifyApp.js` sets `used_at` on first `/install`) and
**expire after 7 days**. So:

- A token pasted into the listing **burns on first pairing** — the reviewer
  can't re-install/re-pair (they routinely do, to test uninstall + GDPR
  cleanup) without it failing as _"Unknown or expired pairing token."_
- Review often takes **longer than 7 days**, so a token minted at submission
  can expire before the reviewer opens it.

**The fix:** give the reviewer a **demo OMI login** so they can self-mint fresh
tokens whenever one burns or expires, plus a starter token to get going
immediately. This is also exactly the platform-credentials option Shopify
offered, so it cannot be "not enough."

## What to provision before resubmitting

1. **A demo client** in OMI named e.g. `Shopify Review — Demo Store`. Do **not**
   use a real client — the connected state deep-links to
   `platform.octobercomms.com/clients/{id}` with that client's live data.
2. **A throwaway OMI user** scoped to *only* that demo client. This is the login
   you hand the reviewer. Never give them a real agency account.
3. **A fresh starter pairing token** for that demo client, generated **right
   before you hit Submit** (so the 7-day clock starts as late as possible):
   Settings → Integrations → demo client → *Generate Shopify pairing token*.
4. Confirm the live path works end-to-end: app is served at
   `omi.octobercomms.com`, and `https://platform.octobercomms.com/api/shopify-app/install`
   accepts the token (returns `{ ok: true, client_id, client_name }`).

## Paste this into the Partner Dashboard

Put this in **App submission → "Provide your testing instructions"** (and the
test-credentials fields). Fill in the four `<…>` placeholders.

```
TEST CREDENTIALS

October Marketing Intelligence is a read-only connector that links a Shopify
store to a marketing agency's OMI account. After install, the embedded admin
asks for a 24-character pairing token generated in the OMI dashboard. We have
set up a demo OMI account so you can complete the full flow and re-test as
needed.

OMI demo dashboard (to generate pairing tokens):
  URL:      https://platform.octobercomms.com/login
  Email:    <demo-reviewer@octobercomms.com>
  Password: <password>

Starter pairing token (use this first — valid until <date, 7 days from submit>):
  <24-character-token>

TESTING STEPS

1. Install the app on your test store and approve the read-only scopes
   (read_orders, read_customers, read_products, read_inventory, read_themes).
2. The embedded admin shows "Pair this store with your October Marketing
   Intelligence account."
3. Paste the starter pairing token above and click "Pair store."
   → The admin flips to "Connected to Shopify Review — Demo Store" with a green
     Live badge, a last-sync time, and an events-this-week count.
4. To re-pair (tokens are single-use): log in to the OMI demo dashboard above,
   go to Settings → Integrations → the demo client → "Generate Shopify pairing
   token", copy the new 24-character token, and repeat step 3.
5. Optional: create or cancel an order, or add a product, to see store activity
   forwarded; or uninstall the app to verify session/pairing cleanup.

NOTES

- The app is read-only and never writes to the store.
- All three GDPR mandatory webhooks (customers/data_request, customers/redact,
  shop/redact) are implemented and HMAC-verified.
- Support: support@octobercomms.com
```

## Keeping it up to date (4.5.4 requires this)

Shopify says _"keep these account credentials up to date."_ During the review
window:

- If the reviewer reports the token is expired/used, log in to the demo
  dashboard, mint a new one, and update the testing-instructions field.
- Keep the demo user active and the demo client present until the app is
  approved. Don't delete the demo client (it cascades the pairing tokens via
  `ON DELETE CASCADE`).
