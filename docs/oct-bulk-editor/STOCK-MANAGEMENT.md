# OctoberComms Bulk Editor — Manage Stock & Backorders (v1.10.0)

Two columns to set stock management across many variations at once — built for
flipping a whole product's variations to **made-to-order** without WooCommerce's
native variations screen (which renders every variation form in the browser and
chokes on products with hundreds of variations).

| Column | Applies to | Writes | Control |
|--------|-----------|--------|---------|
| **Manage Stock** | products + variations | `set_manage_stock()` | Checkbox (ticked = manage own stock), matching WooCommerce's "Manage stock?" |
| **Backorders** | products + variations | `set_backorders()` | Dropdown: Do not allow / Allow, but notify / Allow |

## Made-to-order in one pass

For a product whose variations should be made-to-order (on backorder):

1. Load the product (filter to it), tick on the **Manage Stock**, **Backorders**
   and **Stock Qty** columns in the **Columns** row.
2. In **Bulk edit**, apply to all rows:
   - Manage Stock → **Yes**
   - Stock Qty → **0**
   - Backorders → **Allow, but notify**
3. **Save All Changes.**

Each variation resolves to **On backorder** (made-to-order). This drives the live
"Made to Order" badge and the "Customise your order" trust chip.

## Stock-status recompute

When a row **manages its own stock**, the save recomputes its stock status from
the live quantity + backorder setting, so you don't have to touch the Stock Status
column as well:

- qty > 0 → **in stock**
- qty ≤ 0 with backorders allowed (notify/yes) → **on backorder**
- qty ≤ 0 with backorders off → **out of stock**

Setting **Manage Stock → No** leaves the variation inheriting the parent product's
stock (its status is then whatever you set in the Stock Status column).

## Notes

- Works on the parent (whole-product) row too, so you can set product-level stock
  management from the same grid.
- Round-trips through CSV export/import (`manage_stock`, `backorders` columns).
- The save is server-side and batched — far lighter on the browser than the native
  WooCommerce variations bulk action for large variation sets.
