# Hillcroft — Render Fidelity Brief: Existing-Conditions Base Plan + Correction Loop

> **Status:** Design brief for discussion → implementation. Not yet built.
> **Codebase:** `dev/hillcroft-gardens` (the WordPress plugin). This is a native
> extension of the plugin's existing render pipeline — **not** a new app and
> **not** the OMI "Visualise" module (see §1).
> **Docs home:** `docs/hillcroft-gardens/` (this file), per the repo two-folder rule.
> **Related:** `docs/omi/visualise-studio.md` — the OMI module this borrows its
> *technique and discipline* from. Read §1 for the relationship.

---

## 0. How to read this brief

Two problems with Hillcroft's AI renders, at opposite ends of the same loop:

1. **Cold-start faithfulness** — the model doesn't reliably understand the
   uploaded sketch, can't tell *what exists and can't change* from *design
   intent*, and produces plausible-but-random gardens. **(Part A — the priority.)**
2. **End-of-loop precision** — a render that's 90% right can't be surgically
   fixed; regenerating the whole thing re-rolls everything and drifts. **(Part B —
   "the tweaking".)**

Both are solved by the **same principle** (§2). Part A is first because a faithful
start makes Part B cheap: you tweak a render that was already anchored to the real
plot, instead of rescuing a random one.

---

## 1. Relationship to OMI "Visualise" (don't merge them)

OMI's Visualise module (`docs/omi/visualise-studio.md`) is the canonical statement
of the correction-loop technique. **Hillcroft does not consume that module** — it
would be the wrong boundary (a WordPress plugin on the client's own host coupling
to OMI's Node/Postgres/multi-tenant service, cross-auth and cross-language; and
Visualise is scoped to OMI's own clients).

Instead, Hillcroft borrows the **technique and the discipline**, because — per the
Visualise brief's own thesis (its D2: *"generic engine + presets; adding a vertical
is configuration, not code"*) — **Hillcroft is simply another vertical of the same
engine**: "Garden Render" alongside lolo's "Costume Character." The parts OMI reuses
internally, Hillcroft already owns natively (§6). So we port the *pattern*, not the
code.

---

## 2. The unifying principle (settled)

> Replace **AI interpretation** with **human-confirmed, deterministic geometry** at
> both ends of the loop, and let the model be creative only in the explicitly
> bounded middle.

- **Start (Part A):** a deterministic **base plan** pins *what exists / can't
  change*. The model may design only in the open space.
- **Middle:** design generation — creative freedom, bounded by the base.
- **End (Part B):** a **mask** pins *what's already right*. The model may edit only
  inside the circled region; everything outside stays pixel-identical.

The base plan is degrees-of-freedom at the **start**; the mask is degrees-of-freedom
at the **end**. Randomness and drift both come from letting the model *interpret and
invent freely*; we remove that freedom at both ends and keep it in the middle.

---

# PART A — Existing-conditions base plan (cold-start faithfulness)

## A1. The diagnosis

A hand sketch conflates two things the model cannot separate: **existing
constraints** (the house wall, the boundary, a mature tree to keep, a level change)
and **design intent** (the new curved path being imagined). Fed that ambiguous
scribble as a control image, the model can't tell fixed lines from proposed ones,
so it hallucinates a random-but-plausible garden. Compounding it: the model doesn't
know the plot's real proportions, so scale drifts too.

## A2. The core move (settled)

**Do not ask a generative model to draw the technical base.** Extract the existing
geometry as **structured data**, let a human **confirm** it, then render the base
plan **deterministically with code**. Putting AI in the "what can't change" layer
reintroduces hallucination into the exact thing meant to prevent it.

## A3. Build on what already exists

`HGD_Measure` already stores a structured site model in `projects.measurements`
(JSON): `plot { w, l }`, `zones[]` with a type vocabulary (incl. `structure`),
per-zone canvas geometry (`rect { x,y,w,h }`), and a scale calibration
(`px_per_m`) — captured via an existing **draw-on-plan canvas** and injected into
the plan/render prompts. This is the substrate. Three changes turn it into a base
plan:

### A3.1 Add an explicit *existing / fixed* layer to the site model
Extend the measurements JSON (new keys — do not break the current shape):

```
existing: {
  boundary: [ {x,y}, … ],              // plot outline polygon (world or canvas coords + scale)
  edges: [ { from, to, treatment } ],  // 'house_wall' | 'fence' | 'wall' | 'hedge' | 'open'
  features: [
    { id, kind, retain: true, geometry, notes }
    // kind: 'tree' (geometry: {cx,cy,canopy_r}) | 'structure' | 'level_change' | 'access'
  ],
  orientation: { north_deg: 0, sun_notes: '' }
}
```
Everything under `existing` is **immutable** — the "can't change" set. The current
`zones[]` stay as the *proposed* design layer. (Alternatively add `fixed: true` to
individual elements; a separate `existing` object is cleaner for rendering.)

### A3.2 Vision proposes, human confirms (the reliability guarantee)
- Run Claude/Gemini **vision** on the **sketch + the site photos** (`HGD_Claude`
  already wraps image blocks) to *propose* the `existing` layer: "this is the
  boundary, these two edges are the house, there's a tree ~here."
- Donna **confirms/corrects** it on the extended draw-on-plan canvas (add: trace
  boundary, drop tree/structure markers, tag edges). Extraction is the unreliable
  step, so it never runs unattended — same human-in-the-loop discipline as the
  correction loop.
- **Photos are ground truth for *what exists*; the sketch is *design intent*.**
  Treat them as distinct input kinds, not interchangeable references.

### A3.3 Deterministic base-plan renderer (no AI)
A code renderer draws the confirmed `existing` layer to a clean, scaled technical
plan — plot outline, hatched house, tree symbols with canopy circles, dimension
lines, north arrow — as **SVG → raster**. Exact and reproducible because there is
no model in it. Store it as a new project asset (`role = 'base_plan'`).

### A3.4 Use the base plan as the anchor everywhere downstream
- **ControlNet control image** for Flux — replaces the raw sketch. `HGD_Flux`
  already uses `flux-control-lora-canny`; crisp technical linework traces
  faithfully where a scribble traces mess.
- **Base layer** the top-down design plan (Gemini `handle_generate_plan`) is drawn
  *on top of* — not from scratch.
- **"What can't change" reference** handed to Gemini in the render prompt, with the
  real dimensions (kills scale drift).

## A4. Why this fixes the randomness
The model stops *interpreting* the fixed reality — it's given exact, human-verified
geometry and told "design within this; do not move these." Faithfulness becomes a
property of the input, not a hope about the model.

---

# PART B — The correction loop (end-of-loop precision, "the tweaking")

## B1. The promise (settled)
A render that's 90% right never gets worse. Circle the wrong area, say (and
optionally show) what it should be, and **only that region regenerates**; everything
outside the circle stays **pixel-identical**.

