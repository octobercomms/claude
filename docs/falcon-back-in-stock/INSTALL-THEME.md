# Falcon stock system: theme and notification install

For: Claude in Chrome, working in the Shopify admin. Do the whole list once per store, in this order: **UK first**, then US, then EU. Work on a **duplicate theme**; publish only after every test in section 9 passes.

Source files are in `dev/falcon-back-in-stock/theme/` in the repo. "Paste file X" means open that file in the repo, copy its full contents, and paste them.

Spec: `docs/falcon-back-in-stock/ARCHITECTURE.md` sections 3, 4, 5.

---

## 0. Before you start (per store)

Have these ready. Stop and ask if any is missing.

| Item | Where it comes from |
|---|---|
| Worker URL, for example `https://falcon-stock.falcon-enamelware.workers.dev` (no trailing slash) | Cloudflare dashboard > Workers & Pages > `falcon-stock` |
| Turnstile **site key** (public, starts `0x`). Not the secret key. | Cloudflare dashboard > Turnstile > the Falcon widget. Its hostname list must include `www.falconenamelware.com`, `us.falconenamelware.com`, `eu.falconenamelware.com` |
| All six variant metafield definitions from ARCHITECTURE §3: `falcon.expected_date` (date), `falcon.preorder_limit` (integer), `falcon.preorder_note` (single line text), `falcon.delay_reason` (single line text), `falcon.notified_date` (date, **Worker only**: staff never edit it), `falcon.delay_count` (integer, **Worker only**) | Settings > Custom data > Variants. Created in the main install. |
| One test product with four variants you can set up (in stock, preorder, sold out, misconfigured) | Section 8 |
| The store's **standard delivery rate** (the price a customer pays for one ordinary delivery), for the "Second delivery" product | Settings > Shipping and delivery > the store's main shipping rate. If there are several standard rates (by weight or zone), ask Falcon which one to charge for the second delivery |

The store's code editor: Online Store > Themes > (duplicate theme) > `...` > **Edit code**.

---

## 1. Duplicate the live theme

1. Online Store > Themes.
2. On the live theme: `...` > **Duplicate**. Rename the copy `Falcon stock test {date}`.
3. Do every step below on the **copy**. Use its **Preview** link for testing.

---

## 1a. Create the "Second delivery" product (split-delivery fee)

Mixed baskets (a pre-order item plus anything else) let the customer choose between one delivery when the pre-order arrives, or two deliveries (in-stock items now, the pre-order later) for an extra charge. That charge is a normal product line in the cart. One per store; the Worker reads the same product.

Products > **Add product**:

| Field | Value |
|---|---|
| Title | `Second delivery` (exactly; the order confirmation block recognises it by this title, its handle and its SKU) |
| Description | UK/EU: `Extra delivery charge so your in-stock items can ship now and your pre-order ships when it arrives.` US: `Extra delivery charge so your in-stock items can ship now and your preorder ships when it arrives.` |
| Price | the store's standard delivery rate (section 0), in the store's currency. No compare-at price |
| Charge tax | same setting as the store's shipping rates (ask Falcon if unsure) |
| SKU | `SECOND-DELIVERY` |
| Inventory | **untick** "Track quantity" (no inventory tracking) |
| Shipping | **untick** "This is a physical product" |
| Variants | none (a single Default Title variant) |
| Search engine listing > URL handle | `second-delivery` (exactly; the cart looks the price up by this handle) |
| Collections | none. Also check every **automated** collection's conditions (Products > Collections): if any would pull this product in (for example "price greater than 0", "all products"), add a condition that excludes it, such as "Title is not equal to Second delivery", and report which collections you changed |
| Sales channels | **Online Store must stay on** (the cart adds it with `/cart/add.js`, which only works for products published to the Online Store). Turn off Google & YouTube, Facebook & Instagram, Shop and any feed apps |

Hide it from the storefront:

1. **Status:** if the Status box offers **Unlisted**, choose it (stays buyable by direct link and the cart, hidden from search, collections and recommendations). Otherwise choose **Active** and do step 2.
2. **Search:** if the status is Active (not Unlisted), hide it from storefront search and the sitemap with the `seo.hidden` metafield: Settings > Custom data > Products > Add definition, namespace and key `seo.hidden`, type Integer; then on the product set it to `1`. (If the definition already exists, just set the value.)
3. Feedoptimise: if the feed pulls every product, exclude handle `second-delivery` there (report it; do not change feed settings without instruction).
4. Save. Copy the **variant id**: open `https://{store domain}/products/second-delivery.js` in the browser and copy `variants[0].id` (a long number, for example `44012345678901`; not the product `id` at the top). If that URL shows a 404, the product is not on the Online Store channel or the handle is wrong: fix that first. Keep the id for section 2.

---

## 2. Create the snippets

In Edit code > **Snippets** > **Add a new snippet**. Enter the name without `.liquid`; Shopify adds it.

| Snippet name | Paste file | Notes |
|---|---|---|
| `falcon-config` | `snippets/falcon-config.liquid` | Then edit per store, see below |
| `falcon-variant-data` | `snippets/falcon-variant-data.liquid` | Same on all stores |
| `preorder-message` | `snippets/preorder-message.liquid` | Same on all stores |
| `preorder-cart-line` | `snippets/preorder-cart-line.liquid` | Same on all stores |
| `delivery-choice` | `snippets/delivery-choice.liquid` | Same on all stores |
| `restock-notify-form` | `snippets/restock-notify-form.liquid` | **Already exists** on the store: open it, select all, replace with the file contents |

### Edit `falcon-config` per store

1. Replace `https://falcon-stock.<account>.workers.dev` with the real Worker URL (no trailing slash).
2. Replace `REPLACE_ME_TURNSTILE_SITEKEY` with the Turnstile site key.
3. **US store:** change the four lines under `UK store` to:
   ```liquid
   {%- assign falcon_store = 'us' -%}
   {%- assign falcon_preorder_label = 'Preorder' -%}
   {%- assign falcon_date_format = '%B %-d, %Y' -%}
   {%- assign falcon_add_label = 'Add to cart' -%}
   ```
4. **EU store:** change only `falcon_store` to `'eu'`. Everything else stays as UK.
5. Replace `REPLACE_ME_SPLIT_FEE_VARIANT_ID` with this store's "Second delivery" variant id from section 1a. Keep the quotes: `{%- assign falcon_split_fee_variant_id = '44012345678901' -%}`. It is **different on every store**.
6. Save. Search the file for `REPLACE_ME` and `<account>`: there must be no matches outside the comment block at the top.

---

## 3. Edit `templates/product.liquid`

The repo file `templates/product.liquid` is the finished **UK** template. On every store, including UK, **apply the edits below** rather than pasting the whole file: the live file may differ (Klarna locale on US/EU, recent changes). Use the repo file to check your result.

Use the editor's search (Ctrl/Cmd+F) for each "Find" text. Each should match exactly once. If a Find text is not found, stop and report what the file has instead.

### Edit 3.1: settings and server-rendered state

Find:
```liquid
    {% assign current_variant = product.variants.first %}
  {% endif %}
```
Directly after that `{% endif %}`, add:
```liquid

  {% comment %} Falcon stock system: per-store settings and the state of the variant on load (works with JavaScript off). {% endcomment %}
  {% include 'falcon-config' %}
  {%- capture falcon_state_raw -%}
    {%- render 'falcon-variant-data', mode: 'state', product: product, variant_id: current_variant.id, date_format: falcon_date_format -%}
  {%- endcapture -%}
  {% assign falcon_state_parts = falcon_state_raw | strip | append: '|||| ' | split: '|' %}
  {% assign falcon_state = falcon_state_parts[0] | strip | default: 'notify' %}
  {% assign falcon_date_iso = falcon_state_parts[1] | strip %}
  {% assign falcon_date_label = falcon_state_parts[2] | strip %}
  {% assign falcon_max_qty = falcon_state_parts[3] | strip %}
  {% assign falcon_note = '' %}
  {% if falcon_state == 'preorder' %}
    {% assign falcon_note = current_variant.metafields.falcon.preorder_note.value | default: '' | strip %}
  {% endif %}
```
(`include`, not `render`, for `falcon-config`: its variables must be visible to the rest of the template.)

