# October / OMI Brand Style Guide (for documents & presentations)

Drop this file into a Claude Project, or paste it at the top of a chat, when you
want a document, deck, one-pager, or report to come out on brand. It is the
house visual language of October Marketing Intelligence (OMI), rewritten for
prose and slides rather than code.

Source of truth: `dev/platform/frontend/src/index.css` and
`.claude/skills/october-design-system`. If those change, update this file.

---

## 1. How to use this file

Tell Claude: *"Follow the October brand style guide when building this."* Then
expect these outputs to obey the rules below:

- Written documents (briefs, proposals, one-pagers, reports)
- Slide decks and pitch presentations
- HTML artefacts, dashboards, mockups
- Charts, tables, and data visuals

If a request conflicts with these rules, the rules win unless you say otherwise.

---

## 2. The five non-negotiables

1. **Two-tone discipline.** Every surface is white, every word is black (near
   black `#1A1A1A`), and there is exactly **one accent**: brand yellow
   `#E7CD41`. The accent marks action, the active state, or a single highlight.
   It is never decoration and never a background wash.
2. **One extra tier of colour, three hues only.** Green, red, amber for
   positive, negative, warning. Deltas, profit and loss, success and error.
   Nothing else. No brand blues, no gradients standing in for colour.
3. **One typeface.** Brockmann throughout. No second font. Weight and size
   carry the hierarchy.
4. **Thick lines, chunky corners.** Borders are 2px. Corners are generous
   (8 to 20px). Flat and confident, not thin and timid.
5. **Depth, not decoration.** Lift comes from soft shadows and a faint warm
   page tint, never from glows, heavy drop shadows, or gradient fills.

---

## 3. Colour palette

Use the exact values. Do not approximate.

### Core (the two-tone base)

| Token | Hex | Use |
|-------|-----|-----|
| Page background | `#FAF9F5` | The canvas. A warm off-white, not pure white. |
| Surface | `#FFFFFF` | Cards, panels, slide bodies. |
| Surface raised | `#FAFAFA` | A card sitting on a card. |
| Surface sunken | `#F3F3F3` | Wells, inset areas, table zebra. |
| Text | `#1A1A1A` | All body and headings. Near black, not `#000`. |
| Text muted | `#555555` | Secondary text, captions, supporting lines. |
| Text subtle | `#888888` | Metadata, footnotes, timestamps. |
| Card border | `#E3E2DB` | The default soft grey bento border. |
| Ink border | `#1A1A1A` | A deliberate hard border on a plain card. |

### Accent (action / highlight only)

| Token | Hex | Use |
|-------|-----|-----|
| Accent | `#E7CD41` | Primary buttons, active tab, the one number that matters, one highlight per view. |
| Accent soft | `rgba(231,205,65,0.12)` | Faint accent-tinted fill behind an accented card. |
| Accent on | `#1A1A1A` | Text or icon sitting on the yellow fill (keep it legible). |

Rule of thumb: if two things on a page are yellow, one of them is wrong.

### Semantic (the only third tier)

| Meaning | Solid | Soft fill |
|---------|-------|-----------|
| Positive | `#2E7D32` | `rgba(56,142,60,0.10)` |
| Negative | `#C62828` | `rgba(198,40,40,0.10)` |
| Warning | `#B86E00` | `rgba(255,187,6,0.16)` |

Use these for meaning, not mood. Green because a number went up, not because
green looks nice.

### The ink feature surface

For one hero stat or a standout panel, invert: fill with `#1A1A1A`, set text to
white, and use the accent yellow for the single number inside. Use it sparingly,
once per view.

### Dark chrome (navigation only)

A sidebar or nav rail may go dark (`#0B0B0C` background, `#FAFAFA` text). The
body of every document and slide stays light. Never take a whole page dark.

---

## 4. Typography

Brockmann everywhere. Fallback stack: `-apple-system, BlinkMacSystemFont,
'Segoe UI', system-ui, sans-serif`. If Brockmann is not available in the output
medium, use the fallback rather than substituting a different branded font.

