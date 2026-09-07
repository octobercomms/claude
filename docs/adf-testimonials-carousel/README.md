# ADF Testimonials Carousel

Self-contained testimonials carousel for the Atlanta Design Festival site, built
to paste into an Elementor **HTML** widget. No external libraries.

Code: `dev/adf-testimonials-carousel/testimonials-carousel.html`

## Behaviour

- Shows three cards on desktop, two on tablet (≤1024px), one on mobile (≤600px).
- Auto-advances every 6.5s, one card at a time, looping back to the start.
- Pauses on hover and on keyboard focus.
- Previous / next arrows, clickable dots, and left/right arrow-key support.
- Respects `prefers-reduced-motion`.
- Equal-height cards regardless of quote length.

## Editing content

Open the file and edit the `TESTIMONIALS` array near the top of the `<script>`.
Each entry is `{ quote, name, role }`. Leave `role` as an empty string to hide
that line. The opening and closing quotation marks are added by CSS, so do not
wrap the `quote` text in quote marks.

## Styling

Colours, spacing, border thickness, and how many cards show on desktop are set
in the `:root` CSS variables inside the `.oc-tc` block (`--oc-accent`,
`--oc-card-border`, `--oc-card-radius`, `--oc-gap`, `--oc-visible`, etc.).

## Install in Elementor

1. Edit the page, drag in an **HTML** widget.
2. Paste the full contents of `testimonials-carousel.html`.
3. Update, then preview.
