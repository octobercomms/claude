# Another Country Lead Times — Plugin Spec & Handoff

> **Purpose of this document:** a complete, self-contained description of the
> `anothercountry-lead-times` WordPress/WooCommerce plugin **and** its companion
> theme patch, so another agent can understand, extend, or **restore** it without
> re-deriving anything. If you suspect the work was overwritten, see
> **§9 Recovery** first.

**Canonical location in this repo (per `CLAUDE.md` two-folder rule):**
- Code: `dev/anothercountry-lead-times/`
- Docs: `docs/anothercountry-lead-times/`
- Built zip: `releases/anothercountry-lead-times.zip` (gitignored pattern: `*.zip`)
- Generated theme file: `releases/functions.php`

**Current version:** `1.7.0` (see `§8 Version history`).
**Requires:** WordPress ≥ 6.0, PHP ≥ 8.0, WooCommerce ≥ 7.0.
**Text domain:** `anothercountry-lead-times`. **Taxonomy constant:** `ACLT_TAX = 'ac_supplier'`.

---

## 1. What the plugin does

Central, **supplier-based** lead-time manager for Another Country's WooCommerce
store. Delivery lead-time wording ("Made to Order in 8-12 weeks") used to be hand-
typed per product. This plugin lets the team set a lead time **once per supplier**
and have it apply to every attached product, with layered overrides.

It also:
- Shows the lead time **inline in the product-page stock badge** (via the theme
  patch), with a **per-supplier status label** so stock suppliers read correctly
  (e.g. Armadillo → "Available in approx. 6 weeks", not "Made to Order").
- Applies a **seasonal note** (e.g. summer-shutdown) automatically within a date
  window, per supplier or globally.
- Absorbs the old "Woo Custom Stock Status" plugin (relabels/colours stock text),
  so that plugin can be deactivated.
- Provides an **admin console** (WooCommerce → Lead Times) to see inventory at a
  glance, edit overrides, bulk-apply by category, assign categories to suppliers,
  and export/import CSV.

---

## 2. Resolution model (the heart of it)

`ACLT_Resolver::get_lead_time( $product_id )` resolves in this order — **first
match wins**, and it is never empty:

1. **Per-product override** — `_ac_lead_time` post meta (the site's pre-existing
   field; hundreds already populated). A variation with no own override **inherits
   its parent product** (recurses to parent).
2. **Supplier** — the product's assigned `ac_supplier` term, if `enabled`. Uses
   the supplier's `oos` figure when the product is out of stock/backorder and an
   `oos` value is set, otherwise the supplier's `base` figure.
3. **Global default** — `aclt_settings['default_lead']` (seeded `8-10 weeks`).

Related resolvers:
- `get_badge_label( $id )` — the words **before** the lead time. Supplier `label`
  if set & enabled (variations inherit parent), else `aclt_settings['default_label']`
  (seeded `Made to Order`). **This is the v1.7 fix** for the "Made to Order"
  mislabel on stock suppliers.
- `get_lead_time_note( $id )` — supplier `note`; suppressed when a per-product
  override exists (an override is treated as a complete statement).
- `get_seasonal_note( $id )` — supplier seasonal note if the supplier is
  configured (returns '' if supplier configured but `season_enabled` off);
  otherwise the global default seasonal note. Active only inside the MM-DD window
  (`in_season()` supports windows that wrap the new year).
- `is_out_of_stock()`, `stock_label()`, `old_message()` (reads the legacy
  `lead_time_popup_text` meta / `options_lead_time_popup_text` option — used by
  the admin "Old message" column for migration review).

---

## 3. File manifest

```
dev/anothercountry-lead-times/
├── anothercountry-lead-times.php   Bootstrap: constants, default settings,
│                                   aclt_get_settings(), instantiates classes,
│                                   public API wrappers, activation hooks.
├── uninstall.php                   Cleanup on delete.
├── readme.txt                      WP-style readme + changelog (Stable tag).
├── assets/css/
│   ├── admin.css                   Admin console styling (tabs, grid, chips).
│   └── frontend.css                Optional standalone notice styling.
└── includes/
    ├── class-aclt-taxonomy.php     Registers `ac_supplier` taxonomy + term-meta
    │                               fields on add/edit screens. Meta keys:
    │                               enabled, label, base, oos, note,
    │                               season_enabled, season_start, season_end,
    │                               season_note. get_data() reads them.
    ├── class-aclt-assign.php       One-supplier-per-product enforcement:
    │                               single-select box on product editor,
    │                               Products-list bulk-edit "Supplier" control,
    │                               "Filter by supplier" dropdown + column.
    ├── class-aclt-product.php      Per-product `_ac_lead_time` field on the
    │                               product General tab (+ "Currently showing").
    ├── class-aclt-resolver.php     The resolution model in §2. Pure static API.
    ├── class-aclt-stock-label.php  Relabels/colours WC availability text
    │                               (absorbs Woo Custom Stock Status).
    ├── class-aclt-admin.php        The WooCommerce → Lead Times console (§4).
    └── class-aclt-display.php      [ac_lead_time] shortcode + optional
                                    auto-display notice (theme drives the real PDP).
```

---

## 4. Admin console (WooCommerce → Lead Times)

Three tabs, one screen (`class-aclt-admin.php`):

- **Suppliers** — table of supplier terms with their lead-time meta. "+ Add /
  manage suppliers" links to the taxonomy screen where each supplier has:
  Status label, Base lead time, Out-of-stock lead time, Extra note, and a
  Seasonal block (on / from MM-DD / to MM-DD / note).
- **Defaults & display** — global fallback: Default lead time, **Default status
  label**, Default seasonal note (+ window/enabled), and the stock relabel/colour
  settings. Saved via `admin_post_aclt_save` → option `aclt_settings`.
