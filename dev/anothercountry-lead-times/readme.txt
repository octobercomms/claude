=== Another Country Lead Times ===
Contributors: octobercomms
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 8.0
WC requires at least: 7.0
Stable tag: 1.7.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Central, supplier-based lead-time manager for Another Country. Set lead times once per supplier; every attached product updates automatically.

== Description ==

Another Country's delivery lead times change often — by workshop/supplier, by
stock status, and seasonally (e.g. the Portuguese summer shutdown). Editing them
product by product is impractical. This plugin gives the team **one place** to
manage them.

* **Suppliers** — a `Supplier` taxonomy on products (Portugal, Welwyn, Slow &
  Another Sofa, Hardy, etc.). Attach each product to **one** supplier.
* **Bulk assign** — set the supplier for many products at once from the
  Products → Bulk Edit panel, and filter the Products list by supplier to pull
  up the set you want. The supplier shows as a column so attachment is visible.
* **Central Lead Times screen** (WooCommerce → Lead Times) — review and edit
  every supplier's lead time on a single page.
* **Out-of-stock variation** — an optional longer lead time used automatically
  when a product is out of stock (e.g. Hardy chairs: 12–15 weeks when not in
  stock).
* **Seasonal windows** — set a recurring date range (e.g. 01 Jul–30 Sep) with an
  extended lead time that switches on and off automatically each year. No script
  to remember to run.
* **Per-product override** — the existing `_ac_lead_time` field on the product
  General tab is the per-product override (existing data preserved). Blank =
  inherit from supplier / global default.
* **Global defaults** — a single fallback lead time + seasonal note, seeded to
  match the site's current wording, so nothing changes until suppliers are set.
* **Stock label** — relabels WooCommerce stock statuses near the price
  (backorder → "Made to Order") with colour, replacing the Woo Custom Stock
  Status plugin so it can be deactivated.
* **Display** — the theme reads the figures via the public API
  (`aclt_get_lead_time()`, `aclt_get_lead_time_note()`, `aclt_get_seasonal_note()`).
  An optional standalone notice and `[ac_lead_time]` shortcode are also provided.

== How it resolves the lead time ==

Figure, in order:

1. Per-product override — `_ac_lead_time` (if set).
2. Supplier out-of-stock figure (if out of stock) or supplier base figure.
3. Global default figure.

A supplier note (e.g. "from receipt of fabric at the warehouse") is exposed
separately. The seasonal note is resolved independently: the supplier's seasonal
note when configured, otherwise the global default note while its window is
active.

== Shortcode ==

`[ac_lead_time]` — current product.
`[ac_lead_time id="123"]` — a specific product.

== Developer ==

Public API for the theme:

`aclt_get_lead_time( $product_id )` — lead-time figure.
`aclt_get_lead_time_note( $product_id )` — supplier note or ''.
`aclt_get_seasonal_note( $product_id )` — active seasonal note or ''.

Filter `aclt_notice_html` customises the standalone notice markup.

== Changelog ==

= 1.7.0 =
* Per-supplier "Status label": the words before the lead time on the product
  page are now configurable. Default "Made to Order"; a stock supplier can set
  e.g. "Available" so the badge reads "Available in approx. 6 weeks" instead of
  mislabelling stock items as made to order. Also a global default-label setting
  on Defaults & display. The front-end now replaces the badge text (label + lead)
  rather than only appending, and respects per-variation labels.

= 1.6.0 =
* New "Assign all in {category} to supplier" action on the Products tab: attach
  a whole category to a supplier in one click (single source of truth). Built
  for grouping e.g. all Armadillo products onto the Armadillo supplier.

= 1.5.0 =
* Inventory columns are read-only again (edit stock in WooCommerce); the grid is
  for seeing inventory at a glance + editing lead times.
* Per-variation lead-time overrides: each variation can have its own lead time
  (blank = inherit the product). The front-end shows the selected variation's
  lead time. Variations inherit the parent unless overridden.
* "Old message" column shows the full text (so the team can read it; remove the
  column once new values are verified).

= 1.4.0 =
* Products tab is now an editable inventory + lead-time grid: Manage stock, Qty,
  Stock status and Backorders are editable inline (via WooCommerce setters), for
  products and each variation. "Old message" is a visible column; wide grid
  scrolls horizontally.

= 1.3.0 =
* Products tab now shows SKU, Stock status (+ qty), Lead time, the original
  pre-migration "Old message", and per-variation sub-rows — so you can see what
  each product/variation is showing at a glance. CSV export includes these too.

= 1.2.0 =
* Tabbed admin (Suppliers / Defaults & display / Products).
* Products tab: category "tag cloud" filter, bulk-apply a lead time to every
  product in a category, and a per-page selector (50/100/200/Show all).
* CSV export / import of per-product lead times (round-trippable for the team).
* Seasonal status indicator (Active now / Scheduled / Off) on the global default
  and each supplier.

= 1.1.0 =
* Added an "All products — quick override" list at the bottom of the Lead Times
  screen: searchable, paginated, shows each product's supplier + currently-shown
  lead time, with an inline override field (writes _ac_lead_time).

= 1.0.0 =
* Initial release: supplier taxonomy (one supplier per product), bulk assign +
  supplier filter, central Lead Times screen, three-layer resolver (per-product
  / supplier / global default), out-of-stock + seasonal handling, public theme
  API, stock-label relabel (absorbs Woo Custom Stock Status), shortcode.