### Edit 3.2: notify form

Find:
```liquid
{% render 'restock-notify-form', product: product, current_variant: current_variant %}
```
Replace with:
```liquid
{% render 'restock-notify-form', product: product, current_variant: current_variant, state: falcon_state, store: falcon_store, worker_url: falcon_worker_url, turnstile_sitekey: falcon_turnstile_sitekey %}
```
If the store still has the older hand-written form instead (`<form method="post" action="/contact" class="js-notify-form"` ... `</form>`), replace that whole form block, and any wrapper `div` with class `js-notify-wrap` around it, with the line above.

### Edit 3.3: quantity block visibility

Find:
```liquid
<div class="c-product-quantity u-margin-bottom"{% unless current_variant.available %} style="display:none;"{% endunless %}>
```
Replace with:
```liquid
<div class="c-product-quantity u-margin-bottom"{% if falcon_state == 'notify' %} style="display:none;"{% endif %}>
```
If the store's div has no `{% unless current_variant.available %}` part (older version: `<div class="c-product-quantity u-margin-bottom">`), replace that instead.

### Edit 3.4: quantity cap

Find:
```liquid
<input class="c-quantity-selector__input js-quantity-input" name="quantity" type="number" value="1" min="1" />
```
Replace with:
```liquid
<input class="c-quantity-selector__input js-quantity-input" name="quantity" type="number" value="1" min="1"{% if falcon_max_qty != blank %} max="{{ falcon_max_qty }}"{% endif %} />
```

### Edit 3.5: preorder message (inside the add-to-cart form)

Find (inside the `<form action="/cart/add" ...>`):
```liquid
<div class="c-product__btn">
```
Directly **before** that line, add (keep the tab indentation of the surrounding lines):
```liquid
{% render 'preorder-message', state: falcon_state, date_iso: falcon_date_iso, date_label: falcon_date_label, note: falcon_note, preorder_label: falcon_preorder_label %}

```

### Edit 3.6: button label and visibility

Find:
```liquid
<input type="submit" value="Add to cart" class="c-btn c-btn--brand e-h4 u-width-1/1 js-add-to-cart"{% unless current_variant.available %} style="display:none;"{% endunless %}
```
Replace with:
```liquid
<input type="submit" value="{% if falcon_state == 'preorder' %}{{ falcon_preorder_label }}{% else %}{{ falcon_add_label }}{% endif %}" class="c-btn c-btn--brand e-h4 u-width-1/1 js-add-to-cart"{% if falcon_state == 'notify' %} style="display:none;"{% endif %}
```
Only this first line changes. **Leave the `onclick="dataLayer.push(...)"` GA4 code on the following lines exactly as it is.** If the store's line has no `{% unless current_variant.available %}` part, replace the line as it is.

### Edit 3.7: variant data and the product script

Find the script block near the end of the `<section>` that starts:
```html
<script type="text/javascript">

    (function defer() {
```
and ends at its closing `</script>` (the one just before `</section>`). It contains `new Shopify.OptionSelectors('product-select'`.

Select from `<script type="text/javascript">` down to and including that `</script>`, and replace it with the repo file's block that starts at:
```liquid
{% comment %} Falcon stock system: per-variant state for the script below (inventory is not in product | json). {% endcomment %}
```
and ends at the `</script>` just before `</section>`. This block is the same on all three stores.

If the old template also has a separate handler outside that block, `$('.js-notify-form').on('submit', ...)` or anything writing `restockNotifySubmitted`, delete it too.

### Check after saving

1. Save. Shopify must show no Liquid error.
2. Search the file: `restockNotifySubmitted` and `js-notify-tags` must have **no** matches. `falcon_state` must have several.
3. Compare with the repo's `templates/product.liquid` around each edit. Everything else (Klarna block, accordion, share links, reviews, Feedoptimise script, Shogun lines) must be unchanged.

---

## 4. Other files that used the old notify form

Search all theme files (Edit code search, or open likely files) for `restock-notify-form`, `js-notify-form`, `js-notify-tags` and `restockNotifySubmitted`.

- Any other template that renders `restock-notify-form` (for example `product.alternate.liquid`, a quick-view snippet): report it. Do not change it without instruction; it needs the same edits as section 3.
- `theme.liquid`: see section 6.

