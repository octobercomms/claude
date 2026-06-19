# Dummy guide — deploying Another Country Lead Times

Plain-English, click-by-click. Do it on **staging first** if you have one. The
golden rule: **nothing customer-facing changes until you start filling in
suppliers** — the plugin is seeded to show exactly what the site shows today.

Total time: ~30–45 minutes. You'll need WordPress admin access and a way to edit
two theme files (Appearance → Theme File Editor, or SFTP/host file manager).

---

## STEP 0 — Take a backup (5 min)

1. WordPress admin → **UpdraftPlus** → **Backup Now** → tick database + files →
   **Backup Now**. Wait for "The backup apparently succeeded".
2. Separately, **save a copy of two theme files** to your computer so you can
   paste them back if needed:
   - `wp-content/themes/merchandiser-child/functions.php`
   - `wp-content/themes/merchandiser-child/woocommerce/content-single-product-half.php`

> If you can't easily edit theme files, stop here and do it via SFTP / your
> host's File Manager — that way a bad edit can always be reverted.

---

## STEP 1 — Install the plugin (3 min)

1. Admin → **Plugins → Add New Plugin** → **Upload Plugin** (top of page).
2. **Choose File** → select `anothercountry-lead-times.zip` → **Install Now**.
3. Click **Activate Plugin**.
4. Check it worked: go to **WooCommerce → Lead Times**. You should see the new
   screen. ✅

At this point nothing on the live site has changed yet — you've only added the
engine.

---

## STEP 2 — Check the global defaults (3 min)

1. **WooCommerce → Lead Times**.
2. Under **Global defaults**, confirm:
   - **Default lead time** = `8-10 weeks`
   - **Default seasonal note** is ticked **Active**, `07-01` to `09-30`, text
     "Allow up to 15 weeks for orders placed July to September."
3. Under **Stock label**, confirm:
   - **Relabel stock statuses** = ticked
   - **"On backorder" label** = `Made to Order`, colour `#77a464`
   - **"Out of stock" label** = `Out of Stock`, colour `#ff0000`
4. Click **Save lead times** (even if you changed nothing — this writes the
   settings).

These match the current site, so customers see no difference yet.

---

## STEP 3 — Update `functions.php` (10 min)

This swaps the old hardcoded lead-time code for code that reads from the plugin.

1. Open `wp-content/themes/merchandiser-child/functions.php` (Appearance → Theme
   File Editor → Theme Functions, or via SFTP).
2. **Find the old block.** Use the editor's search (⌘F / Ctrl-F) for:
   `PDP trust chips`
   You'll land on a comment like
   `===== OCTOBER COMMS ADDITION - START ===== ... PDP trust chips ...`.
3. **Select and delete** everything from that
   `/* ===== OCTOBER COMMS ADDITION - START =====` line
   down to its matching
   `/* ===== OCTOBER COMMS ADDITION - END ===== */`
   — i.e. the four functions `ac_lead_time_field`, `ac_save_lead_time_field`,
   `ac_get_lead_time`, and `ac_pdp_trust_chips`. (Only that block. Leave the
   variation-drawer and swatch blocks alone.)
4. **Paste the replacement** in its place. Open
   `docs/anothercountry-lead-times/theme-patches/functions-ac-lead-times.php`,
   copy **everything except the very first line `<?php`**, and paste it where the
   old block was.
5. **Save** (Update File).
6. **Immediately load the front-end** in another tab. If the site loads
   normally, great. If you see a white screen / error, paste your saved
   `functions.php` back (this is why we kept a copy) and tell me.

---

## STEP 4 — Update the product template (5 min)

This removes the bad tooltip and fixes the "Made to Order **and** In Stock"
double label.

1. Open
   `wp-content/themes/merchandiser-child/woocommerce/content-single-product-half.php`.
2. **Search** for `lead_time_popup_text`.
3. **Delete the tooltip block** — the `//LEAD TIME TEXT` lookups **and** the
   `<style>…:before{ content:… }…</style>` immediately after them (the exact
   lines to remove are shown in
   `docs/anothercountry-lead-times/theme-patches/content-single-product-half-changes.md`).
   Leave the lighting `<script>` just below it alone.
4. *(Optional, for the double label)* add the small JavaScript snippet from that
   same `content-single-product-half-changes.md` file.
5. **Save.**

---

## STEP 5 — Test on real products (5 min)

Open these on the front-end (logged-out / incognito is best):

- **A made-to-order product** (e.g. *Desk Two, Oak*):
  - Badge by price = **Made to Order** (green). ✅
  - Below: "Delivered in **8-10 weeks** lead time. *Allow up to 15 weeks for
    orders placed July to September.*" ✅
  - **No tooltip** popping out of the badge. ✅
  - No repeated "Made to order…" wording. ✅
- **An in-stock product**: badge = **In Stock**; line reads "Ready to
  dispatch…". ✅
- **A variable product** (e.g. *Dining Table Five*): **only one** status label
  shows (not both). ✅

If anything looks off, take a screenshot and send it before continuing.

---

## STEP 6 — Remove the extra plugin (2 min)

Now the new plugin produces the "Made to Order" label + colour, so the old one
is redundant.

1. Admin → **Plugins** → find **Woo Custom Stock Status** → **Deactivate**.
2. Reload a product page and re-check the badge still says **Made to Order** in
   green. ✅
3. If it still looks right after a day, you can **Delete** that plugin.

> If your **cart or checkout** pages used the old plugin's custom labels and
> they now look wrong, don't delete it — tell me and I'll extend the new plugin
> to cover those screens first.

---

## STEP 7 — Fill in suppliers (ongoing, no rush)

This is the payoff: edit lead times in one place, per manufacturer.

1. **Add suppliers:** WooCommerce → Lead Times → **+ Add / manage suppliers** →
   add Portugal, Welwyn, Slow & Another Sofa, Hardy, etc.
2. **Assign products** (in batches):
   - **Products** list → tick several products → **Bulk actions → Edit →
     Apply** → set **Supplier** → **Update**.
   - Use the **Filter by supplier** dropdown above the list to find unassigned
     sets.
3. **Set each supplier's lead time:** WooCommerce → Lead Times → fill base /
   out-of-stock / note / seasonal → **Save lead times**.

As soon as a supplier is saved, its products use those figures. Until then they
keep showing today's wording — so you can do this gradually with zero risk of
wrong info going live.

---

## If something goes wrong (rollback)

- **Bad theme edit:** paste back your saved `functions.php` /
  `content-single-product-half.php`.
- **Want to undo everything:** Plugins → **Deactivate** "Another Country Lead
  Times", and **Reactivate** "Woo Custom Stock Status". No data is lost — your
  product lead-time values and suppliers stay saved.
- **Total restore:** UpdraftPlus → **Restore** the backup from Step 0.

Ping me at any step and I'll talk you through it.
