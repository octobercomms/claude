# Theme template changes — `woocommerce/content-single-product-half.php`

Two changes: **remove the CSS tooltip** and **fix the double "Made to Order / In Stock" label**.

## 1. Remove the tooltip (the bad-UX `:before` popup)

Delete the **`//LEAD TIME TEXT`** block — the `get_field('lead_time_popup_text'…)` /
`in_stock_text` lookups **and** the `<style>` that injects them as
`:before` content (in the version reviewed, **lines 52–78**):

```php
// DELETE FROM HERE ----------------------------------------------------------
$text=get_field('lead_time_popup_text');
if($text==''){ $text=get_field('lead_time_popup_text','options'); }
$instocktext=get_field('in_stock_text');
if($instocktext==''){ $instocktext=get_field('in_stock_text','options'); }
?>
<style>
body.single-product p.available-on-backorder:before{ content:"<?php echo $text;?>" !important; }
body.single-product p.stock.in-stock:before{ content:"<?php echo $instocktext;?>" !important; }
</style>
<?php
// DELETE TO HERE ------------------------------------------------------------
```

The green **"Made to Order / In Stock" badge itself stays** (it's the WooCommerce
stock label, relabelled + coloured by the plugin). Only the injected tooltip
text goes. Lead-time detail now lives once, in the trust-chip block.

> The ACF fields `lead_time_popup_text` / `in_stock_text` (and their ACF Options
> defaults) become unused after this. Leave them for now; retire the ACF group
> in a later tidy-up once you've confirmed nothing else reads them.

> **Lighting note:** the `lighting_lead_time` JS block just below (≈ lines
> 81–110) rewrites the `.available-on-backorder` label text for lighting
> products on variation change. It's independent of the tooltip and can stay.
> Longer term it can be folded into a "Lighting" supplier in the plugin.

## 2. Fix the double label (variable products showing both)

Root cause: variable products render both `p.available-on-backorder`
("Made to Order") and `p.stock.in-stock` ("In Stock") because variations have
mixed stock states.

**Preferred fix (reliable): make variations consistent.** For each variable
product, set all variations to the same intent — either *in stock*, or *0 stock
+ "Allow, but notify customer"* (backorder → "Made to Order"). Mixed = both
labels. This is a data fix, no code.

**Cosmetic backup (if mixed states must remain):** show only the **selected
variation's** status. Add this near the other inline scripts in the template,
then test against the live DOM (class names can vary by WooCommerce version):

```html
<script>
jQuery(function ($) {
  var $summary = $('.product_infos, .summary').first();

  function acShowOnly($keep) {
    $summary.find('p.stock').not($keep).hide();
    $keep.show();
  }

  // When a variation is chosen, prefer its availability and hide the rest.
  $('.single_variation_wrap').on('show_variation', function (e, variation) {
    var $varStock = $('.woocommerce-variation-availability p.stock');
    if ($varStock.length) {
      acShowOnly($varStock);
    } else {
      // Variation in stock with no availability text: hide the backorder label.
      $summary.find('p.available-on-backorder').hide();
    }
  });

  // Before any selection on a variable product, avoid showing two: keep the
  // first label only.
  var $all = $summary.find('p.stock:visible');
  if ($all.length > 1) { acShowOnly($all.first()); }
});
</script>
```

Test on a known-mixed product (e.g. *Dining Table Five*) and a simple product
(e.g. *Desk Two*) before shipping.