---

## 5. Cart page

The cart template is `templates/cart.liquid`, or `sections/cart-template.liquid` if `cart.liquid` only contains `{% section 'cart-template' %}`. Open whichever holds the `{% for item in cart.items %}` loop.

### 5.1 Line properties

1. Inside `{% for item in cart.items %}`, find where the line's variant is shown (look for `item.variant.title`, or `item.product.title` if there is no variant line).
2. Check whether the loop already prints properties: search the file for `item.properties`.
   - **If it already prints them** and the loop skips names starting with `_` (it has `first_char != '_'` or `slice: 0` with `'_'`), leave it and skip step 3.
   - **If it prints them without skipping `_` names**, delete that `{% for p in item.properties %}` ... `{% endfor %}` block (and any `{% unless item.properties == empty %}` wrapper) and do step 3.
   - **If it does not print them**, do step 3.
3. Directly after the element that shows the variant title, add:
   ```liquid
   {% render 'preorder-cart-line', item: item %}
   ```

### 5.2 Settings at the top of the cart file

At the very top of the cart file (above its first line), add:
```liquid
{% include 'falcon-config' %}
```
(`include`, not `render`: the rest of the file needs `falcon_store` and `falcon_split_fee_variant_id`.)

### 5.3 Basket notice and delivery choice

Find the checkout button: search for `name="checkout"`. Directly **before** the element that contains it (outside the items loop, but **inside** the cart `<form>` if the button is inside it), add:
```liquid
{% render 'preorder-cart-line', mode: 'notice', cart: cart, store: falcon_store, fee_variant_id: falcon_split_fee_variant_id %}
{% render 'delivery-choice', cart: cart, store: falcon_store, fee_variant_id: falcon_split_fee_variant_id %}
```
How it behaves:
- The choice shows only for a **mixed basket**: at least one line with a pre-order date plus at least one in-stock line without one (the "Second delivery" line does not count). "Ship everything together..." is selected by default.
- Choosing an option saves the cart attribute `Delivery preference` (`Ship together` or `Ship separately`), adds or removes the "Second delivery" line, then reloads the page. The checkout buttons are disabled while it updates.
- On every cart page load the snippet checks the cart and fixes it: no longer mixed, so the fee line and the attribute are removed; mixed with no choice saved, so `Ship together` is saved; `Ship separately` without the fee line, so it is added; fee quantity always 1.
- **Fee price:** taken from the fee line if it is in the cart, otherwise from `all_products['second-delivery']` (the variant whose id matches `falcon_split_fee_variant_id`). Vintage themes cannot look a product up by variant id, only by handle, so the handle must be exactly `second-delivery`. If no price can be found (wrong handle or id, product not on the Online Store channel), the choice is **not shown** and the order ships together. It never shows a guessed price.
- With JavaScript off the choice is hidden (it cannot add the fee) and the order ships together.
- The radio buttons have no `attributes[...]` name on purpose: a plain form submit cannot save "Ship separately" without adding the fee.

### 5.4 Lock the "Second delivery" line

The customer must not change the fee line's quantity or remove it; the snippet manages it. The cart file is not in the repo, so make these edits inside the `{% for item in cart.items %}` loop.

1. Directly after the `{% for item in cart.items %}` line, add:
   ```liquid
   {%- assign falcon_line_variant = item.variant_id | append: '' -%}
   {%- assign falcon_is_fee = false -%}
   {%- if falcon_line_variant == falcon_split_fee_variant_id -%}{%- assign falcon_is_fee = true -%}{%- endif -%}
   ```
2. **Quantity selector.** Find the line's quantity input (search inside the loop for `updates[` or `name="quantity"`; usually a `c-quantity-selector` span with + and - buttons around it). Note the input's exact `name` (`updates[]`, `updates[{{ item.key }}]` or `updates[{{ item.id }}]`). Wrap the **whole** selector (buttons and input) like this, using that same `name`:
   ```liquid
   {% if falcon_is_fee %}
     <input type="hidden" name="updates[]" value="{{ item.quantity }}">
     <span class="c-cart-fee-qty">{{ item.quantity }}</span>
   {% else %}
     ...the existing quantity selector, unchanged...
   {% endif %}
   ```
   Do **not** simply delete the fee line's input: with `name="updates[]"` Shopify matches quantities to lines by position, and a missing input would change the wrong line's quantity.
