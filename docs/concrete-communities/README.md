# Concrete Communities

Small CSS/snippet tweaks for the Concrete Communities WordPress site
(`concretecommunities-com.stackstaging.com`). The site is built with Jupiter X +
Elementor + JetEngine; there is no full theme/plugin codebase in this repo, just
targeted snippets that get pasted into the site.

Code snippets live in `dev/concrete-communities/`, these notes in
`docs/concrete-communities/`.

## Snippets

### `jetengine-slider-arrows.css` — Testimonials slider arrows

Restyles the arrows on the **Testimonials** JetEngine Listing Grid slider (home
page) so they match the simple arrow used by the Elementor **Image Carousel**
(e.g. the event single pages).

**What it does**

- Hides JetEngine's default `swiper-arrow` icon (the dark, filled
  rounded-square SVG).
- Repaints the arrow using a CSS `mask` so it renders as a **flat black arrow
  with no background**, using the same arrow shape as the Elementor carousel.
- Leaves position untouched — the arrows stay **above the grid**, where
  JetEngine already puts them.

**Why a mask instead of just recolouring:** the dark "box" is part of
JetEngine's SVG artwork, not a CSS background, so it can't be removed by
changing a colour. Hiding the SVG and masking in a fresh shape gives a clean,
background-free, solid-black arrow. JetEngine already mirrors the *next* arrow
with `transform: scaleX(-1)`, so a single left-pointing mask serves both arrows.

**How to apply**

1. WordPress admin → **Appearance → Customise → Additional CSS**
   (or the Elementor section's **Advanced → Custom CSS** box for the
   testimonials section).
2. Paste the contents of `jetengine-slider-arrows.css`.
3. Publish, then purge the cache (the site uses a cache — use **Purge Cache** in
   the admin bar) and hard-refresh.

**Tweaks**

- **Arrow size:** change the two `mask-size` values (`26px auto`).
- **Colour:** change `background-color: #000;`.
- **Hover:** the `:hover { opacity: .6; }` rule is optional — delete it to keep
  the arrows fully opaque on hover.
