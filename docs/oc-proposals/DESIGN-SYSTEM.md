# October Proposals — Design system (copies OMI)

**Decision:** the plugin's default design tokens **are the OMI design system**
(`dev/platform/frontend`), so every proposal — web page, pricing table, PDF, admin — matches
OMI out of the box. Daniel can still override fonts/colours in Settings, but the defaults are
these. This is the "I only want to change fonts and colours" requirement, pre-answered by
adopting a system you already own and ship.

## Tokens (lifted verbatim from OMI `src/index.css`)

| Token | Value | Use |
|-------|-------|-----|
| Font | **Brockmann** (one typeface, everywhere) | all text |
| `--page-bg` | `#faf9f5` | warm off-white page background |
| `--surface` | `#ffffff` | cards / sheets |
| `--surface-raised` | `#fafafa` | raised panels |
| `--surface-sunken` | `#f3f3f3` | wells |
| `--text` | `#1a1a1a` | body ink |
| `--text-muted` | `#555555` | secondary |
| `--text-subtle` | `#888888` | tertiary |
| `--border-neutral` | `#1a1a1a` | **thick near-black border (house style)** |
| `--card-border` | `#e3e2db` | soft bento border |
| `--accent` | `#E7CD41` | gold accent (fills/highlights) |
| `--accent-on` | `#1a1a1a` | **black text on the gold** |
| `--accent-soft` | `rgba(231,205,65,.12)` | tints |
| `--positive` | `#2e7d32` | good |
| `--negative` | `#c62828` | bad |
| `--warning` | `#b86e00` | caution |
| radii | `8 / 14 / 20 / 999` | `--r-sm/md/lg/pill` |
| border width | **`2px`** | thick borders are the house style |
| spacing | 4pt scale (`4,8,12,16,20,24,32,40…`) | `--s1…--s10` |

## House-style rules

- **Bento cards:** white surface, thick 2px border (black for emphasis or soft grey for
  calm), generous radius. The proposal sections render as bento blocks.
- **Gold is a highlight, not text** — use `#E7CD41` as a fill (buttons, active stage,
  ROI panel) with **black text on top**; never gold text on white (fails contrast).
- **Accent buttons** = gold fill + black label.
- **One typeface** (Brockmann) at varied weights — no serif.

## How it reaches each surface

- **Web proposal + admin:** reuse OMI's class-based system (`.btn/.card/.chip` + the CSS
  variables) directly, or the Tailwind layer that reads the same vars.
- **PDF (mPDF):** the same token *values* baked into the mPDF-safe template; **bundle the
  Brockmann font files** in the plugin (mPDF embeds fonts from disk — same mechanism
  Architourian uses for `ballingermono`).
- **Settings override:** font + the colour tokens are editable; everything inherits via the
  CSS variables, so a re-skin is a few field changes.

> Font licensing note: confirm the **Brockmann** licence covers web embedding **and** PDF
> font-embedding for octobercomms.com before shipping. If not, swap the `--font` token for a
> licensed near-match — nothing else changes.

The pricing-table mockup (`mockups/pricing-table.html`) is already re-skinned to these tokens
as a worked example.

## Backend adoption (v0.12.0)

The plugin **backend** now follows the October Design System via a portable
snapshot, `dev/oc-proposals/assets/css/october-ui.css` (tokens + primitives +
the depth/polish layer), derived from the canonical OMI source
(`dev/platform/frontend/src/index.css`). It's enqueued before `admin.css`, which
restyles the admin to the house look: a warm canvas wash (scoped to this
plugin's screens), soft elevation on cards, a hover lift on clickable cards,
accent buttons with an accent-tinted shadow, and house-styled core WP controls
(buttons, inputs, tabs) — all scoped by body class so other admin pages are
untouched. Two-tone discipline throughout; accent = action only.

The **client-facing proposal page** keeps using the settings-driven tokens
(`--ocp-*`) so each proposal can be re-skinned per brand — the backend is house
style, the deliverable is the client's.
