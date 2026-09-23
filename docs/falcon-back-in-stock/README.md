# Falcon stock system (back-in-stock + preorder)

**Client:** Falcon Enamelware (UK, US and EU Shopify stores)
**Replaces:** Purple Dot
**Code:** `dev/falcon-back-in-stock/` (theme files, Cloudflare Worker, Brevo email templates)

A sold-out variant shows either a "Notify me" form or, when it has an expected date and a cap, a "Pre-order" button with full payment at checkout. Shopify Flow sends order and inventory events to a Cloudflare Worker (`falcon-stock`), which tags customers and orders, holds only the preorder lines, releases them oldest order first when stock arrives, and sends back-in-stock, date-change and staff emails through Brevo. A daily job at 07:00 UTC handles date changes, US consent deadlines and configuration alerts.

## Documents

| Document | What it is for |
|---|---|
| [`INSTALL.md`](INSTALL.md) | **Start here to install.** Master runbook for Claude in Chrome: pre-flight audit, accounts and secrets, Worker, Brevo, metafields, theme, notifications, Flows, tests, go-live, staff guide, Purple Dot switch-off, VERIFY list, legal items, rollback |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | The design: data model (metafields, tags, line item properties), components, Worker endpoints, email rules, Flows |
| [`INSTALL-THEME.md`](INSTALL-THEME.md) | Step-by-step theme and notification template edits, with the storefront test checklist. Used by `INSTALL.md` phases 5 and 6 |
| [`WORKER.md`](WORKER.md) | Worker code notes: environment, endpoints, DRY_RUN, idempotency, tests |
| [`EMAILS.md`](EMAILS.md) | Brevo template names, subjects, parameters and sample data |
| [`research/shopify.md`](research/shopify.md) | Shopify platform research behind the design (Flow, holds, selling plans, customer form) |
| [`research/brevo-compliance.md`](research/brevo-compliance.md) | Brevo API and UK/US/EU legal research behind the email rules |

## Key decisions (short version)

- **No Shopify customer form for the waitlist.** The notify form posts to the Worker's `/subscribe` endpoint, protected by Cloudflare Turnstile. Shopify's `{% form 'customer' %}` subscribes everyone to marketing and does not reliably tag existing customers, so it is no longer used. Marketing consent is set only when the customer ticks the newsletter box, and never downgraded.
- **No preorder app and no selling plans.** Preorders use "Continue selling when out of stock", variant metafields (`falcon.expected_date`, `falcon.preorder_limit`) and a hidden `_preorder_date` line item property; the Worker places a fulfilment hold on the preorder lines only.
- **Brevo sends every email** (transactional, one sender per store). Native Shopify Order and Shipping confirmations carry a preorder block; there are no separate confirmation emails.
- **Nothing is cancelled, refunded or changed in consent automatically.** Staff do those, prompted by alerts.
- **Existing waitlist carries over:** the Worker reads the same `restock-{variant_id}` customer tags the old form wrote. Consent remediation for those customers is Falcon's decision (see `INSTALL.md` Phase 0.3).

## Code layout

| Path | Contents |
|---|---|
| `dev/falcon-back-in-stock/theme/snippets/` | `falcon-config`, `falcon-variant-data`, `restock-notify-form`, `preorder-message`, `preorder-cart-line` |
| `dev/falcon-back-in-stock/theme/templates/product.liquid` | Finished UK product template (reference for the edits) |
| `dev/falcon-back-in-stock/theme/notifications/` | Order and Shipping confirmation preorder blocks |
| `dev/falcon-back-in-stock/worker/worker.js` | The Worker, pasted into the Cloudflare dashboard as-is |
| `dev/falcon-back-in-stock/worker/tests/` | Node tests (`node --test dev/falcon-back-in-stock/worker/tests/`) |
| `dev/falcon-back-in-stock/emails/` | Brevo template HTML |
