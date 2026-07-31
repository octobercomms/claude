# OMI redesign brief — page structure + action grammar

**For:** the OMI build agent · **Status:** design agreed for Owned; other suites first-pass (see §3)
**Scope:** `dev/platform/frontend` · **House style:** unchanged (see §5)

Two visual references live next to this file (open in a browser — the source of
truth is this doc, they're the picture):

- `redesign-ia-sitemap.html` — the before/after page structure (Part 1)
- `redesign-owned-action-grammar.html` — the per-page visual language (Part 2)

---

## Goal

Every working page in OMI has grown to ~30 tab-stops presented at equal weight,
so the operator can't tell where to start. Fix it with two coordinated changes:

1. **Information architecture** — collapse each suite's tabs onto a shared
   **Health + Build** spine (fewer, clearer pages).
2. **Action grammar** — on each page, make exactly one primary path obvious and
   demote everything else.

Do them in that order: structure first, then the visual language on top. Applied
to a bloated page, the grammar just makes prettier overwhelm.

## Sequence (tickets)

1. **Owned end-to-end, as the pattern.** Ship page-by-page, starting with
   **Health** — it's pure consolidation (no behaviour change), lowest risk.
2. Apply the **action grammar** to the new Owned pages.
3. **Confirm Paid / Earned / Shared** merges with October (§3 is first-pass),
   then repeat the same collapse.
4. Keep each suite's **Overview** page — this refactor only touches the working
   pages beneath it.

---

## Part 1 — Information architecture

**The rule:** stop using tabs for everything. Sort every current tab with three
questions and give each the container it wants:

| Question | It's a… | Container |
|---|---|---|
| Do I *look* at it? (ranks, ROAS, coverage) | read-out | **Dashboard** — one scrollable page, panels/accordions |
| Do I *work through* it? (brief → draft → ship) | process | **Stepper** — one guided flow |
| Do I *dip into* it? (audits, fixers) | tool | **Accordion / launcher** — pick one, run it |

**Merge test:** combine things consulted in the same sitting; keep apart
different sessions. Don't build a 30-accordion mega-page — that trades click-
overwhelm for scroll-overwhelm.

### Owned — target structure (✓ agreed)

`Overview` (unchanged) plus **5 pages**, down from 7 rails / 32 tab-stops:

| Page | Container | Absorbs (today's tabs) |
|---|---|---|
| **Health** | Dashboard | Review · Keywords · Search Console · AI Visibility · Authority · Backlinks · Watch |
| **Build** | Stepper | Find → Brief → Draft → Publish → Promote |
| **Optimise** | Accordion (worked top-to-bottom) | Scan → Grade → Map → Win → Sharpen → Target → Prep |
| **Convert** | Accordion | CRO · Forms |
| **Email** | Stepper | Find → Write → Send → Chase |

**Local dissolves** — it's the same activities in a local flavour, not a
separate section: read-outs (Compare · Flag · X-ray) → **Health**; schema
(Validate) → **Optimise**; GBP posts → **Build**. Gate the whole local lens on
the client's **local-business flag** so national / ecom clients never see it.

### Other suites — first-pass, confirm before building (§3 marker)

Same three questions, drawn from each page's real tabs today:

- **Paid** (5 → 2): `Health` = Measure + Briefing + Competitors · `Build` =
  Brief → Draft → Render → Approve → Launch (Resize + Audiences become tools in it).
- **Earned** (5 → 2): `Health` = Track + Share read-outs · `Build` = Find
  journalists → Draft release → Sign-off → Pitch.
- **Shared** (5 → 3): `Health` = Review · Learn · Compare · Improve · `Build` =
  Capture feeds → Ideas → Brief → Workbench → Plan → Publish · `Engage` = DM bot
  · Discover (always-on).

### The spine (the cohesion payoff)

Every suite = **Overview + Health + Build + a short tail of channel verbs.**
`Health` + `Build` are constant across all four — learn the shape once, it holds
everywhere. That sameness is the cross-channel cohesion we're after.

**Naming:** `Health` is a **noun** (a read-out — you look); every other page is
a **verb** (you do). Keep it a single word, identical across suites — `Health`
everywhere, not "Search health". `Build` is deliberate (reuses today's term).

---

## Part 2 — Action grammar (per page)

One small vocabulary, applied the same way on every page. The rule that fixes
overwhelm: **if everything is a button, nothing is primary.**

| Kind | Treatment |
|---|---|
| **Primary action** ("Start here") | Filled accent button (`.btn-primary`). **Exactly one per surface.** |
| **Secondary / optional** | Plain link or ghost button — visibly quieter. |
| **Read-out** (look, don't do) | A card with a number + an ⓘ — **never button-shaped**. |
| **Function pip** | A muted wayfinding dot tagging *what kind* of work a thing is. Touches the label only — never a button fill or a surface. |

- Reuse OMI's existing **`INFO_TABS`** flag to decide read-out vs. step.
- Owned's page shape (worked example in the mockup): research read-outs on top
  ("what to write about") → the **one** primary Build path in the hero → fix-it
  tools as quiet links below → other jobs in one calm row.
- **Function pips** are the *one* considered step beyond OMI's two-tone + 3-
  semantic palette. Keep them muted; they're wayfinding, not a theme. If in
  doubt, ship the IA + grammar first and add pips last.

---

## Non-negotiables

- **House style unchanged.** Two-tone (white surface + black text + accent
  yellow), Brockmann, thick 2px borders, chunky radii, the tokens in
  `src/index.css`, and the brand rules in `CLAUDE.md`. Accent = action only.
- **Reuse, don't reinvent.** Steppers already exist: `ProcessRail` / `Stepper`.
  Top nav is `SuiteTabs` (keep it ≤ 6 items). The **accordion** is the one new
  primitive — build it in OMI's own CSS tokens.
- **Overviews stay.**

## Borrow / leave — `@astryxdesign/core`

Borrow the *patterns*, re-implemented in OMI's own code. **Do not** add the
dependency.

- **Borrow ✅** — its accordion/stepper **accessibility** (aria-expanded, roving
  tabindex, arrow-key + Escape handling, focus-visible) and its **built-in
  spacing discipline** (compose with `gap` + the token scale, not ad-hoc margins).
- **Leave ❌** — the package itself, StyleX's build system, the React 19 peer
  requirement, and the Meta visual look (OMI is React 18 + plain CSS/Tailwind
  with its own identity).

## Open decisions for October

- Confirm the **Paid / Earned / Shared** merges (§3) the way Owned was confirmed.
- **Paid → Audiences**: tool inside Build, or its own visible job?
- **Health** as the read-out name — agreed, but `Pulse` is the alternative if a
  more "live" feel is wanted.
- How **bold** the function pips should be (muted dots vs. something stronger).