- **Products** — searchable, paginated, category-filtered (chip cloud) list of
  every product, with **read-only** inventory columns (Manage / Qty / Stock
  status / Backorders), resolved Lead time, full **Old message** column (for
  migration review — slated for removal once verified), and an editable
  **Override** field per product **and per variation** (variation rows shown
  indented). Tools on this tab:
  - **CSV export/import** (`aclt_export_csv` / `aclt_import_csv`) — round-trips
    every product + override by Product ID.
  - **Category bulk-apply** (`aclt_apply_category`) — write one override to every
    product in the selected category (static per-product values).
  - **Assign category → supplier** (`aclt_assign_supplier`, added v1.6) — attach
    every product in the selected category to a chosen supplier in one click
    (single source of truth); supplier 0 detaches.
  - Per-page selector incl. **"Show all"** (no pagination).

All write handlers check `manage_woocommerce` + nonces; per-row writes also check
`edit_post`.

---

## 5. Public API (used by the theme)

Defined in `anothercountry-lead-times.php`, all thin wrappers over the resolver:

```php
aclt_get_lead_time( $product_id ) : string   // figure, e.g. "8-10 weeks"
aclt_get_badge_label( $product_id ) : string // label, e.g. "Made to Order" / "Available"
aclt_get_lead_time_note( $product_id ) : string
aclt_get_seasonal_note( $product_id ) : string
aclt_get_settings() : array                  // settings merged with defaults
```

Filter hook: `aclt_notice_html` (filters the standalone notice markup).
Shortcode: `[ac_lead_time id="123"]` (defaults to current product).

---

## 6. Theme integration (companion patch)

The real product page is driven by the **merchandiser-child** theme's
`functions.php`, not the plugin. The patch lives at:

- `docs/anothercountry-lead-times/theme-patches/functions-ac-lead-times.php`
  — the maintained source block (replaces the "OCTOBER COMMS — PDP trust chips"
  block in the theme's functions.php).
- `docs/anothercountry-lead-times/theme-patches/content-single-product-half-changes.md`
  — template-side notes.

What the patch does:
- `ac_lt_is_made_to_order()` — true for furniture-category products not in stock.
- `woocommerce_available_variation` filter exposes per-variation `ac_lead_time`
  and `ac_lead_label` into the variations JSON.
- `ac_pdp_trust_chips()` — Free UK delivery + (made-to-order) Customise chips
  after add-to-cart (no lead-time line — that's inline now).
- `ac_lt_inline_assets()` (wp_footer) — JS that:
  - relocates the simple-product stock badge next to the price,
  - resolves the "Made to Order + In Stock" oxymoron,
  - **sets the badge text to `{label} in {lead}`** (+ seasonal note on a new
    line), replacing the theme's hardcoded "Made to Order",
  - updates per **selected variation** on `show_variation`.

**Build/deploy:** `releases/functions.php` is generated by splicing this patch
into the customer's full `functions.php` (source kept in the chat upload
`…/423da62f-functions.txt`). The block is delimited by
`OCTOBER COMMS ADDITION - START/END` markers. The standalone plugin zip is built
with `zip -rq releases/anothercountry-lead-times.zip anothercountry-lead-times`.
See `docs/anothercountry-lead-times/DEPLOYMENT.md`.

---

## 7. The Another Country data picture (from the 2026-06-21 export)

602 products, only ~3 real lead-time templates (see
`docs/anothercountry-lead-times/lead-time-message-audit.md`). Agreed coverage:
- **Global default** `8-12 weeks` + seasonal note → ~553 Another Country items.
- **Supplier "Armadillo"** base `approx. 6 weeks`, **Status label `Available`** →
  41 Armadillo-category items (assign via category → supplier).
- **Hardy Collection** `10-12 weeks` via category bulk-apply → 7 items.
- Two Armadillo fast-stock items → per-product `approx. 2 weeks` override.

---

## 8. Version history

| Ver | What |
|-----|------|
| 1.2 | Tabbed admin, category bulk-apply, CSV export/import, seasonal indicators, simple-product badge fix |
| 1.3 | Inventory-at-a-glance products grid + variation rows |
| 1.4 | Editable inventory grid (later reverted) |
| 1.5 | Inventory back to **read-only**; **per-variation** lead-time overrides; full Old-message column |
| 1.6 | **Assign a whole category → supplier** in one click |
| 1.7 | **Per-supplier Status label** (+ global default label) — fixes stock suppliers reading "Made to Order"; theme now replaces badge text |

---

## 9. Recovery (if another agent overwrote the work)

All work is committed on branch **`claude/dreamy-noether-iia0mj`**. To verify /
restore:

```bash
# See the plugin's history
git log --oneline -- dev/anothercountry-lead-times docs/anothercountry-lead-times

# Confirm the last-known-good commit is v1.7
#   5069a21  Lead times v1.7: per-supplier status label …

# Restore the whole plugin + docs to that commit (if overwritten)
git checkout 5069a21 -- dev/anothercountry-lead-times docs/anothercountry-lead-times

# Or restore a single file
git checkout 5069a21 -- dev/anothercountry-lead-times/includes/class-aclt-resolver.php

# Rebuild the zip + functions.php afterwards (see §6 / DEPLOYMENT.md)
```

Sanity checks after restore:
- `dev/anothercountry-lead-times/anothercountry-lead-times.php` shows
  `Version: 1.7.0` and defines `aclt_get_badge_label()`.
- `class-aclt-resolver.php` has `get_badge_label()` and variation-inherits-parent
  logic in `get_lead_time()`.
- `class-aclt-taxonomy.php` `meta_keys()` includes `'label'`.
- `aclt_default_settings()` includes `'default_label'`.
- `php -l` passes on every file under `includes/`.