3. **Remove link.** Find the line's remove link or button (search inside the loop for `remove`, `change?line=` or `quantity=0`). Wrap it:
   ```liquid
   {% unless falcon_is_fee %}
     ...the existing remove link, unchanged...
   {% endunless %}
   ```
4. **Product links (optional, recommended).** If the line title and image link to `{{ item.url }}`, wrap each `<a href="{{ item.url }}" ...>` / `</a>` pair so the fee line shows plain text: `{% unless falcon_is_fee %}<a href="{{ item.url }}">{% endunless %}` ... `{% unless falcon_is_fee %}</a>{% endunless %}`.
5. Save. Report the exact names you found (quantity input name, remove link markup).

### 5.5 Quick cart / cart modal in `layout/theme.liquid`

1. Search `theme.liquid` for `js-quick-cart-item`. It sits inside a `{% for item in cart.items %}` loop.
2. Inside that loop, after the element showing the product or variant title, add:
   ```liquid
   {% render 'preorder-cart-line', item: item %}
   ```
3. After the loop's `{% endfor %}`, before the quick cart's checkout or "view cart" link, add:
   ```liquid
   {% render 'preorder-cart-line', mode: 'notice', cart: cart %}
   ```
   (`falcon-config` is not loaded in `theme.liquid`; the notice recognises the fee line by its handle `second-delivery` instead.)
4. **Lock the fee line here too**, the same way as 5.4 steps 2 and 3, but with this check at the top of the loop (no config needed):
   ```liquid
   {%- assign falcon_is_fee = false -%}
   {%- if item.product.handle == 'second-delivery' -%}{%- assign falcon_is_fee = true -%}{%- endif -%}
   ```
   If the quick cart's quantity buttons are handled by `app.js` with AJAX (no `updates[]` form), just wrap the buttons and remove link in `{% unless falcon_is_fee %}` ... `{% endunless %}`.
5. **Do not** render `delivery-choice` in the quick cart. It reloads the page after every change and reconciles the cart on load, which would fight `app.js`. The choice is made on the cart page; the quick cart notice shows the saved choice.
6. **Known limitation, report it, do not try to fix:** after an AJAX add to cart, `assets/app.js` builds a new row from the `js-quick-cart-ghost` template using data from `/cart.js`. We do not have `app.js` in the repo, so that row will not show the "Pre-order: Ships from ..." line or the notice until the page is reloaded, and a ghost row for the fee line will still show its quantity buttons. The cart page and checkout always show them. Report what you see in test 9.12.
7. **Report:** does the quick cart have its own **checkout** button (not only "view cart")? A customer who checks out from the quick cart never loads the cart page, so the choice and the clean-up in 5.3 do not run. See section 11.

---

## 6. `layout/theme.liquid` removals and fix

Save a copy first: select all in `theme.liquid`, copy, and keep it in a note until the store is tested.

