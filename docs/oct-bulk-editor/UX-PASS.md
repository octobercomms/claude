# Bulk Editor — UX pass (v1.13.0)

Follow-up to the OMI restyle, targeting "still overwhelming." Four changes:

## 1. Tooltips
Every column header and the main controls (Save, Apply, Export/Import, group-by,
the column groups) carry a `title` tooltip explaining what they do.

## 2. Show all / Hide all + per-group toggle
The **Columns** bar has **Show all** / **Hide all** links, and each group title
(Core / Pricing / Stock / Catalogue / Fabric) is **clickable** to toggle just that
group. Choices still persist per user (`octwbe_columns_v1`).

## 3. Export / Import moved to the top bar
CSV **Export** / **Import** now live in the top toolbar next to Save (they're
document-level actions), out of the bulk-edit row.

## 4. Sortable column headers
Click a header to **sort the variations within each product** by that column;
click again to reverse (arrow shows the direction). Sorting keeps the
product → variation (and group) structure intact, so e.g. sorting by
**On Category Page** brings the shown-on-category variations together within each
product. Blanks always sink to the bottom; numbers sort numerically.

## Proposed next (not built yet)
- **Column "views"** — one-click presets ("Stock view", "Pricing view",
  "Catalogue view", "Everything") that set the visible columns for a task. This
  is the biggest lever against the remaining overwhelm.
- **Sticky Product/Variation column** so the name stays visible when scrolling
  the wide grid horizontally.
