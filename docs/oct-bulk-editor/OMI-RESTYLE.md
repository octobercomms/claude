# Bulk Editor — October design system restyle (v1.12.0)

The bulk editor grew to 21 columns and several stacked control bars, and the
team found it hard to navigate. This pass restyles it to October's house design
language (OMI) and reorganises the column controls.

## Design language (OMI)
`assets/css/bulk-editor.css` now defines the October tokens **scoped to
`.wbe-wrap`** (so nothing leaks into the rest of wp-admin) and uses them
throughout:

- Two-tone: white surfaces, black text, the **yellow accent reserved for
  action / active / highlight** (primary Save button, active chips, group rows).
- **Amber** = unsaved (dirty) state, consistently across text/select/checkbox/
  image cells. **Green / red / amber** semantic colours for in-stock / out-of-
  stock / on-backorder.
- 2px borders, chunky radii (8/14px), soft shadows, Brockmann type, reduced-
  motion support.

No markup classes changed — every `wbe-*` hook the JS relies on is preserved, so
this is a pure re-skin plus the column grouping below.

## Column grouping
The flat list of 21 column toggles is now grouped into labelled sections so
people find columns by purpose:

- **Core** — Image, SKU, Publish Status
- **Pricing** — Regular, Sale, EUR ×2, USD ×2
- **Stock** — Stock Qty, Stock Status, Manage Stock, Backorders
- **Catalogue** — Lifestyle Image, On Category Page, Card Title, Catalog Order
- **Fabric** — Fabric Group

Visibility persistence and defaults are unchanged (`octwbe_columns_v1`).
