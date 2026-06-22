# Merge Products (Bulk Editor v1.2.0)

Combines several existing products into one new **variable product**, then shows
their variants on the category page via Variant Showcase. Built for Another
Country's "Another Sofa / Armchair / Corner / Chaise → one product page" need.

**WooCommerce → Merge Products.**

## What it does

1. You pick the source products and type a **Model** name for each (e.g. Sofa,
   Armchair, Corner, Chaise), choose which source is the **base** (its
   description, gallery and categories seed the new product), and name the new
   product.
2. **Preview** shows the resulting attributes (Model + the union of the sources'
   Size / Material / etc.) and the total variation count — before anything is
   created.
3. **Create** builds a new variable product (left as a **draft** for review) with:
   - Attributes: **Model + Size + Material** (separate dropdowns — the chosen
     structure). Attributes that don't apply to a model are left as "Any".
   - One variation per source variation (or per simple source product), copying
     price, sale price, stock, dimensions, tax/shipping class, variation image,
     description and the Variant Showcase fields (`_acvs_lifestyle_image_id`,
     `_acvs_show_in_catalog`).
   - `_acvs_mode = expand`, so the showcase displays the variants as cards.

## Safety model

- **Reversible.** Only a *new* product is created. The originals are set to
  **draft** and **301-redirected** to the new product (redirect map stored in the
  `octwbe_merge_redirects` option, served on `template_redirect`). Nothing is
  deleted — to undo, delete the new product and re-publish the originals.
- **SKUs are moved**, not copied: cleared from each original variation/product
  and set on the matching new variation, so the live product keeps the real SKUs
  without breaking WooCommerce's unique-SKU rule. Past orders snapshot the SKU as
  text, so order history is unaffected.
- A **backup confirmation** checkbox is required before the merge runs.

## Run it on staging first

WooCommerce product data is involved (and orders reference it), so:

1. Take a fresh **UpdraftPlus** backup / use staging.
2. Merge, then review the new draft product (attributes, variations, prices,
   images) and the category page before publishing.
3. Publish the new product when happy; keep the originals as draft.

## Known limitations

- The **Model + Size + Material** structure means the product-page dropdowns can
  offer combinations that don't exist for every model (an Armchair has no
  "3 Seater" size). That is inherent to separate dropdowns sharing one attribute
  set; a single combined "Configuration" attribute would avoid it but changes the
  UX.
- Global (taxonomy) attributes are unioned by their terms; custom per-product
  attributes are unioned by option label. Differently-named attributes meaning the
  same thing across products are treated as separate dropdowns.
- The redirect map grows by one entry per retired original; it is matched on the
  exact request path.