## B2. Build (four pieces)

1. **Masking canvas** in the render view — draw the active render on an HTML canvas;
   Donna circles/lassos the wrong area → rasterise to a **binary mask PNG** (white =
   change) at the image's dimensions.
2. **Flux Fill inpaint call** — a near-cousin of `HGD_Flux::generate_image()`:
   `{ image_url: base, mask_url, prompt: instruction, optional reference_crop }` to a
   fal **Flux Fill / inpainting** model. Reuses the existing fal POST / error / cost
   plumbing. **VERIFY the exact fal slug** — do not hardcode a guess.
3. **Composite-back — the exactness guarantee.** After fal returns, paste the result
   **only inside a feathered mask** over the original, so everything outside the
   circle is byte-for-byte unchanged (soft edge only, to avoid a seam). *This is the
   crux.* Skipping it turns a "tweak" back into a "re-roll." Do it in PHP (GD/Imagick)
   or client-side on the canvas before saving.
4. **Light step lineage** — add `parent_asset_id` + `kind` ('generation' |
   'correction') + correction meta (mask, instruction) to `project_assets`, so each
   fix is a child of the render it corrected → **revert** to any prior version
   (never lose the good one) and optionally **branch**. Existing `approved` + 0–100
   scorecard already provide **Lock**.

## B3. Export = faithful upscale, never re-render
On the locked render, run a **faithful upscaler** (fal; sharpen without inventing
detail) for the render pack — **do not** re-render at higher resolution (that
discards the correction work; it's precisely the accuracy risk we're removing).
**VERIFY the upscaler slug.**

