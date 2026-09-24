# Falcon stock system (back-in-stock + preorder)

**Client:** Falcon Enamelware (UK, US and EU Shopify stores)
**Replaces:** Purple Dot
**Code:** `dev/falcon-back-in-stock/` (theme files, Cloudflare Worker, Brevo email templates)

A sold-out variant shows either a "Notify me" form or, when it has an expected date and a cap, a "Pre-order" button with full payment at checkout. Shopify Flow sends every order and inventory changes to a Cloudflare Worker (`falcon-stock`), which tags customers and orders, holds the preorder lines (including units sold below zero without the preorder label), releases them oldest order first and per variant when stock arrives, and sends waitlist sign-up, back-in-stock, date-change and staff emails through Brevo. A basket with a preorder item and an in-stock item asks the customer to ship everything together (the default: the whole order is held until the preorder ships) or separately for a "Second delivery" fee. A daily job at 07:00 UTC handles date changes, US consent deadlines and configuration alerts.

## Documents

| Document | What it is for |
|---|---|
| [`INSTALL.md`](INSTALL.md) | **Start here to install.** Master runbook for Claude in Chrome: pre-flight audit, accounts and secrets, Worker (including the `SHOPS` template), Brevo, metafields, theme, notifications, Flows, DRY_RUN tests, go-live with live link tests, staff guide (tags and alerts), Purple Dot switch-off, VERIFY list, legal items, rollback |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | The design: data model (metafields, tags, line item properties), components, Worker endpoints, email rules, Flows |
| [`INSTALL-THEME.md`](INSTALL-THEME.md) | Step-by-step theme and notification template edits, with the storefront test checklist. Used by `INSTALL.md` phases 5 and 6 |
| [`WORKER.md`](WORKER.md) | Worker code notes: environment, endpoints, unlabelled oversell, per-variant tags, DRY_RUN, idempotency, tests |
| [`EMAILS.md`](EMAILS.md) | Brevo template names, subjects, parameters and sample data |
| [`research/shopify.md`](research/shopify.md) | Shopify platform research behind the design (Flow, holds, selling plans, customer form) |
| [`research/brevo-compliance.md`](research/brevo-compliance.md) | Brevo API and UK/US/EU legal research behind the email rules |

## Key decisions (short version)

- **No Shopify customer form for the waitlist.** The notify form posts to the Worker's `/subscribe` endpoint, protected by Cloudflare Turnstile. Shopify's `{% form 'customer' %}` subscribes everyone to marketing and does not reliably tag existing customers, so it is no longer used. Marketing consent is set only when the customer ticks the newsletter box, and never downgraded.
- **No preorder app and no selling plans.** Preorders use "Continue selling when out of stock", variant metafields (`falcon.expected_date`, `falcon.preorder_limit`) and a hidden `_preorder_date` line item property; the Worker places a fulfilment hold on the preorder lines only.
- **Brevo sends every email** (transactional, one sender per store). Native Shopify Order and Shipping confirmations carry a preorder block; there are no separate confirmation emails.
- **Nothing is cancelled, refunded or changed in consent automatically.** Staff do those, prompted by alerts.
- **Existing waitlist customers are kept as they are** (decided by Daniel). They stay on the waitlist with the same `restock-{variant_id}` tags, which the Worker reads, so they carry over automatically, and their marketing consent is not changed. Phase 0 exports the list as a record only; there is no remediation step.
- **Newsletter box on the notify form is single opt-in** (decided). Ticking it sets marketing consent straight away; there is no confirmation email.
- **Mixed baskets ship together by default.** The cart offers **Ship together** (one delivery, the whole order held until the preorder ships) or **Ship separately** (a "Second delivery" fee line priced at each store's standard delivery rate; in-stock items ship now). The choice travels as the cart attribute `Delivery preference`. No attribute (express checkout, JavaScript off) means together. The Worker holds the in-stock part with its own hold and releases it with the last preorder item, or at the daily check if the preorder item goes away. Worker and theme share this contract, so they are deployed together.
- **Waitlist emails have a per-product opt-out.** A new sign-up gets one "You're on the waitlist" email. It and the back-in-stock email carry "Don't email me about this product again" (customer tag `restock-optout-{variant_id}`, cleared if they sign up again) and "Remove me from all waitlists". Preorder and delay emails are legal notices about an order and carry no opt-out.
- **US delays follow the FTC Mail Order Rule as written.** Only the keep-by date choice (the currently promised date, or 7 days after the notice if sooner) needs a quick yes or no from US counsel.

## Code layout

| Path | Contents |
|---|---|
| `dev/falcon-back-in-stock/theme/snippets/` | `falcon-config`, `falcon-variant-data`, `restock-notify-form`, `preorder-message`, `preorder-cart-line`, `delivery-choice` |
| `dev/falcon-back-in-stock/theme/templates/product.liquid` | Finished UK product template (reference for the edits) |
| `dev/falcon-back-in-stock/theme/notifications/` | Order and Shipping confirmation preorder blocks |
| `dev/falcon-back-in-stock/worker/worker.js` | The Worker, pasted into the Cloudflare dashboard as-is |
| `dev/falcon-back-in-stock/worker/tests/` | Node tests (`node --test dev/falcon-back-in-stock/worker/tests/`) |
| `dev/falcon-back-in-stock/emails/` | Brevo template HTML |
