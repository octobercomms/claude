# Personal Stylist — Concept Brief

**Status:** Concept / pre-build
**Owner:** October (personal project)
**Code will live in:** `dev/personal-stylist/`
**Docs live in:** `docs/personal-stylist/` (this folder)
**Full technical scope:** [`SCOPE.md`](./SCOPE.md)
**Hosting:** 20i shared hosting (free) — PHP 8 + MySQL. See SCOPE.md §2.

A private, AI-powered personal stylist. You photograph your clothes; it learns
your taste, your body, and your life; and it tells you *what to wear, when, and
why* — accounting for the occasion, the weather, which of your two homes the
clothes are in, and what's clean. It plans ahead so you pack light for trips,
keeps outfits fresh instead of repetitive, and periodically hands you a
shopping brief for the pieces that would unlock the most new outfits.

---

## 1. Who it's for

One user (the owner), to start. This is a personal tool, not a marketplace app.
That simplifies a lot: no multi-tenant concerns, no social features, no scale
pressure — but it raises the bar on *taste* and *privacy*, because it only has
to please one person and it holds sensitive personal data (body photos,
calendar, location).

## 2. The core insight

Naive wardrobe apps stop at "blue and white go together." The value here is
*stylist judgement*, applied in a strict order:

1. **Occasion & formality** — driven by the calendar (or a quick "what am I doing").
2. **Weather-appropriateness** — no wool on a hot day; layering, fabric weight, rain.
3. **Silhouette & proportion** — the part amateurs miss; needs a body model.
4. **Colour & pattern** — harmony *within the pieces actually owned*, not generic rules.
5. **Personal style identity** — consistent with who the user is; must be *learned*, not assumed.

The difference between generic and genuinely useful is that last mile: reasoning
through occasion → weather → silhouette → colour → personal taste every time,
over the user's *real* wardrobe.

## 3. Feature set

### 3.1 Wardrobe capture
- Photograph each garment; vision tags it into a structured catalogue.
- Auto-extracted attributes: type, colour(s), pattern, fabric/weight, warmth,
  formality, season, care needs.
- User can correct/confirm tags.

### 3.2 Life-aware recommendations
- **Google Calendar** integration (single calendar mixing work + personal).
  Reads upcoming events, infers formality/context per day.
- Or manual "here's what I'm doing today / this trip."
- **Weather** integration keyed to each event's date + location.
- Output: an outfit per day with a one-line *why* ("charcoal merino + oxford —
  client meeting, 9°C and drizzle").

### 3.3 Two homes (London + Margate) — location-aware wardrobe
- Every item has a **location**: London, Margate, or in-transit/packed.
- When heading to Margate, it plans from *(what's already there) + (what you bring)*
  and tells you what **not** to pack because Margate already covers it.
- Cross-location twinning: "those Margate shorts twin with this London tee."
- Location drift: flag items that have lived in one place unworn for months
  ("leave it in Margate?").

### 3.4 Horizon planning & packing
- Reasons over the whole upcoming period, not just today.
- **Wear-vs-pack conflict:** won't tell you to wear a shirt today if you need
  it packed for tomorrow's trip.
- **Pack-light optimiser:** given N days × the day's events × forecast, solve for
  a minimum set of items that dresses every day well. (Flagship delight feature.)

### 3.5 Availability model (the unifying abstraction)
An item is **wearable today** only if all three line up:
1. **Location** — is it where I am?
2. **Wash state** — clean / worn-but-fine / in-basket / actively washing.
   Not binary: a lightly-worn tee in cool weather is still in play; the same tee
   on a hot day defaults to the basket. Weather-worn-in can nudge the default.
3. **Committed** — already promised to a future planned outfit.

Laundry is *not* a separate feature — it's the third dimension of the same
availability check that already governs location and packing.

- Basket items are **flagged ahead**, not silently hidden: "Thursday's best look
  needs the navy overshirt — it's in the wash, run a load by Wednesday."

### 3.6 Variety engine
- Track **wear-frequency per item** and per combination.
- Actively reward under-worn pieces and fresh combinations so nothing repeats.
- Surfaces "you own this and never wear it" moments.
- (Without an explicit rule, any recommender collapses onto a few safe favourites.)

### 3.7 Monthly briefing (primary surface)
- The main interaction is a *planning conversation*, not a daily dictation
  ("otherwise I could just make a PDF").
- Reviews the month: trips, London↔Margate moves, notable events; pre-positioning
  advice; outfit *directions* with variety built in.
- Optional **light daily glance** that confirms/adjusts on the morning's real weather.

### 3.8 Shopping brief (gap analysis)
- Inverse of everything else: with full catalogue + style profile known, spot
  **holes** — "four tops all want a mid-grey trouser you don't own; buy one and
  unlock six outfits."
- High-leverage, taste- and budget-bounded suggestions — not random "buy this jumper."

### 3.9 Body-aware fit
- Minimum: height, weight, a few measurements (shoulders, waist, inseam).
- Better: one **clothed, fitted** full-length photo for real proportions.
- Optional: swimwear photo for build accuracy — never required.
- **Privacy is a first-class requirement** (see §6).

## 4. Data model (first sketch)

```
Item
  id, photos[]
  type, colours[], pattern, fabric, warmth, formality, season, care
  location         # london | margate | packed
  washState        # clean | worn_ok | basket | washing
  committedTo      # nullable → planned outfit / date
  wearCount, lastWornAt, lastWornLocation

Outfit            # a saved/planned combination
  items[], date?, occasion?, weatherContext?, rating?

BodyProfile       # height, weight, measurements, photo refs (private)
StyleProfile      # archetypes, preferences, learned taste signal
Event             # from calendar: date, title, inferred formality, location
```

## 5. Integrations
- **Google Calendar API** — read upcoming events.
- **Weather/forecast API** — per event date + location.
- **Vision model** — garment tagging from photos.
- **Claude + a styling rubric skill** — the reasoning layer (see §7).

## 6. Privacy (non-negotiable)
Body photos, measurements, calendar, and home locations are sensitive.
- Store the body model **privately in the app; never send to any third party.**
- One-tap delete for photos/measurements.
- Design the body model as the most protected data in the system.

## 7. The "styling brain" — how we avoid generic advice
There is **no off-the-shelf fashion/styling skill** in the marketplace (checked).
The intelligence is built as:
- **A styling rubric encoded as a skill** — the §2 framework written as real
  rules, so reasoning runs occasion → weather → silhouette → colour → taste every
  time rather than pattern-matching to "smart casual."
- **A per-user style profile** — captured up front and refined over time.
- **Vision** doing the cataloguing grunt work so reasoning is over the real wardrobe.

## 8. Open questions
1. **Taste-learning approach** — quiz to seed vs. learn-from-ratings vs. both
   (recommend both: quiz seeds, ratings refine). *Biggest open question — it's the
   difference between useful and gimmick.*
2. Platform: web app first (fastest to prototype) vs. mobile (better for
   photographing clothes on the go)?
3. How much daily interaction does the user actually want vs. monthly briefing only?
4. Shopping brief: suggest specific products/links, or just describe the gap?

## 9. Suggested build order
1. **Prototype the monthly-briefing screen** with a small seeded wardrobe split
   across two locations — feel whether the advice reads as smart or generic
   (this de-risks the whole idea).
2. Wardrobe capture + vision tagging.
3. Availability model (location × wash × committed).
4. Live calendar + weather.
5. Pack-light optimiser.
6. Variety engine + shopping brief.
7. Body model + silhouette reasoning.
