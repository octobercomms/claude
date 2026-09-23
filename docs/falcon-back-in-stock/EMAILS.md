# Falcon Brevo templates

Five transactional templates for the Falcon stock system (ARCHITECTURE.md §7). Each `.html` file is pasted into Brevo as-is:
Brevo → Transactional → Templates → New template → **Paste your code**. Set the subject and preview text in the template settings as listed below. Save each template, note its numeric ID, and put the IDs in the Worker's `SHOPS[store].templates`.

| File | Brevo template name | Stores | `SHOPS.templates` key |
|---|---|---|---|
| `bis.html` | `Falcon – Back in stock` | UK, US, EU | `bis` |
| `delay-uk.html` | `Falcon – Pre-order date change (UK/EU)` | UK, EU | `delay_uk` |
| `delay-us-notice.html` | `Falcon – Preorder delay notice (US)` | US | `delay_us_notice` |
| `delay-us-consent.html` | `Falcon – Preorder delay, action needed (US)` | US | `delay_us_consent` |
| `staff.html` | `Falcon – Staff alert` | UK, US, EU | `staff` |

## Setup notes (read before pasting)

- **Template language.** All templates use Brevo's New Template Language: `{{ params.x }}` and `{% if params.x %}...{% else %}...{% endif %}`. No `{% elif %}` is used (the store switch in `bis.html` uses three separate `if` blocks) so nothing depends on less-documented syntax.
- **Empty values.** Pass optional params as `""` (or leave them out) to hide their block. `{% if %}` treats an empty string, `false` and a missing key as false. Pass `earlier` as JSON `true`/`false`, not the string `"false"` (a non-empty string is true).
- **Logo.** Every template shows `params.logo_url` if given, otherwise `https://REPLACE_ME.example.com/falcon-logo.png`. Before going live, either upload the logo to Brevo's image library and replace the `REPLACE_ME` URL in each file, or have the Worker always send `logo_url`. The image links to the storefront in `bis.html` only.
- **Preview text.** Each file carries its own hidden preheader `<div>` as the first thing in `<body>`. Leave Brevo's "Preview text" field empty, or delete the `<div>`, so it does not show twice.
- **Subjects with a condition.** `delay-uk.html` and `delay-us-notice.html` switch the subject on `params.earlier`. **VERIFY** that Brevo evaluates `{% if %}` in the subject field (it does evaluate `{{ params.x }}`). If it does not, set the subject to the "later date" version and have the Worker pass `subject` in the API body for `earlier` sends (**VERIFY** that Brevo honours `subject` alongside `templateId`).
- **Raw HTML in `staff.html`.** Brevo escapes params by default. The template uses `{% autoescape off %}{{ params.rows_html }}{% endautoescape %}`, which Brevo documents (help article 4402386448530). The pongo2 filter `{{ params.rows_html | safe }}` should also work but is **VERIFY**. The Worker must HTML-escape every value it puts inside `rows_html`.
- **Postal address.** No postal address is in the footers. If Falcon wants one (good practice; required by CAN-SPAM only for commercial mail, which these are not), add a line to each footer.
- **Reply-to.** The delay emails invite replies and the US notice says customers can cancel by replying. Set `replyTo` to a monitored inbox (e.g. `hello@falconenamelware.com`) and make sure a reply asking to cancel is handled like a click on `cancel_url` (tag `preorder-cancel-requested` and `preorder-cancel-requested-v{variant_id}` plus `preorder-cancel-requested-v{variant_id}-on-{YYYY-MM-DD}` for the item named in the email). A US reply saying "keep it" counts as express consent: tag `preorder-kept-v{variant_id}-{n}` by hand (n = the highest `preorder-delay-v{variant_id}-{n}` on the order). Tags are per item because an order can hold several pre-order items with separate delays.
- **DRY_RUN banner.** While the Worker's `DRY_RUN` is on, customer emails go to `staff_email` with a `dry_run_banner` param naming the real recipient; each customer template shows it in a yellow bar under the preheader (nothing renders when it is absent). Links in dry-run emails are marked as tests and the Worker makes no change when they are used.
- **Brevo settings.** Do not enable syncing marketing unsubscribes to transactional (research §1). One sender per store.

---

## 1. `bis.html`: Falcon – Back in stock

**Stores:** UK, US, EU (one template; `store` switches the footer link).
**Subject:** `Back in stock: {{ params.product_title }}` (works for all stores; no spelling differences)
**Preview text:** `You asked us to tell you when this was back. Here it is.`

