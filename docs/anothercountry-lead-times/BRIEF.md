# Another Country — Lead Times

## The problem

Lead time notices on the Another Country site change frequently and can't be
maintained product-by-product. They vary by:

- **Supplier / workshop** — Portugal, Welwyn, Slow & Another Sofa, Hardy, etc.
  each have their own lead time.
- **Stock status** — e.g. Hardy chairs, stools, love seat and Gallon are
  12–15 weeks all year *when not in stock*.
- **Season** — known annual periods extend lead times (Portugal's summer
  shutdown adds ~3–4 weeks; the broad Jan–Jun / Jul–Sep / Oct–Dec pattern).

Rachel asked for "a central point" to update these, and we agreed **supplier**
is the right unit to group by.

## The solution (this plugin)

A WordPress/WooCommerce plugin that makes the **supplier** the source of truth.

1. **Suppliers** are a product taxonomy. Each product is attached to a supplier
   **once** (on the normal product editor, or in bulk via Quick Edit).
2. **WooCommerce → Lead Times** is the single central screen: every supplier and
   its lead time on one page. Change it there and every attached product updates.
3. Each supplier holds:
   - **Base lead time** (e.g. `9–12 weeks`)
   - **Out-of-stock lead time** (optional — used automatically when the product
     is out of stock; covers the Hardy "12–15 weeks when not in stock" case)
   - **Extra note** (e.g. `from receipt of fabric at the warehouse`)
   - **Seasonal window** — a recurring date range + text that switches on/off
     automatically every year (e.g. `01 Jul → 30 Sep`, `12–16 weeks (summer
     shutdown)`). This replaces the idea of a script we'd have to remember to
     run — it just happens on the right dates.
4. **Per-product override** — for the rare genuine exception, override the
   supplier lead time on that product's *Lead Time* tab.

### Why this answers Rachel's question

> "the lead times change by workshop and even product… would be good to update
> in a central point somehow. Supplier might be a good solution."

- **Central point:** the Lead Times screen.
- **By workshop:** supplier = workshop. One edit updates all their products.
- **Even product:** the per-product override handles true one-offs without
  forcing everything to be edited per product.
- **No annual script:** seasonal windows automate the known periods.

## Mapping the examples Rachel gave

| Rachel's note | How it's set up |
|---|---|
| Portugal: 9–12 weeks + 3–4 for summer | Supplier *Portugal*, base `9–12 weeks`, seasonal window over summer with text `12–16 weeks (summer shutdown)` |
| Hardy chairs/stools/love seat/Gallon: 12–15 weeks all year when not in stock | Supplier *Hardy*, base `(in-stock figure)`, out-of-stock `12–15 weeks` |
| Slow & Another Sofa: 12–14 weeks from receipt of fabric | Supplier *Slow & Another Sofa*, base `12–14 weeks`, note `from receipt of fabric at the warehouse` |
| Welwyn: 8–10 weeks from receipt of fabric | Supplier *Welwyn*, base `8–10 weeks`, note `from receipt of fabric at the warehouse` |

## Open question for Rachel

The `*` products (Hardy chairs, stools, Gallon) differ from the rest of the
Hardy range only when out of stock. If the *whole* Hardy range shares the same
in-stock lead time, one Hardy supplier with an out-of-stock figure covers it.
If different Hardy items have genuinely different in-stock lead times, either
split them into separate suppliers or use a per-product override on those items.

## Assigning products to suppliers

- **One product:** set the supplier in the *Supplier* box on the product editor
  (a single-select dropdown — one supplier per product).
- **In bulk:** on the Products list, tick the products, choose **Bulk actions →
  Edit → Apply**, set **Supplier**, then **Update**. Use the **Filter by
  supplier** dropdown above the list to pull up a specific set first. The
  Supplier column shows the assignment, so you can see what's attached.

### One supplier per product (Q2)

Yes — enforced. The product editor uses a single-select box, and bulk edit
replaces rather than adds, so a product can only ever resolve to one supplier's
lead time. (Defensively, if multiple were ever set programmatically, the first
is used.) If a product genuinely spans two workshops, use the per-product
override for its lead time.

## Existing notice / where lead times come from today (Q3)

**This needs checking on the live site before we finalise — that code isn't in
this repo.** Another Country almost certainly already shows a lead-time notice
somewhere, via one of:

- a **theme template** override (e.g. `single-product.php` /
  `content-single-product.php`, or a block/Gutenberg pattern);
- an **ACF / custom field** printed by the theme;
- the product **short description** or an existing **plugin**;
- hard-coded text.

**Recommendation: investigate first, then switch over — don't stack two systems.**
Steps:

1. Find the current notice text on a product page and search the active theme +
   mu-plugins/plugins for it.
2. Decide the single source of truth (this plugin) and **remove** the old
   output so notices don't double up.
3. Wire display: either leave this plugin's automatic single-product display on
   (toggle on the Lead Times screen) **or**, if the theme controls placement,
   turn auto-display off and drop `[ac_lead_time]` into the template/block where
   the old notice was.
4. Backfill: assign existing products to suppliers (bulk edit) and retire the
   old field/snippet.

Until that audit is done, keep auto-display **off** on production if an existing
notice is still live, to avoid showing two.

## Usage

- Display is automatic on single product pages (toggle on the Lead Times
  screen). Or place `[ac_lead_time]` anywhere; `[ac_lead_time id="123"]` for a
  specific product.
- Code: `dev/anothercountry-lead-times/`. See `readme.txt` for the full feature
  list and the `aclt_notice_html` filter for theming.
