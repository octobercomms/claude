# OctoberComms Bulk Editor — Variant Showcase columns (v1.1.0)

The bulk editor gained two optional columns that manage the **Another Country
Variant Showcase** settings in bulk, from the same grid as prices/stock/images.
Both plugins share the same post meta, so either can be active alone — but
together you can flag variations fast here and have them render on the storefront
via the Showcase plugin.

## What's new

| Column | Applies to | Writes meta | Behaviour |
|--------|-----------|-------------|-----------|
| **Lifestyle** (image) | every row | `_acvs_lifestyle_image_id` | Same click-to-pick + drag-and-drop upload as the main Image column. This is the hover image shown on shop/category cards. |
| **On Category Page** | parent + variation | `_acvs_mode` (parent), `_acvs_show_in_catalog` (variation) | Parent rows get a mode dropdown (Single card / Variation cards / Feature one). Variation rows get a checkbox to expose that variation as its own card. |

Ticking a variation's checkbox also flips its parent to **Variation cards**
(`_acvs_mode = expand`) automatically, since that's the mode that makes the
storefront render variation cards.

## Column visibility

Both new columns are **hidden by default** and persisted per user in
`localStorage` (`octwbe_columns_v1`). Anyone not using the showcase feature never
sees them; tick them on in the **Columns** row to reveal — the functionality is
always present regardless of visibility.

## Notes / limits

- Simple products show an empty "On Category Page" cell — the flag only affects
  variations of a variable product (a simple product always shows as itself).
- The "Feature one" single-variation picker lives on the product edit page
  (Showcase plugin); the grid covers the common expand-mode workflow.
- Saving is batched through the existing "Save All Changes" flow; image uploads
  reuse the editor's existing `octwbe_upload_image` endpoint.
