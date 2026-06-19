=== Another Country Lead Times ===
Contributors: octobercomms
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 8.0
WC requires at least: 7.0
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Central, supplier-based lead-time manager for Another Country. Set lead times once per supplier; every attached product updates automatically.

== Description ==

Another Country's delivery lead times change often — by workshop/supplier, by
stock status, and seasonally (e.g. the Portuguese summer shutdown). Editing them
product by product is impractical. This plugin gives the team **one place** to
manage them.

* **Suppliers** — a `Supplier` taxonomy on products (Portugal, Welwyn, Slow &
  Another Sofa, Hardy, etc.). Attach each product to a supplier once.
* **Central Lead Times screen** (WooCommerce → Lead Times) — review and edit
  every supplier's lead time on a single page.
* **Out-of-stock variation** — an optional longer lead time used automatically
  when a product is out of stock (e.g. Hardy chairs: 12–15 weeks when not in
  stock).
* **Seasonal windows** — set a recurring date range (e.g. 01 Jul–30 Sep) with an
  extended lead time that switches on and off automatically each year. No script
  to remember to run.
* **Per-product override** — for genuine one-offs, override the supplier lead
  time on the product's Lead Time tab.
* **Display** — shows automatically on single product pages, or place it
  anywhere with `[ac_lead_time]`.

== How it resolves the lead time ==

For each product, in order:

1. Per-product override (if set).
2. Supplier seasonal text (if a seasonal window is active today).
3. Supplier out-of-stock text (if the product is out of stock).
4. Supplier base text.

An optional supplier note (e.g. "from receipt of fabric at the warehouse") is
appended.

== Shortcode ==

`[ac_lead_time]` — current product.
`[ac_lead_time id="123"]` — a specific product.

== Developer ==

Filter `aclt_notice_html` to customise the rendered markup:

`add_filter( 'aclt_notice_html', function ( $html, $product_id, $text ) { return $html; }, 10, 3 );`

== Changelog ==

= 1.0.0 =
* Initial release: supplier taxonomy, central Lead Times screen, out-of-stock
  and seasonal variations, per-product override, auto display + shortcode.
