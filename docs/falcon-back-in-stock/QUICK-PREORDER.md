# Quick pre-order: Carafe on the UK store (interim, about 1 hour)

**For:** Claude in Chrome, or whoever edits the UK Shopify admin.
**Store:** UK only (www.falconenamelware.com).
**What it does:** a sold-out Carafe shows a **Pre-order · Ships by 14 Dec** button with "Expected to ship 11 to 14 December. Payment is taken today." directly under it, before it goes in the basket. The order records the date, is tagged `preorder`, and is held so nobody ships it early.
**What it does not do (until the full system is installed):** no automatic emails when the date changes, no automatic release when stock arrives (staff release the holds by hand), no partial holds (an order with other items is held as a whole; the product page says so).

The data fields use the same names as the full system (`docs/falcon-back-in-stock/ARCHITECTURE.md`), so nothing here is redone later.

---

## How a product is switched on and off

There is no tag. A colour (variant) is on pre-order when **all three** are true:

1. it has no stock available to sell (0 or below; stock on a transfer or purchase order counts as incoming, not available, so that is fine),
2. **Continue selling when out of stock** is ticked, and
3. an **Expected date** is filled in, on the product (covers every colour) or on the colour itself.

To switch **on**: tick Continue selling and fill in the Expected date. To switch **off**: untick Continue selling, or clear the date. When stock is received and available goes above 0, the colour goes back to a normal **Add to cart** on its own.

If Continue selling is ticked but no date is filled in, the site shows **Notify me** and does not sell it.

## Step 1. Data fields (5 min)

1. **Settings** > **Custom data** > **Products** > **Add definition**. Create two:

   | Name | Namespace and key | Type |
   |---|---|---|
   | Expected date | `falcon.expected_date` | **Date** |
   | Pre-order note | `falcon.preorder_note` | **Single line text** |

2. **Settings** > **Custom data** > **Variants** > **Add definition**. Create three (same keys, so a colour can override the product):

   | Name | Namespace and key | Type |
   |---|---|---|
   | Expected date | `falcon.expected_date` | **Date** |
   | Pre-order note | `falcon.preorder_note` | **Single line text** |
   | Pre-order limit | `falcon.preorder_limit` | **Integer** |

   If any already exists with the same key, leave it.

## Step 2. Set up the Carafe (5 min)

1. **Products** > Carafe. At the bottom of the product page, under **Metafields**:
   - **Expected date**: `14 December 2026`
   - **Pre-order note**: `Expected to ship 11 to 14 December.`
   **Save**.
2. For **each colour**: click the variant.
   - **Inventory**: **Track quantity** on. Tick **Continue selling when out of stock**. Leave available as it is (0 or below).
   - **Metafields** > **Pre-order limit**: the number of units of this colour coming in, less any already promised. When that many have been pre-ordered, the site switches the colour to **Notify me** on its own.
   - **Save**.
   (Faster for many colours: select the variants in **Products** > **Bulk edit** and add the **Continue selling when out of stock** column.)

Expected: nothing changes on the live site yet (the theme does not read these until Step 3 is published). The variant can now be bought, so do Steps 3 and 4 straight away.

## Step 3. Theme (20 min)

1. **Online Store** > **Themes** > live theme **...** > **Duplicate**. Work on the copy. On the copy: **...** > **Edit code**.
2. **Snippets** > **Add a new snippet** > name `falcon-quick-preorder` > paste the whole of the code in **Appendix A** > **Save**.
3. Open **Templates** > `product.liquid` (the product template; it contains `class="c-product__btn"`).
4. Find:
   ```html
   <div class="c-klarna">
   ```
   Directly **above** it (so below the add-to-cart button, still inside the `<form action="/cart/add" ...>`), on its own line, paste:
   ```liquid
   {% render 'falcon-quick-preorder', product: product %}
   ```
5. Near the bottom, find this block inside `onVariantSelected`:
   ```js
   if (variant.available) {
       $('.js-add-to-cart').show().removeAttr('disabled').val('Add to Cart')
   ```
   Replace those two lines with:
   ```js
   var poState = window.falconPreorder ? window.falconPreorder(variant) : 'normal'
   if (variant.available && poState !== 'blocked') {
       $('.js-add-to-cart').show().removeAttr('disabled').val(poState === 'preorder' ? window.FalconPreorderData[variant.id].button : 'Add to Cart')
   ```
   Leave everything else in that block as it is (the `else` branch still shows the Notify me form).
6. **Save**.

## Step 4. Flow: tag and hold pre-order orders (10 min)

1. **Apps** > **Flow** > **Create workflow**.
2. **Trigger**: **Order created**.
3. **Condition**: **Order** > **Line items** > **Custom attributes** > **Key** **is equal to** `_preorder_date`. Choose **At least one of**.
   If the builder will not do this, use instead: **Order** > **Line items** > **SKU** **is equal to** the Carafe SKU (add one condition per variant SKU, joined with **OR**).
4. **Then**: **Add order tags**: `preorder`, `preorder-carafe`.
5. **Then**: **Hold fulfillment order**. Reason **Other**, note `Pre-order: ships 11 to 14 December`.
6. Name it `Falcon – quick pre-order hold`. **Turn on workflow**.

Tell the warehouse / 3PL today: orders tagged `preorder-carafe` are on hold and must not be picked until released.

## Step 5. Test on the copy, then publish (15 min)

1. On the copy theme, click **Preview**. Open the Carafe page.
   - Expected: button reads **Pre-order · Ships by 14 Dec**; the blue box directly under it reads "Expected to ship 11 to 14 December. Payment is taken today. ..."; quantity selector shows.
   - Switch to an in-stock product: normal **Add to cart**, no box.