| Param | Required | Example | Notes |
|---|---|---|---|
| `store` | yes | `uk` | `uk`, `us` or `eu`. Picks the storefront link in the logo and footer |
| `product_title` | yes | `Falcon Pie Dish 26cm` | |
| `variant_title` | no | `Pigeon Grey` | Send `""` for single-variant products (never `Default Title`) |
| `product_url` | yes | `https://www.falconenamelware.com/products/pie-dish?variant=44012345678901&utm_source=brevo&utm_medium=email&utm_campaign=back_in_stock` | Link to the variant |
| `image_url` | no | `https://cdn.shopify.com/s/files/1/0000/0000/products/pie-dish-grey.jpg?width=800` | Variant image, else product image. Block hidden if empty |
| `price` | no | `£22.00` | Pre-formatted in the store currency |
| `remove_url` | yes | `https://falcon-stock.example.workers.dev/u?t=eyJzIjoidWsi...` | Signed `/u` link |
| `logo_url` | no | `https://img.mailinblue.com/.../falcon-logo.png` | See setup notes |

**Copy note.** The Worker removes the `restock-{id}` tag when it sends this email, so the "Remove me" link is worded as "Didn't ask for this, or don't want back-in-stock emails from us?". `POST /u` removes **all** of the customer's `restock-{id}` tags, so the wording holds.

```json
{
  "store": "uk",
  "product_title": "Falcon Pie Dish 26cm",
  "variant_title": "Pigeon Grey",
  "product_url": "https://www.falconenamelware.com/products/pie-dish?variant=44012345678901",
  "image_url": "https://cdn.shopify.com/s/files/1/0000/0000/products/pie-dish-grey.jpg?width=800",
  "price": "£22.00",
  "remove_url": "https://falcon-stock.example.workers.dev/u?t=TEST",
  "logo_url": ""
}
```

## 2. `delay-uk.html`: Falcon – Pre-order date change (UK/EU)

**Stores:** UK and EU. British English.
**Subject:** `{% if params.earlier %}Good news: your pre-order {{ params.order_name }} is coming sooner{% else %}Your pre-order {{ params.order_name }} has a new date{% endif %}`
(later date: `Your pre-order #UK1234 has a new date`; earlier date: `Good news: your pre-order #UK1234 is coming sooner`)
**Preview text:** later: `Now expected {{ params.new_date }}. You can wait, or cancel for a full refund.` | earlier: `Now expected {{ params.new_date }}, earlier than we said.` (both are in the preheader `<div>`)

| Param | Required | Example | Notes |
|---|---|---|---|
| `order_name` | yes | `#UK1234` | |
| `order_status_url` | yes | `https://www.falconenamelware.com/12345/orders/abc123/authenticate?key=...` | Shopify order status page |
| `product_title` | yes | `Falcon Pie Dish 26cm` | |
| `variant_title` | no | `Pigeon Grey` | |
| `old_date` | yes | `12 November 2026` | Formatted `D Month YYYY` |
| `new_date` | yes | `10 December 2026` | Formatted `D Month YYYY` |
| `reason` | no | `The shipment from our factory left two weeks late.` | From `falcon.delay_reason`. Block hidden if empty |
| `cancel_url` | yes | `https://falcon-stock.example.workers.dev/c?t=...` | Signed `/c` link |
| `withdrawal_url` | EU only | `https://eu.falconenamelware.com/pages/withdrawal` | `""` on UK. Shows the "Withdraw from contract here" block |
| `earlier` | yes | `false` | Boolean. `true` = good-news wording, no apology |
| `logo_url` | no | | See setup notes |

```json
{
  "order_name": "#EU1042",
  "order_status_url": "https://eu.falconenamelware.com/12345/orders/abc123",
  "product_title": "Falcon Pie Dish 26cm",
  "variant_title": "Pigeon Grey",
  "old_date": "12 November 2026",
  "new_date": "10 December 2026",
  "reason": "The shipment from our factory left two weeks late.",
  "cancel_url": "https://falcon-stock.example.workers.dev/c?t=TEST",
  "withdrawal_url": "https://eu.falconenamelware.com/pages/withdrawal",
  "earlier": false,
  "logo_url": ""
}
```

## 3. `delay-us-notice.html`: Falcon – Preorder delay notice (US)

**Stores:** US. American English.
**When:** FTC first delay notice: first delay, definite new date no more than 30 days after the old date. **Also** use it with `earlier: true` for US orders whose date moves earlier (ARCHITECTURE §6 sends the "UK/EU-style update" for earlier dates; for US customers that should be this template, so the spelling and the 7-business-day refund are right).
**Subject:** `{% if params.earlier %}Good news: your preorder {{ params.order_name }} will ship sooner{% else %}Your preorder {{ params.order_name }}: new ship date {{ params.new_date }}{% endif %}`
(later: `Your preorder #US5678: new ship date December 10, 2026`; earlier: `Good news: your preorder #US5678 will ship sooner`)
**Preview text:** later: `Keep your order or cancel for a full refund. Your choice.` | earlier: `Now expected to ship by {{ params.new_date }}.`

