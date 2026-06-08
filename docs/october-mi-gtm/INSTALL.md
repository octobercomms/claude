# October MI GTM container — installation guide

This guide is for the October account manager (AM) installing the October
Marketing Intelligence (OMI) tracking container into a client's existing Google
Tag Manager (GTM) **web** container.

The container is shipped as a single export file, `october-mi-v1.json`. It
contains every tag, trigger and variable the client needs, with all
client-specific IDs left as **User-Defined constant variables** that you fill in
once after import.

## Prerequisites

- The client has a published GTM **web** container already installed on their
  site (the `GTM-XXXXXXX` snippet is in the page `<head>` and `<body>`).
- You have **Edit** (ideally **Publish**) access to that container.
- The client's site pushes an ecommerce **dataLayer** using the standard GA4
  event names (`purchase`, `add_to_cart`, `view_item`, `begin_checkout`,
  `view_cart`, `add_to_wishlist`, `search`) with an `ecommerce` object
  containing `value`, `currency`, `items` and, for purchases, `transaction_id`.
  If the site does not yet do this, raise it with the developer before
  installing — the event tags will simply not fire without it.
- You have the five client values to hand (see the table below).

## Step 1 — Import the container

1. Open the client's container in GTM.
2. Go to **Admin → Import Container**.
3. **Choose container file** and upload `october-mi-v1.json`.
4. **Choose workspace** — select an existing workspace or create a new one
   (e.g. "OMI install").
5. **Choose an import option**:
   - Select **Merge** (not Overwrite).
   - Select **Rename conflicting tags, triggers and variables**.
   - **Merge** preserves everything the client already has and only adds the OMI
     items. **Overwrite** would wipe the client's existing setup — never use it.
6. Review the preview of what will be added, then click **Confirm**.

## Step 2 — Set the five client variable values

After import, open **Variables → User-Defined Variables** and edit each of the
five **Constant** variables below, replacing the placeholder with the client's
real value. Save each one.

| Variable | Type | Placeholder in template | Where to find the value |
|----------|------|-------------------------|-------------------------|
| `GA4 Measurement ID` | Constant | `G-XXXXXXXXXX` | GA4 → Admin → Data Streams → (web stream) → **Measurement ID** (starts `G-`). |
| `Meta Pixel ID` | Constant | `000000000000000` | Meta Events Manager → Data Sources → (the pixel) → the 15–16 digit **Pixel ID**. |
| `TikTok Pixel ID` | Constant | `XXXXXXXXXXXXXXXXXXXX` | TikTok Ads Manager → Tools → Events → Web Events → (the pixel) → **Pixel ID**. |
| `LinkedIn Partner ID` | Constant | `0000000` | LinkedIn Campaign Manager → Analyze → Insight Tag → **Partner ID** (numeric). |
| `OMI Client ID` | Constant | `omi-client-xxxx` | October platform → client record → **OMI Client ID**. Ask the platform team if unsure. |

Leave the Data Layer Variables (`DLV - ...`) and built-in variables untouched —
they read from the client's dataLayer and need no configuration.

## Step 3 — Preview and verify

1. Click **Preview** (top right) and enter the client's site URL to launch Tag
   Assistant.
2. On the connected site, check the **Tags Fired** panel:
   - On any page load you should see **GA4 - Configuration**,
     **Meta Pixel - Base**, **TikTok Pixel - Base**, **LinkedIn Insight Tag**
     and **October MI Pixel - All Pages** fire.
   - Trigger an ecommerce action (add to cart, begin checkout, complete a test
     purchase) and confirm the matching GA4/Meta/TikTok event tags and, for a
     purchase, **October MI Pixel - Purchase** fire.
3. Spot-check the values: in Tag Assistant, open a fired event tag and confirm
   `value`, `currency` and `items` are populated (not `undefined`). If they are
   empty, the site's dataLayer is not pushing the expected `ecommerce` object —
   go back to the developer.
4. Confirm the OMI pixel request hit `platform.octobercomms.com/api/mi-pixel`
   with the correct `client_id` (browser DevTools → Network, filter `mi-pixel`).

## Step 4 — Publish

1. Exit preview.
2. Click **Submit** (top right).
3. Give the version a clear name, e.g. `OMI v1 install — <client name>`.
4. **Publish**.

## Updating to a later version

New template revisions are shipped as `october-mi-v2.json`,
`october-mi-v3.json`, and so on (see the versioning note in `README.md`).

To update a client:

1. Repeat **Step 1** with the new file, again choosing **Merge** and **Rename
   conflicting tags, triggers and variables**.
2. Because the five client values live in GTM variables — not in the JSON — a
   Merge import does **not** overwrite them. The client's filled-in IDs and any
   bespoke tags they have added are preserved.
3. Review the import preview to see exactly what changed, then preview and
   publish as in Steps 3–4.

If a future version intentionally removes or renames a tag, that will be called
out in the version's release notes so you know what to expect in the preview.

## Conversions API (CAPI) note

This container fires the **browser-side** Meta Pixel only. Server-side
Conversions API bridging (deduplicated server events for Meta) runs separately
in the October platform's server-side stack and is not part of this container.
No action is needed here for CAPI; it is configured platform-side per client.
See `README.md` for the scope summary.
