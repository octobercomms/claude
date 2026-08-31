# Section 9 — Brand assets (URLs; binaries not piped through this session, see tooling-limits
note — Daniel can pull these directly, none require login)

## Logo / favicon (also in section2-design-tokens.md)
- Logo (dark): `https://nvelope.co/wp-content/uploads/2026/01/logo-envelope.svg`
- Favicon: `https://nvelope.co/wp-content/uploads/2026/01/logo-envelope-icon.svg`
- Light logo variant: not set on this Studio (field empty)

## Hero / section images (landing page, `/studio/nvelope/`)
- `https://nvelope.co/wp-content/uploads/2026/01/studio-1-scaled.webp` (the "Clarity before
  commitment" panel image)
- `https://nvelope.co/wp-content/uploads/2026/01/hero-6.jpeg.webp`
- `https://nvelope.co/wp-content/uploads/2026/01/hero-7.jpeg.webp`
- `https://nvelope.co/wp-content/uploads/2026/01/hero-8.jpeg.webp`
(hero-6/7/8 are very likely the three "Examples of projects we typically take on" images —
substantial residential extension / high-end home extension / new private home development)

## Intro video (hero, autoplay, self-hosted)
`https://nvelope.co/wp-content/uploads/2026/02/nvelope-square.mp4`

## Trust badges (RIBA / ARB / AIA)
Rendered as inline SVG or icon-font glyphs, not `<img>` tags — didn't resolve to standalone image
URLs from a DOM scan. **Quickest path for Daniel**: Media Library → search "RIBA" / "ARB" / "AIA",
or inspect the Studio post's `studio_organisations_logos` field (Section 2) which is a checkbox
list, not a media picker — meaning these badges are almost certainly a small fixed set of
SVGs/icons bundled with the JetEngine field definition itself (a fixed enum of 3 orgs with
built-in artwork) rather than uploadable media. Worth confirming directly in the JetEngine field
editor (Meta Boxes → Studio → find `studio_organisations_logos`) rather than the Media Library.

## Icons used in "How we work"
Three inline icon glyphs (question-mark-on-easel, triangle/prism, flag) — rendered as inline
SVG directly in the page markup, not separate image files. Not extracted as standalone assets;
low priority to chase further given they're simple line icons, easy to recreate or trace from the
screenshot in `rendered/landing-desktop/`.