2. Click the **Pre-order** button. Open the cart.
   - Expected: the Carafe line shows **Pre-order: Expected to ship 11 to 14 December.**
   - **If the line does not show it**, the theme's add-to-cart script is dropping the extra fields. Stop and report; switch the Flow condition to the SKU version (Step 4.3) so orders are still held, and the product page message still informs the customer.
3. Place one test order (use a 100% discount code limited to the Carafe, or a real card and refund it). Do not switch the store to test payments.
   - Expected: order tagged `preorder`, `preorder-carafe`; status **On hold**; the order shows the **Pre-order** line property. Check the order confirmation email shows the Pre-order line. Cancel and refund the test order, restock ticked.
4. **Publish** the copy theme (**...** > **Publish**). Before publishing, confirm nobody edited the live theme since you duplicated it.

## When the Carafe arrives

1. Receive the stock as normal (quantity goes up).
2. **Orders** > filter tag `preorder-carafe`, status unfulfilled. Oldest first, open each and **Release hold** until the delivered stock is used up.
3. Then on each variant untick **Continue selling when out of stock** (or leave it on if a second batch is coming, with new dates).

## If the date moves

Change **Expected date** and **Pre-order note** on the variants (new customers see it at once). Existing pre-order customers are **not** emailed automatically yet: export orders tagged `preorder-carafe` and email them the new date and their right to cancel for a full refund. That email is a legal requirement for US customers and expected good practice in the UK.

## Also worth doing today

People already on the Carafe **Notify me** list are customers tagged `restock-<variant id>`. **Customers** > filter by that tag > email them that pre-orders are open.

---

## Appendix A. Snippet `falcon-quick-preorder`

```liquid
{%- comment -%}
  Falcon quick pre-order (UK store, interim). Render inside the add-to-cart
  form, directly below the button (above <div class="c-klarna">):
    {% render 'falcon-quick-preorder', product: product %}

  A variant is on pre-order when ALL are true:
    - inventory tracked by Shopify, quantity 0 or below
    - "Continue selling when out of stock" ticked
    - falcon.expected_date set on the variant, or on the product (covers
      every variant that has no date of its own)
  Optional:
    - falcon.preorder_note  (variant or product; text under the button, e.g.
                             "Expected to ship 11 to 14 December.")
    - falcon.preorder_limit (variant only; max units sold below zero; when
                             reached the variant shows Notify me instead)
  The button reads "Pre-order · Ships by 14 Dec" from the expected date.
  Same metafield names as the full system (docs/falcon-back-in-stock/ARCHITECTURE.md),
  so nothing is redone when that is installed.

  The product template's variant script calls window.falconPreorder(variant),
  which returns 'preorder', 'blocked' or 'normal', and reads the button text
  from window.FalconPreorderData[id].button.
{%- endcomment -%}
<div class="js-preorder-msg" style="display:none; margin:0 0 12px; padding:10px 12px; border:2px solid #243588; color:#243588; text-align:left; font-size:14px; line-height:1.4;">
	<span class="js-preorder-text"></span> Payment is taken today. Ordering other items too? We'll send everything together when this arrives, with one delivery charge.
</div>
<input type="hidden" class="js-preorder-date" name="properties[_preorder_date]" value="" disabled>
<input type="hidden" class="js-preorder-label" name="properties[Pre-order]" value="" disabled>
<script>
	window.FalconPreorderData = {
	{%- for v in product.variants -%}
		{%- assign po_state = 'normal' -%}
		{%- assign po_date = v.metafields.falcon.expected_date.value | default: product.metafields.falcon.expected_date.value -%}
		{%- if v.inventory_management == 'shopify' and v.inventory_quantity <= 0 and v.inventory_policy == 'continue' and po_date != blank -%}
			{%- assign po_state = 'preorder' -%}
			{%- assign po_limit = v.metafields.falcon.preorder_limit.value | plus: 0 -%}
			{%- assign po_sold = 0 | minus: v.inventory_quantity -%}
			{%- if po_limit > 0 and po_sold >= po_limit -%}{%- assign po_state = 'blocked' -%}{%- endif -%}
		{%- endif -%}
		{%- assign po_text = v.metafields.falcon.preorder_note.value | default: product.metafields.falcon.preorder_note.value -%}
		{%- if po_text == blank and po_date != blank -%}
			{%- capture po_text -%}Expected to ship from {{ po_date | date: '%-d %B %Y' }}.{%- endcapture -%}
		{%- endif -%}
		{%- capture po_button -%}Pre-order · Ships by {{ po_date | date: '%-d %b' }}{%- endcapture -%}
		"{{ v.id }}": { "state": {{ po_state | json }}, "date": {{ po_date | date: '%Y-%m-%d' | json }}, "text": {{ po_text | json }}, "button": {{ po_button | json }} }{% unless forloop.last %},{% endunless %}
	{%- endfor -%}
	};
	window.falconPreorder = function (variant) {
		var d = variant && window.FalconPreorderData[variant.id];
		var state = d ? d.state : 'normal';
		var on = state === 'preorder';
		jQuery('.js-preorder-msg').toggle(on);
		jQuery('.js-preorder-text').text(on ? d.text : '');
		jQuery('.js-preorder-date').val(on ? d.date : '').prop('disabled', !on);
		jQuery('.js-preorder-label').val(on ? d.text : '').prop('disabled', !on);
		return state;
	};
	// Fallback in case the variant script does not fire on page load: set the
	// state for the variant selected in the page. Waits for jQuery like the template.
	(function poInit() {
		if (!window.jQuery) { return setTimeout(poInit, 50); }
		jQuery(function () {
			var id = jQuery('#product-select').val();
			if (window.falconPreorder({ id: id }) === 'preorder') {
				jQuery('.js-add-to-cart').val(window.FalconPreorderData[id].button);
			}
		});
	})();
</script>
```
