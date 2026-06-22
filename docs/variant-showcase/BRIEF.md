# Variant Showcase — Brief

## Problem

Another Country wants certain variable products to surface their variations as
separate cards on shop/category pages, while other products keep a single card.

Concrete asks from the client:

1. A product like a sofa range (3-seater, 2-seater, armchair) lives on **one
   product page**, but the **category page should show each of those variations**
   as its own tile.
2. Hovering a category tile swaps the product image to a **lifestyle image**, so
   variations need their own lifestyle image field.
3. **Some products opt out** — they show only the simple product, or one selected
   variation, as a single card.
4. Dining tables vary by **size and shape**, but **not every** variation should be
   exposed — so the choice of which variations become cards is per-variation.

## Solution

A standalone WooCommerce plugin: `dev/variant-showcase`
(slug `variant-showcase`, prefix `ACVS` — kept internally so the bulk
editor's shared `_acvs_*` meta keys stay stable).

### Admin (Product data → General)

- **Catalog display** mode per product: `default` (single card) / `expand`
  (separate card per selected variation) / `single` (feature one variation).
- **Featured variation** select (used by `single` mode).
- **Lifestyle image (hover)** at product level (for default/single-product cards).
- Per **variation**: a "Show as its own card" checkbox and a per-variation
  **Lifestyle image**.

Storage (post meta):

| Key | Level | Meaning |
|-----|-------|---------|
| `_acvs_mode` | product | `default` \| `expand` \| `single` |
| `_acvs_single_variation` | product | variation ID for `single` mode |
| `_acvs_show_in_catalog` | variation | `yes` to expose as a card |
| `_acvs_lifestyle_image_id` | product **and** variation | hover image attachment ID |

### Front end

- `the_posts` filter substitutes the chosen variation posts into the shop/category
  loop. WooCommerce sets the global `$product` from each post, so variation cards
  render through the **theme's existing card template** (no template overrides):
  variation image, name, price, and a permalink that pre-selects the variation.
- `woocommerce_product_get_image` is filtered to layer the lifestyle image over
  the thumbnail; CSS crossfades on card hover. `object-fit: cover` keeps it square.

## Decisions

- **Per-variation tick** (not a product-level multi-select) — most intuitive and
  handles "not all of them" for tables vs sofas. (Confirmed with client.)
- **CSS-only hover** (no JS) — fastest, theme-agnostic; touch devices simply show
  the main image. (Confirmed with client.)

## Known limitations

- WooCommerce's "showing x of y" / `found_posts` counts parent products, so an
  expanded page can read slightly low. Pagination still functions.
- Expansion targets classic product loops (main shop/category query, `[products]`
  shortcode, classic product blocks). Store-API-rendered blocks are not expanded.

## Bulk-editor integration (done — two-plugin approach)

Per client decision, the storefront feature stays in this plugin and the
**OctoberComms Bulk Editor** (`dev/oct-bulk-editor`, v1.1.0) gained two optional,
default-hidden columns that write the **same meta** so variations can be flagged
in bulk:

- **Lifestyle** image column (drag-and-drop / media picker) → `_acvs_lifestyle_image_id`
- **On Category Page** → parent mode dropdown (`_acvs_mode`) + variation checkbox
  (`_acvs_show_in_catalog`); ticking a variation auto-sets its parent to `expand`.

See `docs/oct-bulk-editor/VARIANT-SHOWCASE-COLUMNS.md`. Either plugin can run
alone; together the grid manages what this plugin renders.
