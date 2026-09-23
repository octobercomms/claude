# Falcon back-in-stock notifications

**Client:** Falcon Enamelware (UK, US and EU Shopify stores)
**Code:** `dev/falcon-back-in-stock/`
**Goal:** replace Purple Dot. This covers step one: fix the notify-me form, then send the emails.

---

## How it worked before this change

- On a sold-out variant, the product page hides "Add to cart" and shows an email form.
- The form posts to `/contact` as a Shopify customer form. The customer is tagged
  `restock-request` and `restock-{variant_id}`.
- The newsletter checkbox (optional) sets marketing consent.
- `theme.liquid` swaps the thank-you modal text to a back-in-stock message.
- **Nothing sends an email.** The tags have never been read by anything.
- Purple Dot is not in the theme code. It loads as an app embed and does not hold
  these sign-ups. Switching it off does not affect the waitlist.

## What this change fixes (theme only)

| Problem | Fix |
|---|---|
| Variant tag set only by JavaScript. If the script failed, the sign-up had no variant. | Variant tag rendered server-side for the variant on load; the script updates it on variant change. |
| Hand-written `<form>` with no spam protection | `{% form 'customer' %}`, which Shopify protects |
| Submit handler used `$` before jQuery loaded, so the thank-you text swap failed | Handler moved inside the jQuery ready block and delegated |
| "Add to cart" flashed on sold-out variants before the script ran | Hidden server-side when the variant is sold out |
| Typo "Add me to the newsletter list)" | "Also send me the Falcon newsletter" |
| No statement of how the email is used | One line under the button |

## Install (per store: UK, US, EU)

Test on a duplicate theme first.

1. Online Store → Themes → Duplicate the live theme.
2. On the duplicate, add `snippets/restock-notify-form.liquid` from this folder.
3. In `templates/product.liquid`:
   - Replace the whole `<form method="post" action="/contact" class="js-notify-form" ...>...</form>` block with
     `{% render 'restock-notify-form', product: product, current_variant: current_variant %}`
   - Add `{% unless current_variant.available %} style="display:none;"{% endunless %}` to the
     `.c-product-quantity` div and to the `.js-add-to-cart` input.
   - Replace the `<script>` block at the bottom (the `defer()` function and the separate
     `$('.js-notify-form').on('submit', ...)`) with the one in `templates/product.liquid` here.
   - `templates/product.liquid` in this folder is the full UK file. On US and EU, apply the
     three edits above rather than pasting the whole file, because Klarna locale and other
     store-specific lines differ.
4. `theme.liquid` cleanups:
   - **Remove Dotdigital** (no longer used): the `r1-t.trackedlink.net/_dmpt.js` script tag and the
     `_dmSetDomain('falconenamelware.com')` block. Dead third-party script loading on every page.
   - **UK only, Klarna:** the library tag is missing its spaces and does not load:
     `<scriptasyncsrc="https://eu-library.klarnaservices.com/lib.js"data-client-id="...">`
     should be
     `<script async src="https://eu-library.klarnaservices.com/lib.js" data-client-id="ac6af85e-d6d6-52d7-81b4-3c7eb2385f54"></script>`
     Check whether the US and EU `theme.liquid` have the same typo.

## Tests before publishing

| # | Test | Pass |
|---|---|---|
| 1 | Sold-out variant on load: form shows, no "Add to cart" flash | Form visible, button hidden |
| 2 | Switch between in-stock and sold-out variants | Form and button swap; hidden tag field shows the right variant ID |
| 3 | Submit with a new email | Customer created with `restock-request` and `restock-{id}`; thank-you modal shows back-in-stock copy |
| 4 | **Submit with an existing customer's email, on a second variant** | Second `restock-{id}` tag added. **If not, stop and report.** Returning customers would be silently dropped from the waitlist. |
| 5 | Submit with JavaScript disabled | Customer still gets the variant tag for the variant on load |
| 6 | Newsletter box ticked vs unticked | Marketing consent set only when ticked |

## Existing waitlist

Customers → filter by tag `restock-request`, on each store. Record:
- total sign-ups
- sign-ups per `restock-{variant_id}` tag
- sign-ups with `restock-request` but no variant tag (lost to the old JavaScript bug)

This is the list the sending system inherits. Do not send to it until the sender is proven on a
small variant (see Brief 03 deliverability).

## Sending: decision pending

Dotdigital is gone, so the sender needs choosing. Requirement: reach every sign-up, including
those who did not tick the newsletter box. That rules out Shopify Email, which only sends to
subscribed customers.

| Option | How | Reaches non-subscribers | Cost across 3 stores | Trade-off |
|---|---|---|---|---|
| A. Back-in-stock app | App replaces this form and sends | Yes | App fee x3 stores | Fastest. Waitlist has to be imported into the app; data lives in the app. |
| B. Flow + transactional email API (Brevo, Postmark or Resend) | Flow: stock goes above 0 → get customers tagged `restock-{id}` → HTTP request to the API per customer → swap tag to `restock-notified-{id}` | Yes | Free tier or low fee | Keeps this form and data in Shopify. Needs sending-domain authentication and the Flow built three times (exportable). |
| C. Flow + Shopify Email | Flow "Send marketing email" | **No** | Included | Fails the requirement. |

Before choosing B, confirm on each store: Flow's "Send HTTP request" action is available on
the plan, and how many customers one "Get customer data" step returns (a popular variant
could exceed it).