| Param | Required | Example | Notes |
|---|---|---|---|
| `order_name` | yes | `#US5678` | |
| `order_status_url` | yes | `https://us.falconenamelware.com/12345/orders/abc123` | |
| `product_title` | yes | `Falcon Pie Dish 26cm` | |
| `variant_title` | no | `Pigeon Gray` | |
| `old_date` | yes | `November 12, 2026` | Formatted `Month D, YYYY` |
| `new_date` | yes | `December 10, 2026` | Must be a definite date. No date = use the consent template |
| `reason` | no | `The shipment from our factory left two weeks late.` | |
| `cancel_url` | yes | `https://falcon-stock.example.workers.dev/c?t=...` | |
| `earlier` | yes | `false` | Boolean |
| `logo_url` | no | | |

```json
{
  "order_name": "#US5678",
  "order_status_url": "https://us.falconenamelware.com/12345/orders/abc123",
  "product_title": "Falcon Pie Dish 26cm",
  "variant_title": "Pigeon Gray",
  "old_date": "November 12, 2026",
  "new_date": "December 10, 2026",
  "reason": "The shipment from our factory left two weeks late.",
  "cancel_url": "https://falcon-stock.example.workers.dev/c?t=TEST",
  "earlier": false,
  "logo_url": ""
}
```

## 4. `delay-us-consent.html`: Falcon – Preorder delay, action needed (US)

**Stores:** US. American English.
**When:** second or later delay, a first delay of more than 30 days, or no definite new date. Without a "Keep my order" click by `keep_by_date`, that item is cancelled and refunded (daily job tags `preorder-cancel-due-v{variant_id}` and alerts staff naming the item; staff refund within 7 business days). "Second or later" counts delays to this item in this order only.
**Subject:** `Action needed by {{ params.keep_by_date }}: your preorder {{ params.order_name }}`
**Preview text:** `Tell us to keep your order, or we'll cancel it and refund you in full.`

| Param | Required | Example | Notes |
|---|---|---|---|
| `order_name` | yes | `#US5678` | |
| `order_status_url` | yes | `https://us.falconenamelware.com/12345/orders/abc123` | |
| `product_title` | yes | `Falcon Pie Dish 26cm` | |
| `variant_title` | no | `Pigeon Gray` | |
| `old_date` | yes | `December 10, 2026` | The date last promised |
| `new_date` | no | `January 28, 2027` | `""` if there is no reliable date; the email then says so |
| `reason` | no | `Our factory has paused production of this color.` | |
| `keep_url` | yes | `https://falcon-stock.example.workers.dev/k?t=...` | Signed `/k` link |
| `keep_by_date` | yes | `December 9, 2026` | The date currently promised (`old_date`), or 7 days after the notice if that date is sooner. Set by the Worker; rule flagged for legal review |
| `cancel_url` | yes | `https://falcon-stock.example.workers.dev/c?t=...` | |
| `logo_url` | no | | |

```json
{
  "order_name": "#US5678",
  "order_status_url": "https://us.falconenamelware.com/12345/orders/abc123",
  "product_title": "Falcon Pie Dish 26cm",
  "variant_title": "Pigeon Gray",
  "old_date": "December 10, 2026",
  "new_date": "January 28, 2027",
  "reason": "The second shipment from our factory has been delayed.",
  "keep_url": "https://falcon-stock.example.workers.dev/k?t=TEST",
  "keep_by_date": "December 9, 2026",
  "cancel_url": "https://falcon-stock.example.workers.dev/c?t=TEST",
  "logo_url": ""
}
```

## 5. `staff.html`: Falcon – Staff alert

**Stores:** all (internal). Plain layout, no logo.
**Subject:** `{{ params.subject }}` (e.g. `Falcon UK | 2 pre-orders to refund by 7 October`)
**Preview text:** `{{ params.intro }}`

| Param | Required | Example | Notes |
|---|---|---|---|
| `subject` | yes | `Falcon UK \| Daily check: 3 items need attention` | Use a pipe or colon, no em dashes |
| `intro` | yes | `The daily check found these problems on the UK store.` | Plain text (escaped) |
| `rows_html` | yes | `<table>...</table>` | Raw HTML via `{% autoescape off %}`. Worker escapes values inside |

```json
{
  "subject": "Falcon UK | Daily check: 2 items need attention",
  "intro": "The daily check found these problems on the UK store.",
  "rows_html": "<table cellpadding=\"6\" cellspacing=\"0\" border=\"1\" style=\"border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;\"><tr><th align=\"left\">Issue</th><th align=\"left\">Item</th><th align=\"left\">Action</th></tr><tr><td>Cancel requested</td><td>#UK1234, Pie Dish 26cm Pigeon Grey</td><td>Refund by 7 October 2026</td></tr><tr><td>Missing preorder_limit</td><td>Mug 8cm White (44012345678901)</td><td>Set the limit or stop selling</td></tr></table>"
}
```
