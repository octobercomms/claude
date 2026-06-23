# OctoberComms Bulk Editor — Group variations & one-image-fills-group (v1.6.0)

Built for the Another Country sofa, where the photo varies by **Fabric** but is
identical across **Cushion Filling**. Rather than re-uploading the same image onto
every filling variation, you group the variations by an attribute and set the
image once for the whole group.

## How it works

1. Load products, then pick an attribute in **Group variations by** (the dropdown
   auto-fills from the attributes present on the loaded variations — e.g. Fabric,
   Size, Shape).
2. Each product's variations collapse under a **group header** per attribute value
   (e.g. "Fabric: Linen (4 variations)"). Click a header to collapse/expand its
   rows.
3. The group header has its own **image cell**. Click or drag-drop an image onto
   it and it's applied to **every variation in that group** at once — flowing
   through the normal change tracking, so nothing is written until you hit
   **Save All Changes**.

The individual variation image cells are still there and still editable — the
group header is just a fast applicator on top.

## Notes / behaviour

- **Grouping is per product.** Each parent's variations are grouped independently;
  a product that doesn't have the chosen attribute just lists its variations flat.
- The group header shows a shared thumbnail only when **all** members already use
  the same image; otherwise it starts empty.
- Toggling grouping re-renders the grid and **re-applies any unsaved edits**
  (including pending image fills), so you don't lose work mid-session.
- Driven entirely client-side from data the server already sends per variation
  (each variation now carries its individual `attributes` — name, label, value,
  value label). No new save path: group fill writes the same per-variation
  featured-image change as editing each cell by hand.
- Keep the **Image** column visible (it is by default) to use the group image
  cell — hiding the Image column hides the group applicator too.
