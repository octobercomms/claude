# Stripe connector

For clients who take payments through a custom cart rather than Shopify or
WooCommerce. Architecture Tours and Atlanta Design Festival are the two it was
built for.

## Why there is no cart API

The first instinct was to have the cart expose an endpoint for OMI to call.
That would be a second system to build, deploy, authenticate and keep alive,
serving data Stripe already publishes through an API that is documented,
versioned and maintained by someone else.

Stripe holds every charge, customer and refund already. OMI reads it directly.
The only thing Stripe does not know is **what** was sold, because a charge
carries an amount and not a basket. That is the one gap the cart has to close,
and it closes with a metadata field rather than an API.

## Connecting it in OMI

Settings → Connectors → add a **Stripe** connector for the client, and paste a
**restricted key**.

Make the key in the Stripe dashboard under Developers → API keys → Create
restricted key, and give it **read** on:

- **Charges** — the revenue, the refunds and the metadata
- **Customers** — so repeat purchase and lifetime value are readable later

Nothing else, and nothing writable. This connector only ever reads, and a
stolen read key cannot move money. A full secret key (`sk_live_…`) will also
work, and the Settings → Security report will tell you off for using one.

A test key (`rk_test_…`) connects fine and reads test data; every figure it
produces is labelled `test` so nobody mistakes a sandbox number for a month's
takings.

## What the cart agent needs to do

Give this section to whoever is working on the cart. None of it changes how
payments work; it changes what the payment record says about itself.

### 1. Set `metadata.product` on every charge

The single highest-value change. Without it OMI can report revenue, orders and
average order value, but "top products" is empty, because Stripe has no idea
whether £75 was a Barbican tour or a festival pass.

On the PaymentIntent (or the Checkout Session, if that is what the cart
creates):

```js
metadata: {
  product: 'Barbican architecture tour',   // the human name, as it should read in a report
  order_id: 'AT-2026-0417',                // your own order reference
  client: 'architecture-tours',            // which site, if one Stripe account serves several
  source: 'google_organic',                // utm_source if you have it at checkout
}
```

`product` is the one OMI reads for the top-products table; `product_name` is
accepted as an alias. The others are not read yet and cost nothing to set now:
`order_id` makes a refund traceable back to your own system, and `source` is
what will one day let OMI attribute revenue to a channel without GA4.

Metadata is limited to 50 keys and 500 characters per value, which is far more
than this needs.

### 2. Use real Products and Prices

If the cart charges an arbitrary amount, Stripe records an amount. If it
charges against a Stripe **Price** belonging to a **Product**, Stripe records
what was bought, and the dashboard becomes useful on its own terms as well.

This matters more than it looks for tours and tickets, where the same £75 can
be three different things.

### 3. Always attach a customer

Create or reuse a Stripe `Customer` and set it on the PaymentIntent, rather
than taking the payment anonymously with just an email.

Without it, every purchase is a stranger: repeat purchase rate, lifetime value
and "how many of this festival's buyers came back next year" are all
unanswerable, and no amount of later work recovers it, because the link was
never recorded.

### 4. Optional: webhooks for near-live numbers

OMI pulls on a schedule, so figures are as fresh as the last sync. If you want
them closer to live, send `checkout.session.completed` and `charge.refunded`
to an endpoint. This is a nice-to-have and nothing depends on it.

## What OMI reports

Into the same shape Shopify and WooCommerce report, so Sales & Traffic,
reports and the analyst treat all three alike:

| Figure | How it is derived |
|---|---|
| Revenue | Charges that succeeded and were paid, **minus** `amount_refunded` |
| Orders | The count of those charges |
| AOV | Revenue over orders |
| Refunded | Reported separately, so a bad month is legible rather than hidden |
| Failed charges | Counted, so a rise in declines is visible |
| Daily series | Per day, in the primary currency |
| Top products | From `metadata.product`; empty until the cart sets it |

### Currency

Stripe quotes amounts in the currency's smallest unit. 1000 is £10.00 in GBP
but ¥1000 in JPY, which has no minor unit at all, so the divisor is per
currency and is taken from the runtime's own ISO 4217 data rather than a list
copied into the source. Getting this wrong is a 100x error on revenue, which
is why it is tested against two-, zero- and three-decimal currencies.

An account taking several currencies reports the one that took the most as the
headline and lists the others beside it. The figures are never summed across
currencies, because that total would not be money in any currency.

**One caveat.** Stripe has historically differed from ISO on a currency or two.
`docs.stripe.com` is outside the build container's allowed network domains so
it could not be checked against Stripe's own table. Everything October bills in
is a plain two-decimal currency, so this is theoretical today. If a client ever
charges in something exotic, check that currency against Stripe's table and add
it to `OVERRIDES` in `src/connectors/stripe.js`.

## Limits

- 5,000 charges per sync window. Past that the figure is marked `truncated`
  rather than quietly reported as the real total.
- Charges carry no line items, so a basket of three items is one row with one
  product name. If per-item reporting is ever needed, that comes from Checkout
  Sessions or Invoices and is a separate piece of work.