---

## 3. Reuse map — what Hillcroft already has (don't rebuild)

| Need | Already in the plugin |
|------|-----------------------|
| fal.ai connectivity + Flux | `HGD_Flux` (`fal.run`, `flux_api_key`, cost-logged) |
| Vision extraction | `HGD_Claude` (image blocks + clarifying-questions loop) |
| Structured site model + scale | `HGD_Measure` (plot, zones, `px_per_m`, canvas `rect`) |
| Draw-on-plan canvas | Capture step tool (extend for boundary/feature tracing) |
| Top-down plan generation | Gemini `handle_generate_plan` / `handle_compose_prompt` |
| Render storage + Lock + scoring | `HGD_Project_Asset` (`role`, `approved`, `score`, `review`) |
| Cost transparency | `HGD_API_Usage` + spend banner |

**Net-new:** the `existing` site-model layer + confirm UI; the deterministic
base-plan SVG renderer; the masking canvas; the Flux Fill inpaint op + composite-back;
step lineage columns; the faithful-upscale export.

## 4. Schema / data deltas
- `projects.measurements` JSON → add the `existing` object (§A3.1). Backward-compatible.
- `project_assets` → add `parent_asset_id BIGINT NULL`, `kind VARCHAR(20)`, and
  correction meta (`mask_attachment_id`, `instruction LONGTEXT`); allow
  `role = 'base_plan'`. New migration (bump `HGD_DB::SCHEMA_VERSION`).

## 5. Model routing to VERIFY (don't guess slugs)
- **Inpaint:** fal Flux Fill / inpainting slug (region-locked).
- **ControlNet:** already `flux-control-lora-canny` — good for tracing the base plan.
- **Upscale:** a faithful (low-creativity / ESRGAN-type) upscaler on fal — **not** a
  high-creativity "magnific" style, and **not** a Gemini/Flux re-render.

## 6. Risks & constraints
- **fal reachability:** base image, mask, and control image must be publicly
  fetchable URLs (same live-site constraint the current Flux ControlNet has). Mask
  PNGs need a temporary reachable URL, then can be discarded.
- **Composite tooling:** needs GD or Imagick with alpha/feather (WP usually has GD),
  or do it client-side on the canvas.
- **Scope:** full branchable history (à la Visualise) is likely more than Donna needs
  day one — a linear "correct → new version, revert to any prior" probably suffices;
  branching is a nice-to-have.
- **Extraction accuracy:** the vision-proposed `existing` layer WILL be wrong
  sometimes — that's why confirmation is mandatory, not optional.

## 7. Suggested phasing
1. **Existing-conditions model** — extend `HGD_Measure` with the `existing` layer +
   confirm UI on the draw-on-plan canvas.
2. **Deterministic base-plan renderer** (SVG → raster) + store as `base_plan` asset.
3. **Re-anchor** generation — feed the base plan as the ControlNet/plan/Gemini anchor;
   measure the faithfulness gain before building Part B.
4. **Correction loop** — masking canvas + Flux Fill + **composite-back** + step
   lineage. *(Prototype the fal Flux Fill + composite as a spike first — highest
   value/risk.)*
5. **Faithful-upscale export.**
6. **Polish** — revert UI, spend display, error/retry, security pass.

## 8. Do-NOT (guardrails)
- **Do NOT** let a generative model draw the base plan — render it deterministically
  from confirmed data (§A2).
- **Do NOT** run existing-conditions extraction unattended — human confirmation is
  mandatory (§A3.2).
- **Do NOT** feed the raw sketch as the render control image once a base plan exists.
- **Do NOT** let corrections change anything outside the circled mask — composite
  back if the model won't guarantee it (§B2.3).
- **Do NOT** export by re-rendering at higher resolution — faithful upscale only (§B3).
- **Do NOT** hardcode fal model slugs without verifying them.
- **Do NOT** couple Hillcroft to OMI's Visualise module — port the pattern (§1).
- **Do NOT** treat site photos and the design sketch as interchangeable — photos are
  ground truth for what exists; the sketch is design intent (§A3.2).
