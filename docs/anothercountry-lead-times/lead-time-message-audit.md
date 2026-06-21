# Lead-time message audit (export 2026-06-21)

Source: `acleadtimes2026-06-21.csv` — 602 products. Only **8 distinct "old
message" strings** exist, and they collapse to **3 real templates** plus noise.

## The groups

| # | Old message (gist) | Products | What it is | New lead time | Cover via |
|---|---|---|---|---|---|
| A | "standard manufacturing… 8-12 weeks… summer 11-15… call/email" | 550 | Another Country workshop (made to order) | `8-12 weeks` + seasonal note | **Global default** |
| B | "Stock Rugs… Armadillo's warehouse… approx. 6 weeks" | 41 | Armadillo, held in stock | `approx. 6 weeks` | **Supplier "Armadillo"** |
| C | "we generally only manufacture when ordered… 10-12 weeks" | 7 | Hardy Collection (David Irwin) | `10-12 weeks` | **Category bulk-apply** (Hardy Collection) |
| D | "Armadillo… approx. 2 weeks… restock 4-6 weeks" | 2 | Armadillo fast-stock (rug + entrance mat) | `approx. 2 weeks` | Per-product override |
| E | "A generous vessel…" / "Made of black stoneware…" / "inspired by Series One…" | 3 | ⚠️ Product descriptions, **not** lead times | — | Falls to global default |

Group membership is remarkably clean: **B = 41/41 in the Armadillo category**,
**C = 7/7 Hardy Collection**, so each is addressable as a whole group.

Group E is data noise: three Another Country Pottery Series items whose
"message" field had captured a product blurb. They never had a real lead-time
message and should simply inherit the 8-12 week default.

## Coverage plan (hybrid, agreed 2026-06-21)

1. **Global default** = `8-12 weeks` + seasonal note (summer close, early July –
   late September, may extend to 11-15 weeks). Silently covers A + E (~553).
2. **Supplier "Armadillo"** = `approx. 6 weeks`. Use the **Products tab →
   Armadillo category → "Assign all to supplier"** action (added v1.6.0) to
   attach all 41 in one click. Single source of truth: change the supplier's
   lead time later and all attached products update.
3. **Hardy Collection** = `10-12 weeks` via the category bulk-apply (set-and-
   forget; it's an in-house line, not an external vendor).
4. **Two Armadillo fast-stock items** (D): per-product override `approx. 2 weeks`.

Net effort: one global setting, one supplier assign, one category-apply, two
overrides → the entire 602-product catalogue covered.

> Note: the seasonal note is global and is appended only to "made to order"
> (backorder) badges. In-stock Armadillo items show "In stock" and never get the
> note. If an Armadillo item goes out of stock it would currently show the
> made-to-order badge + the AC summer note — a future refinement could make the
> seasonal note per-supplier if that edge case matters.
