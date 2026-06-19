# Deployment runbook — Another Country Lead Times

Goal: one central, supplier-based system for lead times; the approved stock badge
kept; the bad tooltip and the duplicated/contradictory text removed; one fewer
plugin. **Critically: nothing wrong goes live before the team has filled in the
suppliers.**

## Why it's safe to ship before suppliers are configured

The resolver has three layers (per-product → supplier → global default) and the
**global defaults are seeded to reproduce today's wording** (`8-10 weeks`, and
the `Allow up to 15 weeks…July–Sept` seasonal note). So on day one:

- Products with the existing `_ac_lead_time` field set → unchanged.
- Everything else → the global default (same as today's fallback).
- No supplier configured yet → contributes nothing.

Suppliers can then be filled in gradually; each one quietly takes over for its
products only once saved.

## Order of operations

1. **Install & activate** the `anothercountry-lead-times` plugin
   (`dev/anothercountry-lead-times/`). On activation it registers the *Supplier*
   taxonomy and seeds the safe defaults. The product **"Lead time"** field and
   the **"Made to Order" / colour** stock relabel are now provided by the plugin.

2. **Remove the duplicate from the theme `functions.php`:** delete the old
   *OCTOBER COMMS — PDP trust chips* block (the `ac_lead_time_field`,
   `ac_save_lead_time_field`, `ac_get_lead_time`, `ac_pdp_trust_chips` functions)
   and paste in `theme-patches/functions-ac-lead-times.php`. This stops the
   duplicate "Lead time" field and points the chips at the plugin.

3. **Edit the product template** per
   `theme-patches/content-single-product-half-changes.md`:
   remove the tooltip `<style>` block, and apply the double-label fix.

4. **Verify parity on staging** (before deactivating anything):
   - A made-to-order product (e.g. *Desk Two*): badge = "Made to Order"; chip =
     "Delivered in 8-10 weeks lead time. *Allow up to 15 weeks…*"; no tooltip;
     no "Made to order" duplication.
   - An in-stock product: badge = "In Stock"; chip = "Ready to dispatch…".
   - A mixed variable product (*Dining Table Five*): only **one** status label.

5. **Deactivate the "Woo Custom Stock Status" plugin.** The plugin's stock-label
   relabel (backorder → "Made to Order") + colour now reproduce it on the
   product page. Re-check a product page after deactivating.
   - If the cart/checkout relied on its custom labels too, tell us and we'll
     extend the relabel filter to those screens before removing it.

6. **Fill in suppliers over time** — WooCommerce → **Lead Times**:
   - Add suppliers (Portugal, Welwyn, Slow & Another Sofa, Hardy, …).
   - Set base / out-of-stock / note / seasonal per supplier.
   - Bulk-assign products to suppliers from the Products list (Bulk edit →
     Supplier), using the *Filter by supplier* dropdown to find them.

## Rollback

Deactivating the plugin restores the theme fallbacks (the patched `functions.php`
keeps safe defaults), and re-activating the Woo Custom Stock Status plugin
restores the old label path. No data is destroyed — `_ac_lead_time` values and
supplier terms remain.

## Single source of truth (after deploy)

| On the page | Comes from |
|---|---|
| "Made to Order / In Stock" badge + colour | plugin stock-label relabel |
| Lead-time figure + supplier note | plugin resolver (`aclt_get_lead_time` / `_note`) |
| Seasonal line | plugin resolver (`aclt_get_seasonal_note`) |
| Per-product exception | the existing `_ac_lead_time` field (now owned by the plugin) |