1. **Dotdigital script tag.** Search `r1-t.trackedlink.net/_dmpt.js`. Delete the whole `<script ...></script>` tag that loads it.
2. **Dotdigital domain block.** Search `_dmSetDomain('falconenamelware.com')`. Delete the whole `<script> ... </script>` block that contains it. If that `<script>` block contains other, unrelated code, delete only the Dotdigital lines (`_dmSetDomain`, `_dmTrack`, and similar `_dm` calls).
3. **Old back-in-stock modal swap.** Search `restockNotifySubmitted`. Delete the inline `<script> ... </script>` that reads it from `sessionStorage` and swaps the thank-you modal text. If that block also does something else, delete only the `restockNotifySubmitted` part and report it.
4. **UK only, Klarna tag.** Find:
   ```html
   <scriptasyncsrc="https://eu-library.klarnaservices.com/lib.js"data-client-id="ac6af85e-d6d6-52d7-81b4-3c7eb2385f54"></script>
   ```
   Replace with:
   ```html
   <script async src="https://eu-library.klarnaservices.com/lib.js" data-client-id="ac6af85e-d6d6-52d7-81b4-3c7eb2385f54"></script>
   ```
   On US and EU, search for `scriptasyncsrc`. If found, fix the same way (keep that store's own URL and client id) and report it. If not found, change nothing.
5. The quick cart insertions from 5.5.
6. Save. Check: searching for `_dm`, `trackedlink` and `restockNotifySubmitted` finds nothing.

---

## 7. Notification templates

Settings > Notifications > **Customer notifications**. These are store-wide (not per theme), so edits go live on save. Copy the whole existing template into a note before editing, so it can be restored.

### 7.1 Order confirmation

1. Open **Order confirmation** > **Edit code**.
2. Search for `Order summary`. It is inside an `<h3>` inside a `<table class="row section">`.
3. Put the cursor directly **before** that `<table class="row section">` opening tag (the one whose content includes `Order summary`).
4. Paste the whole of `notifications/order-confirmation-preorder-block.liquid`.
5. Check the existing line loop still shows properties: in the order summary, the template has a `{% for property in line.properties %}` loop that skips `_` names. Leave it. It is what shows "Pre-order: Ships from 12 November 2026" under the item.
6. The block also reads the order attribute `Delivery preference` (saved by the cart's delivery choice). For mixed orders it ends with "Everything in this order will ship together when the pre-order arrives." (together, or no attribute) or "In-stock items ship now. Pre-order items ship when they arrive." (separately). The "Second delivery" line is ignored by the block but still listed normally in the order summary with its price.
7. Save.

### 7.2 Shipping confirmation

1. Open **Shipping confirmation** > **Edit code**.
2. Search for `Items in this shipment`. It is inside an `<h3>` inside a `<table class="row section">`.
3. Directly **before** that `<table class="row section">` opening tag, paste the whole of `notifications/shipping-confirmation-preorder-block.liquid`.
4. Save.

The block picks UK, US or EU wording from the store currency (GBP, USD, EUR). The same file goes into all three stores.

**Preview does not help here**: Shopify's preview uses a sample order without `_preorder_date`, so the block shows nothing in preview. Test with a real test order (9.14 and 9.15).

---

## 8. Staff setup for the test product (per store)

On the test product (hidden from the storefront or in a draft-accessible state):

| Variant | Inventory tracked | Continue selling when out of stock | Quantity | `falcon.expected_date` | `falcon.preorder_limit` | `falcon.preorder_note` |
|---|---|---|---|---|---|---|
| A: in stock | Yes | No | 5 | blank | blank | blank |
| B: preorder | Yes | Yes | 0 | a date 6+ weeks ahead | 3 | `From the January container` |
| C: sold out | Yes | No | 0 | blank | blank | blank |
| D: misconfigured | Yes | Yes | 0 | blank | blank | blank |

---

## 9. Test checklist (Preview of the duplicate theme)

Record pass/fail for each. On any fail, stop and report the step, what you expected and what you saw (include a screenshot and any console error).

| # | Test | Expected |
|---|---|---|
| 9.1 | Load the product page with `?variant={A}` | "Add to cart" button, quantity shown, no notify form, no preorder message |
| 9.2 | Load with `?variant={B}` | Button reads **Pre-order** (US: **Preorder**). Above it: "Ships from {date}. Payment taken today." with the date in the store's format (UK/EU `12 November 2026`, US `November 12, 2026`) and the note line. No notify form |
| 9.3 | Load with `?variant={C}` | No button, no quantity. Notify form with email field, unticked "Also send me the Falcon newsletter", Turnstile widget, privacy line |
| 9.4 | Load with `?variant={D}` | Same as 9.3 (misconfigured continue-selling variant is **not** buyable) |
| 9.5 | Switch A > B > C > D > A with the option swatches | Each variant shows the same state as its own page load in 9.1 to 9.4, with no flash of the wrong button. The URL `?variant=` updates |
| 9.6 | **JavaScript off** (Chrome DevTools > Settings > Debugger > Disable JavaScript), reload 9.1, 9.2, 9.3 | Same states as with JavaScript on. On C, the form shows the "Please turn on JavaScript" line. Turn JavaScript back on after |
| 9.7 | On B, DevTools > Elements: inspect the two hidden inputs in `.js-preorder-wrap` | Both **not** disabled; `properties[_preorder_date]` = ISO date, `properties[Pre-order]` (US `properties[Preorder]`) = `Ships from {label}` |
| 9.8 | On A, same inspection | Both inputs have the `disabled` attribute |
| 9.9 | On B, DevTools > Network, filter `cart/add`. Click Pre-order | Request to `/cart/add.js` or `/cart/add`. Its payload (Payload tab) includes `properties[_preorder_date]` and `properties[Pre-order]` / `properties[Preorder]`. **If they are missing, `app.js` is not sending the whole form: stop and report. Open `assets/app.js`, search for `cart/add`, and copy the surrounding 30 lines into the report. Do not publish.** |
| 9.10 | On A, add to cart, same Network check | Payload has `id` and `quantity` and **no** `properties[...]` |
| 9.11 | Cart page after 9.9 and 9.10 (A and B in the cart) | B's line shows "Pre-order: Ships from {date}" (US "Preorder: ..."). `_preorder_date` is **not** shown. Basket notice shows: "Everything ships together when the pre-order arrives." (US: "preorder") and the Delivery box shows (details in 9.24). Then remove A: after the reload the notice reads "Pre-order items ship when they arrive." (US: "Preorder items ...") and there is no Delivery box. Add A back for the next tests |
| 9.12 | Quick cart / cart modal right after 9.9, then after a page reload | After reload: same line and notice as 9.11. Before reload: record whether the new row shows the property (known limitation, see 5.5 step 6) |
| 9.13 | Quantity cap on B (limit 3, quantity 0) | The quantity cannot go above 3: type 10 and tab out, it resets to 3; the + button stops at 3. On A (quantity 5) it stops at 5 |
| 9.14 | Notify form on C: submit with a bad email, then with your test email and the newsletter box unticked | Bad email: inline error, no request. Good email: button disabled while sending, then "Thanks. We'll email you once, when this is back in stock." Customer (Customers > search email) is tagged `restock-request` and `restock-{C id}`, and email marketing is **not** subscribed |
| 9.15 | Repeat 9.14 on D with the box ticked, same email | Tag `restock-{D id}` added (first tag kept); marketing now subscribed |
| 9.16 | Switch from C to D after a successful sign-up | Form resets for D (fields visible again, no success text) |
| 9.17 | Place a test order with A and B together, leaving the delivery choice on "Ship everything together". On a live store use a real card for a low-value order (set the test product's price low for the test) and refund it afterwards; never switch a live store's payment provider to the Bogus/test gateway (real customers would check out with it). A development store may use test payments | Order confirmation email: "About your pre-order" box listing B with "Pre-order: expected to ship from {date}.", the "We'll email you..." sentence, and "Everything in this order will ship together when the pre-order arrives." (US "preorder"). The order summary shows "Pre-order: Ships from {date}" under B. Admin order page > Additional details: `Delivery preference: Ship together` |
| 9.18 | Order with only B | Same box without the "Everything in this order..." sentence |
| 9.19 | Fulfil only A on the order from 9.17 | Shipping confirmation: no "on its way" pre-order line; "Still to come from this order" lists B with its date |
| 9.20 | Then fulfil B | Shipping confirmation: "Your pre-order is on its way. Thank you for waiting." and no "Still to come" |
| 9.21 | Browser console on the product page | No errors from the Falcon script or Turnstile |
| 9.22 | Page source (Ctrl/Cmd+U): search `FalconVariantData` | One JSON block; paste it into a JSON validator: valid |
| 9.23 | `theme.liquid` checks from 6.6; Klarna badge still shows on UK product page | Pass |
| 9.24 | Cart with A and B (mixed basket) | Under the notice: a "Delivery" box with two options, "Ship everything together when the pre-order arrives. One delivery." **selected**, and "Ship in-stock items now and the pre-order when it arrives. Adds a second delivery charge of {price}." with the price of the "Second delivery" product in the store's currency (US: "preorder"). Notice reads "Everything ships together when the pre-order arrives." No "Second delivery" line. DevTools > Network: `/cart/update.js` was sent once with `attributes[Delivery preference]` = `Ship together`, and `/cart.js` shows that attribute |
| 9.25 | Choose "Ship in-stock items now..." | Options and checkout button disabled briefly, then the page reloads. One "Second delivery" line, quantity 1, at the fee price, with **no** quantity buttons and **no** remove link, and no product link. Notice: "Pre-order items ship separately when they arrive. Anything in stock ships now." Second option selected. Network: one `update.js`, one `add.js`, no duplicates even if you click the option twice quickly |
| 9.26 | Choose "Ship everything together..." again | Page reloads; the "Second delivery" line is gone; first option selected; notice back to "Everything ships together..." |
| 9.27 | Choose separately again, then remove **B** from the cart | After the page reloads (it may reload twice), the "Second delivery" line and the Delivery box are gone; `/cart.js` has no `Delivery preference` attribute |
| 9.28 | Choose separately, then in DevTools console run `jQuery.post('/cart/change.js', {id: '{fee variant id}', quantity: 3})` and reload the cart page | Page corrects itself to one fee line, quantity 1 |
| 9.29 | With separately chosen, open `/products/second-delivery` and add it again, then open the cart | Still exactly one fee line, quantity 1. Store search for `second delivery` finds nothing; the product is in no collection page |
| 9.30 | Mixed basket, separately chosen: click checkout | Checkout order summary lists "Second delivery" at the fee price as a line item, and shipping is charged as usual. Place the order (see 9.17 for payment rules): confirmation email says "In-stock items ship now. Pre-order items ship when they arrive."; admin Additional details shows `Delivery preference: Ship separately` |
| 9.31 | Express checkout that skips the basket: on the product page for B use a dynamic "Buy it now" / Shop Pay / Apple Pay button if the theme shows one (otherwise note "no express button on the product page" and skip). Also: put A and B in the cart, and in DevTools run `jQuery.post('/cart/update.js', {'attributes[Delivery preference]': ''})`, then click an express button in the cart **without reloading** | The order has **no** `Delivery preference` attribute (admin Additional details) and no fee line; it is treated as together: the confirmation says "Everything in this order will ship together..." (for the product-page order with only B, no delivery sentence at all) |
| 9.32 | Set `falcon_split_fee_variant_id` back to `REPLACE_ME_SPLIT_FEE_VARIANT_ID` temporarily, load the mixed cart | No Delivery box, no errors in the console; notice says "Everything ships together...". Restore the real id after |

Clean up afterwards: cancel and refund the test orders (in full, so the card is repaid); remove the test tags from your test customer; reset the test product variants.

---

## 10. Publish and roll back

1. Only when all tests pass: Online Store > Themes > the duplicate > **Publish**. Keep the old theme (unpublished) for at least two weeks.
2. Roll back: publish the old theme again. Notification templates are not part of the theme: restore them by pasting back the copies saved in section 7.

## 11. Known limits to report, not fix

- **Quick cart checkout skips the delivery clean-up.** The choice and the reconcile run on the cart page only. A customer who removes the pre-order item in the quick cart (AJAX, `app.js`) and checks out from the quick cart could keep a stale "Second delivery" line; one who fills a mixed basket and checks out from the quick cart gets no attribute (treated as together, no fee). If the quick cart has its own checkout button (5.5 step 7), report it: pointing that button at `/cart` for baskets with a pre-order line would close the gap, but needs a decision.
- A theme cart form that posts quantity changes **and** goes to checkout in one click (`name="checkout"` submit after editing a quantity) skips the reload, so the clean-up does not run before checkout. Same exposure as above.

- `app.js` is not in the repo. Whether it sends line item properties (9.9) and how it renders the quick cart ghost row (9.12) can only be checked live.
- The notify form needs JavaScript (Turnstile). With JavaScript off it shows a message and does not submit.
- Time zones: the theme's "today" check uses the shop's time zone, the Worker uses UTC. Around midnight they can disagree by one day about whether a date has passed. Accepted.
- Page caching: the "today" check for preorder dates uses the shop's timezone when the page was rendered. A variant whose date passes becomes "notify" once Shopify re-renders the page (usually within minutes).