| Role | Size | Weight | Notes |
|------|------|--------|-------|
| Display | 54px | 800 | Cover titles, hero statements. Tight tracking. |
| H1 | 32px | 700 | Section openers. |
| H2 | 22px | 700 | Sub-sections. |
| H3 | 15px | 600 | Card and block titles. |
| Body | 15px | 400 | Standard paragraph, muted grey ink. |
| Body small | 14px | 400 | Dense text, near black. |
| Caption | 12px | 700 | Uppercase, wide tracking (1.4px), labels and eyebrows. |
| Metric | 36 to 44px | 700 to 800 | The big number. Tight tracking. |

Hierarchy comes from size and weight, not colour. Headings are black, not
yellow.

---

## 5. Layout and structure

### Spacing

4pt base grid: 4, 8, 12, 16, 20, 24, 32, 40, 56, 72. Pick from these steps.
Space generously; the look is calm and uncluttered, not packed.

### Corners and borders

- Radii: 8px small, 14px medium (default card), 20px large, pill for chips and
  buttons.
- Borders: 2px, always. Soft grey `#E3E2DB` by default, ink `#1A1A1A` when you
  want a hard edge.

### The bento pattern

Content lives in white cards with a 2px soft grey border and a medium radius.
Group related information into cards. A page is a grid of bentos, not a wall of
text.

### Depth

- Soft, low-contrast shadows lift cards off the warm canvas. Keep them subtle.
- The page tint (`#FAF9F5`) is the warmth. Do not add coloured backgrounds.
- On interactive elements, a 1px hover lift is the only motion needed.

### Slides specifically

- One idea per slide. Title in H1 or H2, supporting line in body.
- Left-align by default. Centre only a cover or a single hero statement.
- One accent moment per slide: the key number, the active step, the takeaway.
- Data goes in cards or a clean 2px-bordered table, not floating on the slide.
- Cover slide: warm off-white ground, black display title, one yellow mark or
  the ink feature panel for a headline metric.

---

## 6. Charts and data visuals

- Base everything in black, grey, and the warm canvas.
- Yellow marks the series or bar you want read first. One series, not all.
- Green, red, amber only for up/down, profit/loss, pass/fail.
- No rainbow palettes. If you need to separate many series, use greys of
  different weight plus one accent, or small multiples.
- Tables: 2px borders, uppercase caption headers, sunken zebra rows
  (`#F3F3F3`), right-align numbers, bold the total.
- Label directly on the chart where you can. Legends are a fallback.

---

## 7. Tone of voice

The words carry the same discipline as the design.

- Direct and commercially grounded. British English.
- Clear, natural sentences. No hype, no filler, no motivational language.
- Lead with the point. Support it with a number, an example, or a comparison.
- Say when something is weak and why. Do not soften to be polite.
- Structure task-driven content as bullets, phased plans, or tables.
- No em dashes. Use commas, full stops, or semicolons.
- No "not only X but also Y" constructions.
- No generic setup or sign-off phrases.
- Cut adjectives and adverbs that do no work.

Benchmark: Wallpaper-magazine clarity, management-consultancy structure,
builder-level practicality.

---

## 8. Quick do / don't

**Do**
- White surfaces, black text, one yellow accent.
- Warm off-white page, not stark white.
- 2px borders, chunky radii, generous spacing.
- One highlight per view.
- Numbers and comparisons over adjectives.

**Don't**
- Introduce a second brand colour or a gradient.
- Make headings yellow or use yellow as a background.
- Use a second typeface.
- Take a whole document or slide dark.
- Fill a page edge to edge with text.
- Brand anything here as "nvelope". This is October / OMI.

---

## 9. Paste-in prompt

Copy this to the top of a chat when you want on-brand output fast:

> Use the October / OMI brand style. Warm off-white page (`#FAF9F5`), white
> cards, near-black text (`#1A1A1A`), one accent only: brand yellow (`#E7CD41`)
> for the single most important thing per view. Green `#2E7D32`, red `#C62828`,
> amber `#B86E00` only for positive/negative/warning. One typeface (Brockmann,
> system-sans fallback), hierarchy by size and weight. 2px borders, chunky
> radii (8/14/20px), 4pt spacing, soft shadows for gentle lift, no gradients or
> glows. British English, direct and commercial, no hype, no filler, no em
> dashes, numbers over adjectives.
