# Another Country — merchandiser-child theme (managed files)

Version-controlled copies of the child-theme files October Comms maintains. These
are the **source of truth**; deploy them to the live theme and purge LiteSpeed.

| Repo file | Deploys to |
|---|---|
| `dev/anothercountry-theme/functions.php` | child theme root `functions.php` |
| `dev/anothercountry-theme/js/fabric-drawer.js` | child theme `/js/fabric-drawer.js` |
| `dev/anothercountry-theme/css/fabric-drawer.css` | child theme `/css/fabric-drawer.css` |

## What changed (this consolidation)

### Lead times — collision fixed
The Fabric Drawer and Lead Times both defined `ac_pdp_trust_chips()` /
`ac_get_lead_time()` in `functions.php`, so the last deploy wiped the other and
the lead-times wording went dead. The OCTOBER COMMS "PDP trust chips" block was
replaced with the **Lead Times v1.7 integration**:

- Lead time/label now render **inline in the green stock badge**
  ("Made to Order in 8-12 weeks") via `ac_lt_inline_assets()`, with the old
  tooltip removed; the wording comes from the **Another Country Lead Times
  plugin** (`aclt_get_lead_time` / `aclt_get_badge_label`).
- The old "This is made for you… lead time" trust-chip line is gone (it moved
  into the badge). Trust chips now carry Free UK delivery + (made-to-order)
  Customise only.
- The per-product Lead time field + supplier resolution live in the plugin now
  (the theme no longer registers `_ac_lead_time`).
- **The Fabric Drawer is untouched** — its blocks (render, AJAX, matrix, drawer
  preview, order-swatches button) are separate and unchanged.

> Requires the **Another Country Lead Times** plugin active (v1.7). Without it the
> badge falls back to "Made to Order in 8-10 weeks".

### Fabric step marker — grey number → green ✓
The Fabric accordion step showed a green ✓ from the start. It now shows a grey
numbered circle (its position, e.g. 4) matching the other steps, turning into a
green ✓ only once a fabric is chosen. Touches three files:

- `functions.php`: the trigger marker (`.ac-fabric-num`) no longer hardcodes ✓.
- `js/fabric-drawer.js`: `initFabricDrawer` sets the step number; `setTriggerState`
  swaps number ⇄ ✓ and toggles `.is-selected` on the trigger.
- `css/fabric-drawer.css`: `.ac-fabric-num` is grey by default (inherits
  `.ac-acc-num`); green only under `.ac-fabric-trigger.is-selected`.

### Main image slider — re-synced to the selected variation
The PDP gallery is a custom **Slick** slider (`#product_single_image_slider`)
whose images are each tagged server-side with `data-variation-id` (a comma list
of the variations that use that image). The parent theme's original sync was
bound to the native WooCommerce dropdowns; once we drive selection through the
custom accordion + fabric drawer, that sync stopped firing and the big image no
longer changed with the variation.

`js/fabric-drawer.js` now carries an `OCTOBER COMMS` block that listens to
WooCommerce's `found_variation` event (still fired — it's what updates the price
and made-to-order badge) and slides the existing Slick gallery to the image whose
`data-variation-id` contains the resolved `variation_id`. It also syncs once on
first load. No markup/PHP change — it reuses the theme's existing
variation→image tagging and the live Slick instance.

### Accordion — keep the section open when changing a choice
Picking a value in a variation accordion step used to always collapse it and
auto-advance to the next step. That's right for the **first** time a step is
answered (initial configuration), but annoying when the customer is **changing**
an existing choice. The accordion button handler now calls `openNext()` only when
the step wasn't already answered (`is-done`); changing an existing selection keeps
the current section open so they can keep adjusting it.

### "Customise your order" chip — fixed for variable products
The made-to-order trust chip ("We can adapt this… Customise your order") is
gated by `ac_lt_is_made_to_order()`, which checked the **parent** product's stock
status. For variable products WooCommerce keeps the parent status as `instock`
whenever variations are purchasable (backorder counts), so a product re-sync —
e.g. saving Catalog Order onto the parent in the bulk editor — flipped it to
`instock` and the chip disappeared. The check now inspects the **variations'**
stock status for variable products (made to order if any variation isn't plainly
in stock), so it's robust to parent re-syncs. The made-to-order *badge* was
unaffected (it reads the selected variation).

## Deploy

1. Upload all three files to the live `merchandiser-child` theme (same paths).
2. **Purge LiteSpeed cache** (Toolbox → Purge All) — the JS/CSS are enqueued with
   a time()-based version, but the page HTML is cached.
3. Confirm the Lead Times plugin is active (v1.7).

## Configurator mockup (reference)

`configurator-mockup.html` is a standalone HTML **prototype** of the Another
Country product configurator (the design precursor to the live accordion +
fabric-drawer build). Salvaged from the abandoned `claude/woocommerce-bulk-editor-311ZX`
branch (PR #698) before that PR was closed. Kept as a design reference only — it
is **not** deployed; the live configurator lives in `functions.php` +
`js/fabric-drawer.js` + `css/fabric-drawer.css`.
