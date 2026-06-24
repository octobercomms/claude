---
name: october-design-system
description: Apply October's house visual design system to any app in this repo. Use when the user wants to style, restyle, theme, or "lift"/"polish"/"modernise" an app's UI to match October Marketing Intelligence (OMI) — the two-tone look (white surfaces, black text, one accent), Brockmann type, thick 2px borders, chunky radii, sanctioned semantic colours, and the soft depth/polish layer (shadows, frosted overlays, canvas warmth, hover lift). Also use when the user mentions "October design system," "OMI design," "design tokens," "house style," "make it look like the platform," "apply the design settings," "add depth/polish," "design effects," or "brand this app." For greenfield generic UI/UX decisions unrelated to October's house style, see ui-ux-pro-max instead.
metadata:
  version: 1.0.0
---

# October Design System

October's apps share one visual language, first codified in **OMI** (October
Marketing Intelligence, `dev/platform/frontend`). This skill packages that
language so it can be applied to any other app in the repo consistently.

The portable implementation lives next to this file:
**`assets/october-ui.css`** — a self-contained, app-agnostic stylesheet
(design tokens + core component primitives + the depth/polish layer). The
canonical, always-current source is `dev/platform/frontend/src/index.css`;
treat `october-ui.css` as the reusable snapshot to copy from.

## The design language (non-negotiables)

1. **Two-tone discipline.** Every page is **white surface + black text + one
   accent**. The accent (brand yellow `#E7CD41`) is reserved for
   action / active / highlight — never decoration. Bentos are white with a
   soft grey border (`--card-border`).
2. **Only three extra hues.** Beyond the two-tone palette, the *only*
   sanctioned colours are `--positive` / `--negative` / `--warning` (and
   their `-soft` fills) — for deltas, profit/loss, success/error. Do not
   introduce other colours.
3. **Brockmann everywhere.** One typeface (`--font`), no second font.
4. **Thick lines, chunky radii.** Borders are `2px` (`--border-w`); radii are
   generous (`--r-sm/md/lg`, plus `--r-pill`).
5. **Dark chrome only for the rail.** A sidebar/nav may go dark for contrast;
   the rest of the app stays light and clean.
6. **Depth, not decoration.** The polish layer is soft elevation, frosted
   overlays, a faint warm canvas, and a hover lift — never gradients-as-
   colour, glows, or drop-shadow theatrics. Keep it subtle but *visible*.

## Token reference

Set once in `:root` (see `october-ui.css` for the full block):

- **Surfaces** `--page-bg --surface --surface-raised --surface-sunken`
- **Ink** `--text --text-muted --text-subtle --border-neutral --card-border`
- **Accent** `--accent --accent-soft --accent-on` *(override per app for a
  different brand colour; keep `--accent-on` legible on the fill)*
- **Semantic** `--positive(-soft) --negative(-soft) --warning(-soft)`
- **Dark chrome** `--sidebar-bg/-fg/-muted/-subtle/-border`
- **Type** `--font` · **Spacing** `--s1`…`--s10` (4pt base) ·
  **Radii** `--r-sm/md/lg/pill` · **Border** `--border-w`
- **Depth** `--shadow-xs/sm/md/lg --shadow-accent`

## Component vocabulary

`october-ui.css` ships these primitives — prefer them over bespoke styles:

- **Type:** `.display .h1 .h2 .h3 .body .body-sm .body-xs .caption .metric`
- **Cards:** `.card` + modifiers `.raised .accent .plain .outline .filled
  .success .danger .warning`; list internals `.card-stat*`, `.health-dot`
- **KPIs:** `.stat-strip > .stat` (+`.feature` ink card); `.metric-grid >
  .metric-card` (+`.accent`)
- **Buttons:** `.btn` + `.btn-primary .btn-secondary .btn-ghost .btn-danger`
- **Chips:** `.chip` + tone modifiers · **Callouts:** `.callout` + tones
- **Tables:** `.table` · **Empty:** `.empty .empty-icon` · **Tabs:** `.tabs
  .tab` · **Forms:** `.input .select .textarea .field .field-label`
- **Layout:** `.grid .grid-2/3/auto .row .stack .spacer` · **Modal:**
  `.modal-backdrop .modal .modal-head .modal-close`

## The depth / polish layer

These are the "design effects" / "lift":

- `--shadow-*` tokens → soft elevation on `.card .stat .metric-card`.
- `.oc-canvas` → apply to the top-level scrolling container for a faint warm
  wash on the page background.
- `.oc-rail` → apply to a dark sidebar/nav for a top-to-bottom gradient.
- `.oc-lift` (or wrapping a card in `<a>`) → hover lift on interactive cards.
- `.btn-primary` → accent-tinted shadow + sheen + 1px hover lift.
- `.modal-backdrop` / frosted menus → `backdrop-filter: blur()`.
- `prefers-reduced-motion` is respected (elevation stays, motion drops).

**Dialing intensity:** turn the **shadow-token alphas** and the **`.oc-canvas`
wash alpha** up or down — that's the single knob for "more/less pronounced."
Current values are tuned for "clearly visible but tasteful." Halve the alphas
for whisper-subtle; raise them for a bolder lift.

## How to apply to a new app

1. **Confirm scope.** Which app (`dev/<app-name>`), and is it a full adoption
   or just the depth/polish lift on an existing look?
2. **Add the tokens + base.** Copy `assets/october-ui.css` into the app's
   styles (e.g. `dev/<app>/.../october-ui.css`) and import it once, *before*
   app-specific CSS. If the app already has its own reset/layout, you can take
   only the `:root` block + the "Depth & polish" section.
3. **Adopt primitives.** Replace bespoke buttons/cards/inputs/tables with the
   classes above. Keep app-specific *layout* local; pull shared *look* from
   the system.
4. **Wire the polish layer.** Add `.oc-canvas` to the scroll container,
   `.oc-rail` to any dark sidebar, and `.oc-lift` to clickable cards.
5. **Respect the brand rules** (CLAUDE.md): the two-tone discipline, accent =
   action only, the three sanctioned hues only. **Do not** rebrand OMI as
   "nvelope"; the nvelope funnel apps (`dev/oc-forms`, `dev/brevo-widgets`,
   `dev/meta-ads`) keep their own identity — don't force OMI styling onto
   them unless asked.
6. **Build & verify.** Build the app, and if it has no preview deploy, offer
   to screenshot the key surfaces so the user can review before shipping.
7. **Per-app accent (optional).** If the app needs a different brand colour,
   override `--accent` / `--accent-soft` / `--accent-on` in that app's
   `:root` — everything else inherits.

## Per-app placement (repo convention)

This repo follows a two-folder rule: code under `dev/<app>/`, docs under
`docs/<app>/`. The stylesheet is functional code — it lives **with the app's
code**, not in `docs/`. If you write design notes about the adoption, put
those in `docs/<app>/`.
