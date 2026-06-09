# Shopify App Store — listing assets brief

What you need to produce for the listing, what to put in each image, and how to screenshot them at the exact required dimensions.

## What's required

| Asset | Dimensions | Quantity | Status |
|---|---|---|---|
| **App icon** | 1200×1200 PNG | 1 | You have this — your existing "O" mark |
| **Feature image** | 1600×900 PNG | 1 | See `assets/feature-image.html` mockup below — open and screenshot |
| **Screenshots** | 1600×900 PNG | 3–5 | Take from the real app (existing dev-store install + platform UI) |

Save all final PNGs into `docs/october-mi-shopify/assets/` so we keep them in the repo for resubmission.

---

## How to screenshot at exactly 1600×900 on macOS

Two reliable methods. Use whichever you find quicker.

### Method A — Chrome devtools

1. Open the page you want to capture in Chrome
2. `Cmd + Option + I` → opens devtools
3. `Cmd + Shift + M` → toggles device-toolbar mode
4. At the top, change "Responsive" → set width `1600`, height `900`
5. Click the three-dot menu (top-right of devtools) → **Capture full size screenshot**
6. Chrome saves a PNG at the exact dimensions

### Method B — `screencapture` from Terminal

For when method A is fiddly. Open the page in browser, then in a Terminal:

```bash
# Wait 5 seconds, then capture the area you drag-select; saves to Desktop
screencapture -i -T 5 ~/Desktop/screenshot.png
```

Drag-select roughly the right area, then crop to 1600×900 in Preview (`Cmd + K` → "Custom" → 1600×900).

---

## Feature image (1600×900) — the hero

This is the big image at the top of your App Store listing page. It's the first thing every visitor sees.

I've written a ready-to-screenshot HTML mockup at:

**`docs/october-mi-shopify/assets/feature-image.html`**

To use it:

```bash
cd ~/code/claude/docs/october-mi-shopify/assets/
open feature-image.html
```

That opens it in your default browser. Use Chrome devtools method A above (set width 1600, height 900, capture full size screenshot). Save the PNG as `feature-image.png` in the same folder.

If you want to edit colours, headline, or sub-headline, the HTML is plain — open it in TextEdit or VS Code, edit, refresh the browser, re-screenshot.

---

## Screenshots (1600×900, 3–5 of them)

Shopify wants visual proof the app actually works. Aim for **4 screenshots** taken from the real app (a fifth is nice-to-have, not required).

### Screenshot 1 — Pairing screen in Shopify admin

The screen that asks for the 24-character pairing token. Source: your dev-store install of the app.

**How to get it:**

1. In your existing dev store, navigate to **Apps → October Marketing Intelligence**
2. The pairing screen shows. (If you've already paired, uninstall and re-install for a fresh copy.)
3. Screenshot the browser content area at 1600×900

**What it should show:** The full pairing card with the "Paste the 24-character pairing token…" copy and the input field.

### Screenshot 2 — Connected state with sync stats

The "Connected to October Communications · Live" screen — the one you saw today.

**How to get it:**

1. Stay logged into the dev store, **Apps → October Marketing Intelligence**
2. Should show the green "Connected" card with **Last sync** and **Events synced this week** tiles
3. Screenshot at 1600×900

### Screenshot 3 — Platform dashboard

A screenshot from `platform.octobercomms.com` showing the data flowing in. Best candidate: a client's Overview page showing revenue / orders / customers numbers.

**How to get it:**

1. Open `platform.octobercomms.com` in Chrome
2. Pick a real client with active Shopify data (Another Country, Goldfinger — any with traffic)
3. Navigate to their **Overview** or **Sales & Traffic** page
4. Screenshot the main content area at 1600×900

**What it should show:** Headline metrics + at least one chart showing the data your agency works with.

### Screenshot 4 — Sample report

A weekly or monthly report PDF, ideally one that uses Shopify data.

**How to get it:**

1. Open one of the reports we generated today in your inbox (the Another Country / Goldfinger ones)
2. Open the attached PDF in Preview
3. Take a screenshot of one good page — the Executive Summary or a metrics-grid section
4. Crop / resize to 1600×900

### Screenshot 5 (optional) — Integrations hub

The new **Settings → Integrations** tab — shows the breadth of integrations the platform handles.

**How to get it:**

1. `platform.octobercomms.com/settings?tab=integrations`
2. Screenshot the main content area at 1600×900

---

## Caption suggestions

Shopify lets you add a one-line caption under each screenshot. Suggested captions:

| Screenshot | Caption |
|---|---|
| 1. Pairing | _One token from your agency, pasted once — that's the entire setup._ |
| 2. Connected | _Real-time sync confirmed. Last sync timestamp and event count visible._ |
| 3. Platform dashboard | _Your agency sees orders, customers and revenue as they happen._ |
| 4. Sample report | _Automated weekly reports — no spreadsheets to send._ |
| 5. Integrations hub | _One platform across Shopify, Google Ads, Meta, Klaviyo, SEO and more._ |

Tweak the voice to match. Keep each under 80 characters.

---

## App icon — what works

You said you have your icon. Quick sanity check before submission:

- 1200×1200 PNG
- Square (Shopify rounds the corners automatically)
- Solid background — transparent works, but solid colour reads better on the marketplace cards
- Recognisable at 64×64 (Shopify uses it tiny in search results) — avoid fine detail

October brand palette to match for the feature image / background:

- **Primary**: `#0a0a0a` (near-black) — the platform sidebar colour
- **Accent**: `#FFD600` (golden yellow) — the platform's highlight / CTA colour
- **Surface**: `#FAFAF7` (off-white) — the platform's main content background

---

## Production order

Recommended sequence (so you do the easiest first and only revisit if needed):

1. Screenshot 1 + 2 from your existing dev store install — 5 minutes
2. Screenshot 3 + 5 from `platform.octobercomms.com` — 5 minutes
3. Screenshot 4 from a real report — 5 minutes
4. Feature image: open the HTML mockup, edit copy if you want, screenshot — 10 minutes
5. App icon: confirm it's 1200×1200, export final PNG — 5 minutes

Total: ~30 minutes of pure click-and-shoot if you don't need to redo anything.

Once all six PNGs are in `docs/october-mi-shopify/assets/`, commit them and tell me — that finishes step 5 and we're cleared for steps 7 + 8.
