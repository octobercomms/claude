# CSV Export / Import (Bulk Editor v1.3.0)

A lightweight round-trip for editing the same fields the grid shows, in Excel.
(For attribute-level / full product migration, WooCommerce's own
**Products → Export / Import** is the heavyweight option.)

## Export
**Export CSV** downloads every product + variation matching the **current
search/category filter** (not just the visible page). Columns:

`id, type, parent_id, product, variation, sku, regular_price, sale_price,
stock_qty, stock_status, status, on_category, lifestyle_image_id`

`type`, `parent_id`, `product`, `variation` are informational (for orientation
in the sheet); the rest are editable.

## Import
**Import CSV** uploads a file and applies it, **matched by `id`**. Only these
columns are written (others are ignored): `sku, regular_price, sale_price,
stock_qty, stock_status, status, on_category, lifestyle_image_id`.

- Each value goes through the **same validation** as in-grid edits
  (`set_field_value()`), so bad values are reported per row rather than saved.
- An **empty cell clears** that field (same as clearing a cell in the grid) —
  e.g. blank `stock_qty` turns off "manage stock". Since export pre-fills current
  values, an unedited round-trip is a no-op.
- `stock_status` must be `instock|outofstock|onbackorder`; `status` must be
  `publish|draft|private|pending`; `on_category` is `yes|no`.
- Rows whose `id` isn't found are reported and skipped.

After import the grid reloads to show the new values. Run on staging / with a
backup if importing large changes.
