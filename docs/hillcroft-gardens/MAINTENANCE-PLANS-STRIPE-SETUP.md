# Maintenance Plans — Stripe setup checklist

The recurring **maintenance plans** (plugin 1.12.0) are billed by **Stripe
Billing**. Stripe owns the monthly charge, card authentication (SCA/3DS),
automatic retries on a failed payment, and the dunning reminder emails.
WooCommerce stays the system of record for receipts (each paid invoice is
mirrored into a completed Woo order).

This is a one-time setup. None of it can be done from the plugin alone — it
needs a few clicks in your Stripe dashboard.

---

## 1. Add your Stripe keys

**Designer → Settings → Stripe**

- **Secret key** (`sk_live_…` or `sk_test_…`)
- **Publishable key** (`pk_live_…` / `pk_test_…`)

Use **test** keys first (see "Test it end to end" below), then swap to live.

## 2. Add the webhook endpoint

In Stripe: **Developers → Webhooks → Add endpoint**.

- **Endpoint URL:**
  `https://YOUR-SITE/wp-json/hgd/v1/stripe/webhook`
  (this is the same endpoint the consultation and proposal payments already
  use — there is only one Stripe webhook URL for the whole plugin).
- **Events to send** — enable these five:
  - `checkout.session.completed` — activates the plan + creates/links the CRM client
  - `invoice.paid` — advances the billing period + creates the WooCommerce receipt order
  - `invoice.payment_failed` — marks the plan "payment failed" (Stripe then retries)
  - `customer.subscription.updated` — keeps status / next-bill date in step
  - `customer.subscription.deleted` — records a cancellation

After creating the endpoint, copy its **Signing secret** (`whsec_…`) into
**Designer → Settings → Stripe → Webhook signing secret**. Without this the
plugin rejects the events (signature check fails) and nothing will activate.

## 3. Turn OFF Stripe's own email receipts

To avoid customers getting **two** receipts (one from Stripe, one from Woo):

**Stripe → Settings → Customer emails** → turn **off** "Successful payments"
(and "Refunds" if you prefer Woo to own those too). WooCommerce sends the
order receipt instead, with your store's branding / VAT settings.

## 4. (Recommended) Configure Stripe's retries + dunning

This is where the "auto-retry + reminder emails" behaviour lives:

**Stripe → Settings → Billing → Subscriptions and emails**

- **Smart Retries / retry schedule** — how many times and over how many days a
  failed renewal is retried.
- **Reminder / failed-payment emails** — the dunning emails sent to the
  customer on a failed charge.
- **After all retries fail** — choose what happens (cancel the subscription, or
  leave it unpaid). The plugin reflects whatever Stripe decides via the
  webhook, so the admin **Maintenance Plans** list stays accurate.

---

## Test it end to end (test mode)

1. Put the plugin in **test** keys (step 1) and create the webhook against your
   **test** mode (step 2).
2. Add the **`[hgd_maintenance_plans]`** shortcode to a page.
3. Choose a plan, fill in the details, and pay on Stripe Checkout with a test
   card — `4242 4242 4242 4242`, any future expiry, any CVC/postcode.
4. Confirm:
   - **Designer → Maintenance Plans** shows the subscriber as **Active** with a
     next-bill date.
   - A **completed WooCommerce order** exists for the payment, and the customer
     got the Woo receipt email.
   - The customer now exists under **Designer → Clients**.
5. Test a failure with card `4000 0000 0000 0341` (attaches but fails on
   charge) to see the **payment failed** path + Stripe's retry/dunning emails.

Then swap to **live** keys and repeat the webhook setup in live mode.

## Notes

- **Plan prices** are defined in `HGD_Subscription::plans()` (Essential £45 /
  Full £85 / Premium £140 a month) and can be overridden with the
  `hgd_maintenance_plans` filter. Changing a price mints a new Stripe Price on
  the next sign-up — existing subscribers keep the price they signed up at.
- **Cancelling** from the admin list cancels **at period end** in Stripe; the
  customer keeps cover until the period they've paid for runs out.
- Subscriptions are stored in the `hgd_subscriptions` table (schema v15).
