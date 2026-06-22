=== Variant Showcase ===
Contributors: octobercomms
Requires at least: 6.0
Tested up to: 6.5
Requires PHP: 8.0
WC requires at least: 7.0
Stable tag: 1.0.1
License: GPLv2 or later

Show selected product variations as their own cards on shop and category pages,
each with an optional lifestyle image that fades in on hover.

== Description ==

Lets one variable product (e.g. a sofa range with
3-seater / 2-seater / armchair variations, or a dining table with several sizes
and shapes) display its chosen variations as individual product cards on the
shop and category pages — while other products keep the normal single card.

Per product you choose a Catalog display mode on the Product data → General tab:

* **Single card (default WooCommerce)** — unchanged behaviour.
* **Separate card per selected variation** — every variation you tick ("Show as
  its own card") appears as its own catalogue tile. Tick none and all visible
  variations are shown. This is how you expose only some variations for tables
  while exposing the relevant ones for sofas.
* **Feature one variation** — a single chosen variation represents the product.

Each variation (and each simple/parent product) can have a **lifestyle image**
that crossfades in when a shopper hovers the card. The lifestyle image is layered
over the main thumbnail and centre-cropped to its footprint, so square catalogues
stay square regardless of the source photo's ratio.

Variation cards link through to the product page with that variation pre-selected,
using the theme's existing product-card markup — no template changes required.

== Frequently Asked Questions ==

= Does it change my catalogue design? =

No. Variation cards reuse the theme's own product-card template and styles. The
only added styling is the hover crossfade for the lifestyle image.

= My product images are square — will the lifestyle images match? =

Yes. The lifestyle image fills the exact footprint of the main thumbnail with
object-fit: cover, so it is centre-cropped to the same box. WooCommerce's own
thumbnail cropping (Customizer → WooCommerce → Product Images) still applies too.

= Does the displayed product count stay exact? =

Expanding a product into several variation cards changes how many tiles a page
shows; WooCommerce's "showing x of y" count reflects parent products, so it may
read slightly low on expanded pages. Pagination still works.

== Changelog ==

= 1.0.1 =
* Lifestyle hover now also works on custom themes that render loop thumbnails
  without firing WooCommerce's standard shop-loop-item hooks (falls back to
  WordPress's own loop flag on shop/category archives).
* Broadened the hover trigger so the swap fires when the card's wrapping link is
  hovered, not only li.product cards.

= 1.0.0 =
* Initial release: per-variation catalogue cards, three per-product display modes,
  and lifestyle hover images at product and variation level.
