# Google Sheets sync (OctoberComms Bulk Editor)

Two-way sync between a WooCommerce store and a Google Sheet. Pull the catalogue
into a sheet, edit prices / sale prices / EUR-USD prices / product data like a
spreadsheet, then push changes back so they go live. The sheet flags anything
that changed in WooCommerce since your last pull, so you always know what you
would overwrite.

The sheet columns are the **same as the CSV export/import**, so it's one mental
model across CSV and Sheets.

Added in plugin **v1.11.0**.

## How it works

Two pieces, no third-party service or subscription:

1. **Plugin REST API** (`octwbe/v1`) on the store, secured by a per-store token.
2. **A Google Apps Script** pasted into the sheet, which adds a **Bulk Editor**
   menu (Pull / Check / Push).

The sheet keeps a hidden `_octwbe_base` tab — a snapshot of exactly what it last
pulled. Conflict detection compares three versions of every cell:

- **A** = value at last pull (baseline snapshot)
- **B** = value currently in WooCommerce (re-fetched live)
- **C** = value the user typed into the sheet

| Condition | Meaning | Colour |
|-----------|---------|--------|
| C ≠ A | Your unsaved edit | 🔵 Blue |
| B ≠ A | Changed in the store since your last pull | 🟠 Amber |
| B ≠ A **and** C ≠ A | Conflict — both changed | 🔴 Red |

## Push safety

On **Push**, the sheet sends each edited cell together with its baseline. The
**server** re-reads the live value and compares:

- live value still equals baseline → apply the edit.
- live value differs from baseline → **conflict**; the field is *not* written and
  is reported back (highlighted red in the sheet).

"⚠ Push & overwrite conflicts" sends `force: true` to write anyway. This makes
the server — not a possibly-stale sheet — the authority at write time.

## Shared write path

All edits go through `OctBulkEditor::set_field_value()` — the **same setter** the
in-app grid and the CSV import use. So the sync inherits every nuance: stock
status recalculation, the Variant Showcase "expand parent on first tick"
convenience, and the Aelia per-currency price arrays. There is no second copy of
the write logic to drift out of sync.

`OCTWBE_Fields` owns the column model: the column list, the editable
column→field map (both mirroring the CSV), how to read a column's current value
as a canonical string, and how to compare two values.

## Columns

Mirrors the CSV export header:

```
id, type, parent_id, product, variation, sku, regular_price, sale_price,
stock_qty, stock_status, status, on_category, lifestyle_image_id, fabric_group,
price_eur, sale_price_eur, price_usd, sale_price_usd, card_title, catalog_order,
manage_stock, backorders
```

Editable columns (everything except `id`, `type`, `parent_id`, `product`,
`variation`) map to the editor fields used by the in-app editor and CSV import.
The Apps Script fetches the column + editable lists from the store at runtime
(via `/ping`), so adding a column server-side flows through without editing the
script.

## Endpoints

All under `/wp-json/octwbe/v1`, authenticated with the token via `X-OCTWBE-Token`
header (or `Authorization: Bearer` / `?token=`).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/ping` | Connectivity + columns, editable list, currency, stock-readonly flag |
| GET | `/products?page=&per_page=&search=&category=` | Catalogue rows (variations expanded, one row each, sorted like the grid) |
| POST | `/push` | `{ force, changes: [{ id, column, value, baseline }] }` → `{ saved, conflicts, errors }` |

## Setup

1. **WooCommerce ▸ Sheets Sync** in wp-admin → **Generate token & enable**.
2. Copy the generated Apps Script (store URL + token are pre-filled).
3. In a Google Sheet: **Extensions ▸ Apps Script**, paste, **Save**, reload the
   sheet.
4. Use the **Bulk Editor** menu: **⬇ Pull**, edit, **🔍 Check for changes**,
   **⬆ Push my changes**.

## Stock handling

Stock quantity is **read-only by default** (`octwbe_sync_stock_readonly`, on).
Stock shows in the sheet but is never pushed back, so live inventory is never
clobbered by a stale sheet. Untick the setting on the Sheets Sync screen only if
the sheet is your source of truth for stock; the server still enforces this
regardless of what the sheet sends. (`manage_stock` and `backorders` are policy
fields and remain editable.)

## Multiple stores (e.g. one WooCommerce per country)

Each store has its own token and REST API, so the same pattern scales: set up a
separate sheet (or tab) per store with that store's token. Prices, sale prices
and EUR/USD prices stay independent per store. Conflict detection is per-store —
a row can be clean in one store and a conflict in another.

## Files

- `dev/oct-bulk-editor/includes/class-octwbe-fields.php` — column model: read /
  compare / column + editable maps.
- `dev/oct-bulk-editor/includes/class-octwbe-rest.php` — REST controller +
  conflict detection (writes via `OctBulkEditor::set_field_value`).
- `dev/oct-bulk-editor/includes/class-octwbe-sync-page.php` +
  `includes/sync-page-view.php` — admin screen: token, settings, script.
- `dev/oct-bulk-editor/assets/google-apps-script.gs` — the Apps Script template
  (`__API_BASE__` / `__TOKEN__` are filled in when shown in wp-admin).

## Security notes

- The token grants read/write to products — treat it like a password. Revoke +
  regenerate on the Sheets Sync screen if leaked (any connected sheet then needs
  the new script).
- All endpoints require the token; there is no anonymous access. Token comparison
  uses `hash_equals`.
