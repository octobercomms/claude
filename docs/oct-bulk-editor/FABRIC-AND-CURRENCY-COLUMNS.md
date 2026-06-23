# OctoberComms Bulk Editor — Fabric Group & multi-currency columns (v1.5.0)

Three additions land in v1.5.0, all driven by the Another Country sofa build:

1. **Fabric Group** column (per-variation drawer category)
2. **EUR / USD** price columns (Aelia Currency Switcher)
3. **Full-width / one-line layout** so hiding columns reclaims horizontal space

## 1. Fabric Group column

| Column | Applies to | Reads/writes meta | Behaviour |
|--------|-----------|-------------------|-----------|
| **Fabric Group** | variations only | `_ac_fabric_group_key` | A dropdown built from the parent product's **Fabric Groups** box (`_ac_fabric_groups`, the `key\|Label\|Sort` lines the theme parses). Lets you bulk-assign each fabric variation to a drawer section. |

- Simple products and parent rows show an empty cell — the drawer is a
  variable-product feature.
- Options come **per parent**: each variation's dropdown is populated from its own
  parent's Fabric Groups, so the list always matches that product.
- Stored exactly like the theme's per-variation field, so the live Fabric Drawer
  picks the grouping up with no extra mapping.

## 2. EUR / USD price columns (Aelia)

Four columns — **Regular € / Sale € / Regular $ / Sale $** — read and write the
Aelia Currency Switcher per-currency meta arrays:

| Column | Meta key | Array key |
|--------|----------|-----------|
| Regular € (EUR) | `_regular_currency_prices` | `EUR` |
| Sale € (EUR)    | `_sale_currency_prices`    | `EUR` |
| Regular $ (USD) | `_regular_currency_prices` | `USD` |
| Sale $ (USD)    | `_sale_currency_prices`    | `USD` |

- Writing blank **removes** that currency's override (the value is unset from the
  array) so Aelia falls back to its automatic conversion.
- Non-numeric values are rejected on save.
- Applies to simple products and variations alike (whichever level Aelia stores
  the override on).

> **Test on staging first.** The Aelia meta format (serialized array keyed by
> currency code) is assumed from the standard Currency Switcher behaviour;
> confirm a write round-trips on the staging store before bulk-editing live.

## 3. Full-width / one-line layout

The table switched from `table-layout: fixed` to `table-layout: auto`, and the
**Product / Variation** name cell is now `white-space: nowrap`. As you untick
columns in the **Columns** row, the freed width is reclaimed and the grid
stretches to fill — so each variation name sits on a single line and the table
takes far less vertical space.

## Column visibility

All five new columns (Fabric Group + the four currency columns) are **hidden by
default**, persisted per user in `localStorage` (`octwbe_columns_v1`). Reveal them
in the **Columns** row when you need them.

## Bulk edit & CSV

- All five fields are available in the **Bulk edit** dropdown. Fabric Group takes
  a free-text group **key** (e.g. `outdoor`) and applies only to variations whose
  parent actually defines that key. Currency fields take a number.
- CSV **export/import** round-trips all five columns
  (`fabric_group`, `price_eur`, `sale_price_eur`, `price_usd`, `sale_price_usd`),
  matched by `id` like the rest of the sheet.
