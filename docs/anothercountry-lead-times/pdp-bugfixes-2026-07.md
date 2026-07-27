# PDP bug fixes — July 2026

Two bugs on single product pages, fixed across the plugin (v1.8.0) and the
Merchandiser child theme. Context: lead-time wording is resolved by the
**Another Country Lead Times** plugin and rendered on the PDP by the theme's
`ac_lt_inline_assets()` (footer) block.

## Bug 1 — Seasonal note never displayed (variable products)

**Symptom.** The seasonal note (e.g. "Allow up to 15 weeks for orders placed
July to September", window 06-01 → 09-30) was resolved correctly by the plugin
but never appeared on the product page. Only "Made to Order in N weeks" showed.

**Cause.** The note was appended *inside* the `p.stock.available-on-backorder`
badge. On variable products that badge exists twice:

- the copy inside the struck-through `<del>` price carried the full output
  (incl. the note) but is hidden by the theme
  (`… .woocommerce-variation-price del p.available-on-backorder{display:none}`);
- the *visible* stock line is rebuilt client-side from the variation JSON by
  WooCommerce's `add-to-cart-variation` JS on every change and never carried the
  appended note across.

The theme also hides `.available-on-backorder:nth-of-type(2)…(6)`, so wrapping
the note in another `available-on-backorder` element would be suppressed too.

**Fix** (`dev/anothercountry-theme/functions.php`, `ac_lt_inline_assets`). The
note is now rendered as its **own element** — `<p class="ac-seasonal-note">` —
which the theme's badge-hiding rules never target. It is appended **after** the
price block (never before it, so the badge's `:nth-of-type` rules are
unaffected) and **re-placed on the `show_variation` event**, i.e. after
WooCommerce has rebuilt the availability node, so it always lands in the visible
price block. The note is product-level (one supplier per product), so its text
is constant across variations. The old `.ac-lead-season` span (appended inside
the badge) was removed.

## Bug 2 — "In Stock (Can Be Backordered)" leaked through (Hardy Chair Oak)

**Symptom.** The Hardy Chair (Oak) showed WooCommerce's default
"In Stock (Can Be Backordered)" instead of a clean label.

**Cause.** This is WooCommerce's own availability text, not plugin output. The
product is configured **In stock + backorders "Allow, notify"**, and in that
state `wc_format_stock_for_display()` appends "(can be backordered)". The
plugin's relabeller only fired on the `onbackorder` / `outofstock` statuses (why
genuinely on-backorder products like the Sofa correctly read "Made to Order"),
so an `instock` product slipped past it.

**Fix** (plugin v1.8.0, `class-aclt-stock-label.php`). The
`woocommerce_get_availability_text` filter now also handles the `instock` state
and strips the "(can be backordered)" suffix (translated phrase + English
fallback), without otherwise changing the in-stock wording. Gated by a new
**"Can be backordered suffix"** toggle on *Lead Times → Defaults & display*
(on by default; still under the master "Relabel stock statuses" switch). Because
this runs server-side through the availability filter, it also fixes the suffix
in the per-variation availability JSON.

### Open question for the team — which fix is *intended* for the Hardy Chair

The code fix above makes the label clean whichever way the chair is meant to be
sold. But the underlying data may still be wrong:

- **If the chair is genuinely made to order** — the correct fix is a **data
  change** (set its WooCommerce stock status to 0 stock + "Allow, notify" so it
  reads `onbackorder`). It then shows "Made to Order" via the existing
  relabeller, exactly like the rest of the made-to-order catalogue. The
  lead-time audit (`lead-time-message-audit.md`, group C) classifies the whole
  **Hardy Collection as made to order (10–12 weeks)**, which suggests this is
  the intended state and the current "In stock" config is a misconfiguration.
- **If the chair is genuinely held in stock with backorders** — no data change
  needed; the v1.8.0 suffix-strip alone gives the clean "In Stock" label.

**Recommendation:** confirm with the merchandising team. The audit points to
"made to order", so a quick stock-status correction is likely the right call;
the plugin change ships regardless as a guard so this parenthetical can never
leak again.
