# Google Sheets sync (WooCommerce Bulk Editor)

Two-way sync between a WooCommerce store and a Google Sheet. Pull the catalogue
into a sheet, edit prices / sale prices / product data like a spreadsheet, then
push changes back so they go live. The sheet flags anything that changed in
WooCommerce since your last pull, so you always know what you would overwrite.

Added in plugin **v1.1.0**.

## How it works

There are two pieces:

1. **Plugin REST API** (`wbe/v1`) on the store, secured by a per-store token.
2. **A Google Apps Script** pasted into the sheet, which adds a **WooCommerce**
   menu (Pull / Check / Push). No third-party service or subscription.

The sheet keeps a hidden `_wbe_baseline` tab — a snapshot of exactly what it
last pulled. Conflict detection compares three versions of every cell:

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

## Endpoints

All under `/wp-json/wbe/v1`, authenticated with the token via `X-WBE-Token`
header (or `Authorization: Bearer` / `?token=`).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/ping` | Connectivity + store settings (currency, stock-readonly, columns) |
| GET | `/products?page=&per_page=&search=&category=` | Catalogue rows (variations expanded, one row each) |
| POST | `/push` | `{ force, changes: [{ id, field, value, baseline }] }` → `{ saved, conflicts, errors }` |

Editable fields: `regular_price`, `sale_price`, `sku`, `stock_qty`,
`stock_status`, `status`, `date_on_sale_from`, `date_on_sale_to`. Scheduled sale
dates (`date_on_sale_from/to`) mean a sale price set in the sheet goes live
automatically on the configured date.

## Setup

1. **WooCommerce ▸ Sheets Sync** in wp-admin → **Generate token & enable**.
2. Copy the generated Apps Script (store URL + token are pre-filled).
3. In a Google Sheet: **Extensions ▸ Apps Script**, paste, **Save**, reload the
   sheet.
4. Use the **WooCommerce** menu: **⬇ Pull**, edit, **🔍 Check for changes**,
   **⬆ Push my changes**.

## Stock handling

Stock quantity is **read-only by default** (`wbe_sync_stock_readonly`, on). Stock
shows in the sheet but is never pushed back, so live inventory is never clobbered
by a stale sheet. Untick the setting on the Sheets Sync screen only if the sheet
is your source of truth for stock; the server still enforces this regardless of
what the sheet sends.

## Multiple stores (e.g. one WooCommerce per country)

Each store has its own token and REST API, so the same pattern scales: set up a
separate sheet (or tab) per store with that store's token. Prices and sale prices
stay independent per store. Conflict detection is per-store — a row can be clean
in one store and a conflict in another.

## Files

- `dev/woo-bulk-editor/includes/class-wbe-fields.php` — canonical field read /
  compare / write, shared by the AJAX editor and the REST sync.
- `dev/woo-bulk-editor/includes/class-wbe-rest.php` — REST controller + conflict
  detection.
- `dev/woo-bulk-editor/includes/class-wbe-sync-page.php` +
  `includes/sync-page-view.php` — admin screen: token, settings, script.
- `dev/woo-bulk-editor/assets/google-apps-script.gs` — the Apps Script template
  (`__API_BASE__` / `__TOKEN__` are filled in when shown in wp-admin).

## Security notes

- The token grants read/write to products — treat it like a password. Revoke +
  regenerate on the Sheets Sync screen if leaked (any connected sheet then needs
  the new script).
- All endpoints require the token; there is no anonymous access. Token comparison
  uses `hash_equals`.
