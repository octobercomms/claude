# Section 3 — Elementor templates

Could not retrieve exported JSON files directly (WP's "Export" links trigger a browser file
download into the browser's own Downloads folder, which this session's tools can't read back —
see the tooling-limits note sent to Daniel early in this harvest). **Daniel: each row below has
an "Export" link in Templates → Saved Templates — two clicks each, ~8 files total.**

## Saved Templates (`elementor_library`, Templates → Saved Templates) — 7 items
| Title | Type | Elementor template ID (shortcode) | Last edited |
|---|---|---|---|
| Advice Hub Single | Single | `499` | 2026/01/27 |
| Header (Empty) | Header | `51` | 2026/01/19 |
| Studio Archive | Archive | `45` | 2026/01/19 |
| Footer | Footer | `34` | 2026/01/19 |
| Header | Header | `30` | 2026/01/19 |
| **Single Studio** (the landing page template) | Single | `23` | 2026/01/19 |
| Default Kit | Kit (global styles) | — | 2026/01/19 |

Two Header templates exist — "Header" (30) is presumably the live one and "Header (Empty)" (51)
a fallback/unused variant; worth Daniel confirming which is actually assigned via Theme Builder
conditions before exporting both.

## Popups (`jupiterx-popups` CPT — Raven/JupiterX popup system, separate from Saved Templates)
**Only ONE popup exists site-wide**: "Asset Drawer" — post ID **848**, "Instances: Entire Site".
This single template handles the asset-detail view (title/standfirst/body/Download PDF) AND
appears to also render the "Unlock the full library" email-gate content and the unlocked variant
— almost certainly via Elementor/Raven conditional display logic switching what's shown inside
the same popup based on gated/unlocked state, rather than being three separate popup templates as
the brief assumed. Export via Templates → Saved Templates doesn't list it (it's a different CPT);
export from **Popups → Asset Drawer → Export Popup**, or Advice Hub post list → Popups menu.

## Global Kit
"Default Kit" template = Elementor's global design system (default colors/fonts/spacing used
site-wide unless overridden) — worth exporting too since it may hold defaults that the
per-Studio JetEngine fields (Section 2) override.
