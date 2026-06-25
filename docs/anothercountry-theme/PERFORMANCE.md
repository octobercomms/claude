# Another Country — performance review (June 2026)

Audit of `functions.php`, `js/fabric-drawer.js`, and the bulk editor after reports
the site "got a lot slower lately." The flagship "Another Sofa & Armchair" has
~384 variations, so anything per-variation or "all variations" multiplies by 384.

## Fixed in this pass (theme)

### 1. `time()` enqueue versions → stable versions  *(the sitewide slowdown)*
`child_theme_scripts()` enqueued 6 CSS/JS assets with `time()` as the version.
`time()` changes every second, so every visitor got a unique `?ver=` on every
asset on **every page load** — defeating browser cache, CDN/edge cache and
page-cache fingerprinting sitewide. Replaced with:
- `filemtime()` for the theme's own files (`style.css`, `css-2022/style.css`,
  `lscustom.js`, `fabric-drawer.css/js`) — the version only changes when the file
  changes, so caches work again and a real edit still busts the cache.
- the real library versions for the select2 CDN CSS/JS (`4.0.13` / `4.0.12`).

This is the most likely cause of the recent, sitewide slowness.

### 2. `ac_lt_is_made_to_order()` — memoized + single query
Called up to twice per PDP (trust chips + inline badge) and, for a variable
product, it looped every variation reading `_stock_status` (up to 384 reads,
twice). Now memoized per product per request, and the variation scan is one
indexed `$wpdb` query (`meta_value <> 'instock' … LIMIT 1`) instead of the loop.

## Recommended next (not yet done — flagged for sign-off)

These are higher-impact on the PDP but carry more risk / touch more code, so
they're listed for a follow-up rather than changed blind:

- **Per-variation `woocommerce_available_variation` N+1** (`ac_lt_variation_lead`,
  `ac_add_variation_drawer_preview`): both run once per variation (×384) when WC
  builds the variations payload, each doing several meta/term/option lookups.
  Fix: memoize the parent-level lead time/label + settings + supplier-term lookups
  (a `static` request cache; for lead times this needs a small change in the Lead
  Times plugin's resolver).
- **`get_available_variations()` called twice per PDP + the 384-row fabric matrix
  rebuilt every load** (`ac_build_fabric_size_matrix`, `ac_render_fabric_drawer_ui`,
  `ac_enqueue_fabric_swatch_data`): compute it once per request and cache the built
  matrix in a transient keyed by product id + modified time, invalidated on
  product/variation save. Heaviest single PDP op.
- **Gate select2 / slick / noUiSlider enqueues** to the pages that use them
  (the `is_product()` guard around select2 is currently commented out).
- **Drop `'full_query' => $wp_query`** from the `ls_custom` localize payload — it
  serialises the entire WP_Query into every category/shop page.

## Bulk editor (admin-only — doesn't affect shoppers)

- The legacy `ajax_save_changes` saves once **per change** rather than once per
  product (the newer REST sync path already groups by product). Editing 3 fields
  on one variation = 3 full saves; worth aligning with the REST path.
- The product fetch hydrates a full `wc_get_product()` per variation (×384 on one
  page). Consider direct meta reads or lazy-loading variation rows on expand.

See the session audit for full file:line detail.
