# Another Country — Consolidation Status (central agent)

Tracks the merge of parallel agent work into one source of truth in this repo.

## Workstreams & state

| Work | Canonical location | State |
|---|---|---|
| **Lead Times** plugin | `dev/anothercountry-lead-times` | **v1.7.0** pulled in from branch `claude/dreamy-noether-iia0mj`. Was only v1.1.0 on main. |
| **Variant Showcase** plugin | `dev/variant-showcase` | v1.0.5 (mine; merged to main earlier). |
| **OctoberComms Bulk Editor** | `dev/oct-bulk-editor` | **v1.4.0** — my feature set (showcase columns, merge tool, CSV export/import, bulk-edit bar) **+ ported** the other agent's select-all checkboxes (from `claude/woocommerce-bulk-editor-311ZX`). This is now the one canonical bulk editor. |
| **Fabric Drawer / configurator** (theme) | `merchandiser-child` theme — **NOT yet in repo** | Pending: need the live `functions.php`, `fabric-drawer.js`, `fabric-drawer.css` to bring into version control. |

## The live conflict (why lead-times went dark)

The Lead Times **theme patch** and the **Fabric Drawer** both define
`ac_pdp_trust_chips()` on `woocommerce_after_add_to_cart_form` (pri 20) and their
own `ac_get_lead_time()`. Two same-named functions can't coexist, so whichever
`functions.php` block was deployed last overwrote the other. The Fabric Drawer
block is currently live → it carries no lead-times badge JS (`ac_lt_inline_assets`)
and doesn't call the plugin resolver, so the "Made to Order in N weeks" wording
disappeared.

### Reconciliation plan (needs the live files)
Produce **one** `OCTOBER COMMS` block in `functions.php` that:
- keeps the entire Fabric Drawer (render, AJAX, matrix, swatch button, modal),
- merges the two `ac_pdp_trust_chips()` into a single function (fabric trust
  bullets + made-to-order Customise chip + GF 12 modal),
- restores `ac_lt_is_made_to_order()` + `ac_lt_inline_assets()` (the badge JS),
- has one `ac_get_lead_time()` that defers to `aclt_get_lead_time()` when the
  Lead Times plugin is active (fallback `8-10 weeks`).
Then commit the reconciled `functions.php` + `fabric-drawer.js/css` into the repo
(canonical home TBD — likely `dev/anothercountry-theme/` per the two-folder rule).

## Outstanding / needed from client
1. Live `functions.php` (with the Fabric Drawer block).
2. `fabric-drawer.js` + `fabric-drawer.css` from the child theme.
3. Confirm active plugins + versions on live (esp. Lead Times active & version).
