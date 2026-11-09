# Batch video: templates, the batch runner, and the reference analyser

> **Status: scope, agreed with Daniel 8 November 2026. Not started.**
>
> Read **What already exists** before anything else. Roughly 60% of this build
> is already in the repo, wired to the wrong front door or orphaned by the
> step 8 deletions. The expensive mistake available here is building a fourth
> video pipeline beside the three that exist.
>
> Read `editor-composition-model.md` first for the model this extends, and
> `video-editor-review.md` for the open items on the editor itself.

## The deal

Daniel's words: *"i have 2 weeks worth of content i need to create. if i was
able to upload images to projects and brief it, and then set it to run, and then
move to the next project etc. so it could create a lot of content for me in a
very short space of time."*

And on quality: *"will it spit out and allow me to make some edits after? in
case its not perfect, but got me 80% there."*

That second sentence decides the architecture. The batch must write real
Compositions, so every output opens in the composition editor with the same
timeline, inspector, undo and re-export as something built by hand. Any design
that produces output the editor cannot open fails the brief, however fast it is.

**The commercial case is hours, not money.** Thirty videos edited by hand at 45
to 90 minutes each is 22 to 45 hours. Through this pipeline it is about two
hours of unattended machine time plus two to three hours of review. The AI
spend for thirty videos is between $3 and $85 USD depending on one decision
(see **The image-to-video question**), against a day rate in the hundreds of
pounds.

**The headline is risk, not cost.** At 22 to 45 hours saved, the dollars are
noise at either end of that range, so "£29 rather than £2" is the wrong thing
to lead on and the weaker argument. What the image-to-video decision really
buys is removing a third-party generative API from the critical path of an
unattended fortnightly run. Build for throughput, reviewability and failure
behaviour.

**Estimate: 33 to 51 sessions** for the whole scope below, which is what the
build-order table sums to. That is roughly 1.5x the composition editor
rewrite, which was estimated at 25 to 35 and landed in that band, and it makes
this the largest single thing OMI has built. Daniel has seen the number and asked for the whole architecture
rather than a cut-down version, on the condition that nothing half-done is
exposed to users. Build it the way the editor rewrite was built: in dependency
order, behind the existing flag pattern, with each step complete before the
next.

---

## What already exists

This table is the point of the document. Check each row before writing
anything.

| Capability | Where | State |
|---|---|---|
| **A brief producing N content items** | `social_batches` + `social_posts` (migration 024) | Live. `social_batches` holds one brief per generation run. Each `social_posts` row carries `storyboard` JSONB (an array of `{frame, shot, on_screen_text, voiceover}`), `image_urls`, `hook`, `caption`, `hashtags`, `visual_concept` |
| **Unattended job queue with a worker contract** | `videoProjects.js`, `routes/videoWorker.js`, `dev/platform/worker/` | Live. `FOR UPDATE SKIP LOCKED` claims, `X-Worker-Token` auth, worker needs no DB or shared disk, scales by `WORKER_ID` |
| **A QA grade loop** | `worker/stages/grade.js` | Live. Claude scores 0 to 100 from sampled frames plus transcript; under 85 loops back to roughcut, capped at 2 re-edits |
| **Delivery to Drive, Instagram, email** | `videoProjects.js`, `worker/stages/export.js` | Live. Signed short-lived master URL for Meta's fetcher; Drive upload via the existing Google connector |
| **Retention sweep** | `services/videoCleanup.js` | Live, 03:15 daily, `VIDEO_RETENTION_DAYS` default 7. **Covers `video-clips/` and `video-outputs/` only, not composition output** |
| **Stills to motion via fal** | `services/stillsReel.js` | **Orphaned.** Six camera-motion presets, a price table, cost logging. Its route (`routes/edit.js`) was deleted in step 8 and nothing imports it |
| **Single-pass render from a Composition** | `shared/compositionRender.mjs` | Live. One `filter_complex`, one encode |
| **Word-level transcripts** | `services/whisper.js`, `compositionMapping.mjs` | Live. Word timings plus source-to-timeline mapping |
| **Silence and filler removal** | `shared/silenceCut.mjs` | Live, and already transcript-driven rather than volume-driven. See **The silence fix** |
| **AI b-roll placement** | `shared/brollPlan.mjs` | Live, wired into the editor's BrollPanel |
| **31 caption presets as shipped data** | `shared/captions/presets.json` | Live. This is the pattern composition templates follow |
| **Image generation** | Visualise tab, `services/visualise.js` | Live, fal-backed |
| **Graphics with alpha** | `design` source kind, Design tab | Live, but **stills only**. The render graph uses `loop` + `trim` |
| **Per-call cost logging** | `services/costLog.js`, `recordApiCost()` | Live, writes `api_cost_events` |
| **Task budgets with monthly reset** | Migration 185, `docs/omi/ai-budgets.md` | Live. No `video_batch` task registered yet |
| **HyperFrames, Remotion, GSAP, Anime.js, Lottie** | Skills in this environment; `backend/remotion/` | Available. Remotion 4.x is already a direct backend dependency |

So the brief layer, the queue, the worker contract, the QA loop, the delivery
routes, the image-to-motion step, the render graph, the word timings, the cost
log and the budget framework all exist. What is missing is the template model,
the batch fan-out, an animated alpha source, and the cost-visibility layer.

---

## The three render paths, and the one we converge on

| Path | Model | Runs where | Unattended | Reachable from |
|---|---|---|---|---|
| Composition editor | `shared/composition*.mjs`, single-pass graph | App box, one at a time | No | Produce → Video |
| Video Studio auto-edit | Stage-based, hard-coded in `worker/stages/` | Separate worker box | Yes, with QA loop | A post card in Shared → Social only |
| Remotion storyboard reel | React components, `remotion/StoryboardReel.jsx` | App box | No | A post card in Shared → Social only |

**Decision: the composition model is the only description of an edit. The
worker becomes a generic composition renderer.**

The worker imports `shared/compositionRender.mjs` and runs the graph it
produces. Transcription, silence removal, image animation and b-roll placement
become pre-processing steps that **mutate a Composition** rather than encode
anything. The QA grade becomes an optional stage that reads the finished
master. The editor stays the place a human fixes a bad one.

**Rejected, having been considered:** routing bulk through the existing
stage-based worker pipeline. It is faster to a working batch because the queue,
the loop and the delivery already work, and it was attractive for that reason.
It fails on the only requirement that matters: its output is not a Composition,
so the editor cannot open it, so the 80%-then-fix property is lost and the
two-editor split that step 8 deleted comes straight back. Everything useful in
it (queue semantics, the worker contract, delivery routes, the retention sweep)
transfers to the converged design anyway.

**Also rejected:** rendering the batch on the app box permanently. Acceptable
as an intermediate state if the worker move has to wait, because the code is a
strict subset of the converged design and nothing is thrown away. Not the end
state: thirty encodes competing with the app for CPU is not a thing to ship.

The Remotion storyboard path stays where it is for now. It serves a different
job (rendering a post's storyboard frames) and nothing here depends on it. Do
not extend it.

---

## Model changes

Four changes to `shared/composition.mjs` and its render and playback siblings.
All four are additive, so an existing composition stays valid.

### 1. An animated alpha source kind

Today `design` sources are stills: `compositionRender.mjs` places them with
`loop` + `trim`, and the Compositor draws them from an Image element pool.

Add a source kind for a graphic that moves and carries alpha:

```
| { kind: 'fx', effect, params, duration, alpha: true }
```

`effect` names an entry in an FX library (below). The renderer resolves it to a
transparent video or a PNG sequence and overlays it; the Compositor plays it as
a video element with alpha.

This one change is what makes the whole FX library possible, and the library
then becomes data rather than code, the same way caption presets did.

**Open question for whoever builds it:** WebM with alpha (VP9 `yuva420p`) is
the simplest thing the browser and ffmpeg both read. Verify our pinned ffmpeg
8.1 build handles alpha overlay from WebM in a single `filter_complex` pass
before committing to it. A PNG sequence always works and costs disk.

### The ffmpeg construction for an animated transform, verified

Measured rather than reasoned about, because the obvious approach does not
work and fails in a way that looks like something else.

**`scale` alone cannot animate.** It needs `eval=frame`, and then the item's
own frame size changes per frame, which x264 will not encode and `xfade`
will not accept as an input.

**What works, in one pass, with an `xfade` downstream:**

```
color=c=black:s=WxH:r=FPS:d=LEN,format=yuva420p[canvas]
[item]scale=w='<expr in t>':h=-2:eval=frame,format=yuva420p[scaled]
[canvas][scaled]overlay=x='<expr>':y='<expr>':eval=frame,format=yuv420p,fps=FPS[out]
```

The flatten onto a fixed-size canvas is the load-bearing part: it is what
hands a constant-dimension stream downstream.

Measured on a 100x100 source scaled 1.0x to 2.0x over 4s, sampling the
output and counting the subject's pixels: side 101 at t=0.04, 150 at t=2.0,
198 at t=3.9, against 101, 150 and 197.5 predicted by `animAt`. Linear, and
matching the shared model exactly. Two such items then `xfade`d produced a
320x240, 6.96s output, so the construction composes with the existing
transition chain.

**`rotate` needs a constant output box.** It animates with `a='<expr in t>'`
and takes `fillcolor=none`, but `ow`/`oh` are init-only, so a time-varying
output size fails to configure. Size the box for the maximum angle or the
corners clip.

**Agreement is at parameter level, not pixel level, and the test must say
so.** `overlay` x/y are integer pixels and `scale` dimensions are integer
and even, while the browser's `drawImage` is sub-pixel. So the agreement
test compares one exported pure function (`itemTransformAt`) on both sides
with a stated tolerance, rather than comparing frames. Rotation resampling
(ffmpeg bilinear against canvas) can never match pixel for pixel; declare
that parameter-level only. Avoid `zoompan`: its integer x/y stepping is
visibly jittery on a slow move, which is the only kind this uses.

**Version caveat.** Verified on ffmpeg 6.1.1 in a cloud session. The box
runs a pinned 8.1 build via `FFMPEG_PATH`, and every filter and option used
here is long-standing, but the render test that covers this should run where
ffmpeg is installed rather than being asserted about a string.

### 2. Transform fields on items

Items carry `fit`, `gain`, `opacity` and `trans` and nothing else
(`composition.mjs:98-109`). Add, all optional:

- `scale` (a number, or a `{from, to}` pair for a move over the item's length)
- `pos` (`{x, y}` as fractions of the frame, or a `{from, to}` pair)
- `rot` (degrees)

Fractions rather than pixels, so a composition survives a reframe, which is
the rule `shared/overlays.mjs` already held for positioned text.

Two things land on this one change: the OMI Studio mockup's Transform panel,
and the cheap path to batch motion. A deterministic camera move over a still is
a `scale` and `pos` animation, which costs nothing and never fails, against an
image-to-video call that costs $0.20 to $0.45 and sometimes does. See **The
image-to-video question**.

### 3. A rationale slot on items

Add optional `reason`, `beat` and `quote` to an item. The renderer ignores
them.

Thirty videos produced unattended are unreviewable without this. When an agent
or a template decides a clip runs from 4.2s to 9.8s, the reason it chose that
has to travel with the decision, or the review sheet is thirty black boxes.
This pattern comes from `browser-use/video-use`, which carries exactly these
three fields on every range, and it is the single cheapest thing on this list.

### 4. The template model

A template is a Composition with named slots in place of fixed sources, plus
the rules for binding content into them.

```
Template {
  id                      // 'stills-montage'
  name, description, bestFor
  size: { width, height }
  fps
  slots: [Slot]
  caption: { preset }     // an id from shared/captions/presets.json
  audio:   { bed, duck }
  margins: { safe }
  variation: { ... }      // see below
}

Slot {
  id
  kind:  'clip' | 'still' | 'design' | 'text' | 'audio'
  min, max                // how many items fill this slot
  len:   { min, max }     // per-item duration on the timeline
  motion                  // a camera-move or fx preset id
  trans                   // transition into each item
  track                   // which track it lands on
}
```

**Templates ship as data in `shared/compositions/templates/*.json`, not in a
table.** This is the pattern migration 211 set for caption presets, and its
comment states the reasoning: a template is only meaningful alongside the
compiler that reads it, so the two ship together, and what belongs in the
database is the operator's choice. Store a template id on the composition and
nothing else.

**Variation rules are part of the template, not polish.** Thirty videos with
identical pacing and an identical push-in reads as filler and damages the feed
it is posted to. A template holds a seeded rotation over motion presets,
transition types and hook treatment, so item N of a batch differs from item 1
in a way a viewer notices and an operator did not have to choose.

### 5. Preloaded templates

Eight, shipped with the code so Daniel never builds one by hand:

| id | Shape |
|---|---|
| `talking-head` | One clip, tighten, captions, music bed under speech |
| `stills-montage` | 6 to 8 stills, camera moves, on-screen text, music |
| `project-reveal` | Before and after, slow push, minimal type. Architecture work |
| `quote-series` | Text-led, Design pages, 10 to 15 seconds |
| `walkthrough` | Screen or site footage, lower thirds |
| `hook-cta` | Hook, problem, solution, CTA. Structural, for paid |
| `carousel-to-reel` | Existing `social_posts.storyboard` frames animated |
| `coverage-roundup` | Headlines and logos, match-cut treatment |

**Built, 8 November.** `shared/templates/*.json`, loaded and validated by
`backend/src/services/compositionTemplates.js`, served at
`GET /api/compose/templates` (summaries) and `?full=1` (whole, for binding).
All eight bind to a valid Composition at minimum and maximum fill; the suite
is `backend/tests/composition-template.test.js`, 113 assertions.

Four things the authoring surfaced, each of which changed the model:

1. **A template carries only fields the binder reads.** The first drafts
   declared `motionAmplitude`, `transLen`, `fit`, `anchor`, `fade`, `audio`,
   `margins` and a `duration` target. Nothing read any of them. A JSON file
   that states a constraint nothing enforces is worse than not having it,
   because the next person reads the file and believes it, so the shipped
   eight are stripped to the read set and a test fails on any field outside
   it. `motionAmplitude` turned out already satisfied: `MOTIONS` caps travel
   at 12% scale and 3.5% position, tighter than the 10%/4% the author asked
   for, and a pre-capped vocabulary is a better guarantee than a per-slot
   knob.
2. **`alignTo`.** Every slot ran on its own clock, so a walkthrough's five
   2.4s section labels finished by 15s while the footage ran to 25s and four
   of them sat over the wrong shot. A text slot now names the slot it
   annotates and takes its times, clamped to its own length so a label
   appears and leaves rather than running the whole shot. Drift is 0.000s.
3. **One caption source per composition.** The renderer took
   `captionSources[0]` and dropped the rest without a word, in the one
   function whose own comment forbids exactly that. Nothing produced two
   until templates did. It now throws, `validateTemplate` refuses a template
   that would produce two, and `caption.from` makes a template with both
   on-screen type and a clip say which the preset styles. Guessing from slot
   kinds got it wrong: a walkthrough's clips are b-roll, not somebody
   speaking.
4. **A `null` in a transition rotation is a hard cut**, and it is the only
   way to ask for a cut between two unrelated mastheads and a fade where two
   shots of one spread sit together. `variant.trans || slot.trans` read it as
   "no opinion" and substituted the slot's fade, so `coverage-roundup`'s
   `[null, 'fade']` faded everything. The variant now carries `hasTrans`
   alongside `trans`, three states rather than two.

Two ideas from the authoring that are **not** built and are worth doing:
`audio: { bed: true, duck: true }` (ducking the music bed under the voice,
which every one of the eight asked for) and a `caption.fallbackPreset` driven
by a luma probe under the text band, which is the honest answer to white type
on an architect's white plaster wall. Both belong with the QC gate.

> **CORRECTED 8 November: ducking was already built, and is now wired.**
> Saying it was "not built" was wrong. `shared/compositionRender.mjs` has
> implemented it all along with `sidechaincompress`, triggered by
> `comp.ducking` or a track's `duckUnder`. The only thing missing was the
> binder passing a template's request through, which is one line.
>
> Wiring it turned up a real fault in how the render decides WHICH track is
> the voice. It classified by source kind — a clip is speech, an audio source
> is music — which is right for a talking head and backwards for a
> walkthrough, where the voice is a recorded narration on an audio track and
> the clips are silent b-roll with room tone. Ducking that composition by
> kind lowers the narration under the ambience. A source may now say
> `voice: true` or `voice: false`, with the kind-based guess as the default
> only, and a template's slot carries it.
>
> `audio.duck` is on `talking-head`, where there is a voice and a bed to duck.
> It is **not** on `walkthrough`: its only audio slot IS the narration, so
> there is nothing else to lower, and `validateTemplate` now refuses a duck
> with nothing to duck rather than letting it sit there doing nothing.

---

## The batch runner

```
POST /compositions/batch
  { clientId, templateId, source, items[], options }
```

`source` is either a `social_batches` id (the brief and the per-frame on-screen
text already exist, which is why this is the preferred driver) or a list of
asset ids with a free-text brief.

> **CORRECTED 8 November, after reading the code.** A `social_batches` id
> cannot drive a thirty-item run, so it is **not** the primary driver. The
> batch row itself is a brief header: `client_id`, `brief`, `exemplars`,
> `trends`, `created_at`, `is_example`, and nothing per-frame. The content is
> in its child `social_posts` rows, and `generateBatch` hard-caps those at
> nine (`Math.max(1, Math.min(9, …))`, with the Claude tool's `minItems` and
> `maxItems` both set to that number). So one social batch is at most nine
> videos, and two weeks of content is several batches.
>
> **The asset-ids-plus-brief driver is therefore the primary one**, and a
> `social_batches` id is a convenience for runs of nine or fewer that reuses
> an existing brief. Two further corrections to the same assumption:
>
> - `storyboard` frames guarantee only `frame` and `shot`. `on_screen_text`
>   is optional, and style codes are deliberately omitted for every non-reel
>   kind, so a carousel's storyboard has no style at all. A runner reading
>   `on_screen_text` for its text slots will find it missing on a good
>   fraction of real posts.
> - **A live defect found on the way past:** the refine chat in the frontend
>   rewrites `storyboard` as an array of plain STRINGS and PUTs it back into
>   the same JSONB column, destroying every frame field. Any post a client has
>   been through refine with has no `on_screen_text`, no `style` and no
>   `duration_sec` left, and `resolveFrame` in the existing Remotion path then
>   falls back to the shot description or a hardcoded `octobercomms.com`.
>   Recorded in the fix-first list; not fixed in PR 8 or 9.

What it does, per item:

1. Bind the template's slots to the item's content, producing a Composition.
2. Validate it with `validateComposition()`. A template that produces an
   invalid composition is a bug in the template, and the batch says which slot.
3. Write it to `compositions` with the batch id and the template id on it.
4. Enqueue a render.

Then a **review sheet**, and it is **L5 ListDetail in its `sidebar` variant,
not a grid**. Thirty items times a thumbnail, a verdict, a rationale and three
buttons is about 120 controls with no reading order, and the rationale fields
that model change 3 exists to produce would truncate to nothing. L5 is the
shell for working a queue without losing your place, and its precedent is the
contacts screen in `ClientOutreachPage`, which is the same job: a compact
selectable list on the left (thumbnail at row height, name, a QC chip), the
record on the right (full frame, the `reason`, `beat` and `quote` fields in
full, approve, reject, open in editor). An **L3 StatStrip** above it carries
the batch roll-up: rendered, failed, approved, spend against estimate. No new
shell, and not StepRail, because a batch is a set rather than a sequence.

Three things that follow, and all three have bitten this codebase before:

- **The sheet is a row in `nav/sections.js` under Produce, not a modal.** Every
  page needs a door, and `routeDoors.test.mjs` fails a page nothing links to.
- **Reviewing thirty items is a keyboard task.** Approve, reject and next on
  keys beats ninety clicks.
- **Decide `phone` deliberately.** The Video row is `phone: false`, but
  approving a batch is exactly a phone job, so the sheet should be phone-enabled
  and "open in editor" has to degrade honestly rather than navigate to a screen
  phones are not offered.

> **CORRECTED 8 November: the cited precedent does not exist as code.**
> `ListDetail` and `StatStrip` are real components in
> `frontend/src/components/shells/`, with small layout-only signatures, so
> those two parts of the specification stand. The L-numbers are a naming
> convention and nothing is exported as "L5".
>
> But the contacts list in `ClientOutreachPage` is **not** a component and
> uses **no** dedicated CSS classes. It is a `card` div with `padding: 0` and
> per-row inline styles; the only class on a row is `chip chip-neutral` for
> the status. There is no reusable compact selectable row, no selected-row
> class, and no thumbnail-row class to adopt. So "reuse the contacts list
> shape" is a visual instruction, not a code one, and the sheet either writes
> inline styles the way that page does or adds real classes. The nearest
> actual precedents are `.approve-thumb` (a 64px media tile) and
> `.search-row.is-cursor` / `.avatar-thumb.sel` for selected state.
>
> Two nav facts for the same work: Produce has **7 rows** in 2 groups today,
> and `sectionPanel.test.mjs` imposes only a floor of 2, no ceiling. A render
> branch must be line-initial and exactly `{tab === 'key' &&` — single quotes,
> spaces around `===`, lowercase and underscores only — because
> `routeTargets.test.mjs` checks both directions and `produce` has no
> `DISPATCHED_ELSEWHERE` exemption.

Nothing leaves for Drive or Instagram until approved.

**Per-item failure must not fail the batch.** A fal timeout, a 403 for billing,
a missing asset: that item is marked and the rest continue. The old stills path
passed fal errors straight through, which is the wrong behaviour for a
thirty-item run.

**Progress as a stream, not a poll.** The review is item-level, so the page
needs per-item state. The existing render polls at two seconds, which the
editor review already flags as the wrong model for one render and is clearly
wrong for thirty.

---

## The reference analyser

Daniel's ask: *"is there a way to upload someones video to be analysed and
build a template from it? a claude video analyser?"*

Yes, and it is the better answer to "I want ten templates" than writing ten by
hand. Point it at ten reels, get ten template proposals for about a dollar.

What is recoverable from a finished video:

| Property | Method |
|---|---|
| Shot boundaries, cut rhythm, shot-length distribution | ffmpeg scene detection |
| Frame size, fps, duration | ffprobe |
| Loudness, true peak, how deeply music ducks under speech | ffmpeg loudness measurement; music level during speech against music level in gaps |
| Caption treatment: position, size, case, colour, words per cue, cue duration | Sampled frames, Claude vision plus OCR, **matched to the nearest of our 31 presets** |
| Moving stills or filmed footage, and how much motion | Median of pairwise grayscale frame differences sampled inside one shot |
| Structure: hook, problem, solution, CTA, and where cuts land relative to words | Transcribe, then Claude labels the archetype |
| Persistent overlay regions | Frame differencing across a shot |

What is **not** recoverable: the exact fonts (a visual approximation at best),
the source assets, the layering intent, anything behind the render.

**The design decision that keeps this honest: match to an existing caption
preset, never generate a new one.** A generated approximation of someone else's
type is where this feature would start lying about what it will produce, which
is the same fault the whole composition rewrite was built to remove. The output
is a template **proposal** with a confidence note per field, which an operator
confirms.

Cost per reference: probing and scene detection are free, Whisper on 60 seconds
is about $0.006, Claude vision on ten sampled frames is a few cents. Under
$0.10 each.

**One line on where the line is.** Reading pacing, cut rhythm and caption style
off a competitor is ordinary competitive analysis. Reproducing a distinctive
brand's look closely enough that their own audience would mistake it is not
what this is for, and proposing from our own preset set rather than cloning is
what keeps it on the right side.

> **Built, 8 November: the measurable half.** `shared/referenceAnalysis.mjs`
> proposes; `backend/src/services/referenceAnalyse.js` measures;
> `POST /api/compose/clients/:clientId/analyse-reference` runs it on an asset.
>
> **It cost far less than planned, because the QC gate already measures most
> of it.** Probing, the per-shot motion figure and the frame's own detail, and
> loudness all come from `services/renderQc.js` rather than a second
> implementation. The only new measurement is scene detection:
> `select='gt(scene,0.3)',showinfo` and read `pts_time` out of the log. On a
> file built with cuts at 2s and 4s it returns exactly `[2, 4]`.
>
> **Every field carries a confidence and a reason**, and the ones it cannot
> read come back `null` WITH the reason rather than as a plausible invention.
> The template it drafts is valid against `validateTemplate`, so it can be
> checked before anybody is shown it, and a field it could not read is left
> OUT of the draft — a template that states a constraint nothing measured is
> the same lie the first eight templates were stripped of.
>
> Three limits it states rather than papers over:
>
> - **One delta per shot cannot tell a push from a drift.** Both move a
>   similar quantity of pixels. So it proposes `subtle`, the gentlest of the
>   six, says that is what it is doing, and leaves the choice to the operator.
>   Claiming to read a specific preset off one scalar would be the invention
>   this module exists not to make.
> - **A flat shot is unreadable for movement, not still.** Zooming a solid
>   colour changes no pixels, so a zero delta there means "cannot tell".
>   Reading it as still would propose a cut-only template off a reference full
>   of movement. The same `detail_floor` the QC gate uses, found the same way:
>   on a real file, where two solid-colour shots came back at detail 0.16.
> - **The length range is the interquartile range, not the extremes.** A
>   reference almost always has one long establishing shot and one two-frame
>   flash; proposing min-to-max off those is a template with no rhythm at all.
>   A mutation sweep caught the test for this passing on a bound that the
>   11-second tail satisfied exactly.
>
> **Built, 9 November: the caption half of the judgement.**
> `shared/captionMatch.mjs` matches; `backend/src/services/referenceVision.js`
> observes; the Brief page has a panel with the cost on the one control that
> spends anything.
>
> **The model is never asked to name a preset.** It is asked only what a frame
> contains — is there type, where, how big, what colour, is a second colour on
> one word, is there a box or a glow, how thick is the outline, how many words
> to a line — in a closed vocabulary that is validated before anything is done
> with it. Which preset those observations are nearest is arithmetic in a pure
> module. Handed a list of 31 names a model picks one, and a confident wrong
> pick is the failure mode that matters when somebody runs ten references
> through this in an afternoon. A test asserts the prompt names no preset, no
> preset name and no typeface.
>
> **The round trip over all 31 is the guarantee.** Every preset can be asked
> what observations it would produce and those fed back through the matcher.
> The right answer is in the shortlist **31 times out of 31**, and that holds
> at all 27 combinations of a weight sweep — only the shortlist LENGTH moves,
> from a mean of 2.74 to 5.00. The exact pick is 25 of 31 and the six it does
> not name outright are named in the test, because they are genuinely
> identical in a still frame.
>
> **What a still cannot show, stated rather than guessed.** Four of the eight
> `animationType` values — `scale`, `pop`, `bounce` and a plain `none` —
> differ only in a per-cue entrance of about 120ms, which eight frames across
> sixty seconds will not catch. So the eight are grouped into the four
> families a frame does separate, and inside a family the answer is a
> shortlist with the reason. Size is the same story: the catalogue splits
> cleanly into the four `measured` presets at 36-44 and the 27 creator ones at
> 92-120, and within the creator group 105pt against 102pt is a sixth of a
> percentage point of frame height. So size is a BAND and is refused finer.
>
> **Outline thickness is what rescues the worst case.** Eleven of the creator
> presets are near-white, plain-family and within 18pt of each other, so
> family, colour and size put all eleven on one shortlist. Outlines run 3.5px
> to 10px, which is nearly a factor of three and visible, so the frames are
> sent at 1280 rather than 960 — at half size a 4px outline is 2px and the
> signal is gone — and the reported pixels are scaled back to the real frame.
> The eleven fall into groups of two, four and five.
>
> **A shortlist is reported but never written into the draft.** A template
> naming the first of eight equally good candidates would state a choice
> nothing made, which is what the first eight templates were stripped of.
>
> **Four faults, three of them in the wiring.** `probe.duration` does not
> exist — `renderQc.probe` returns `videoDuration` — so the pass refused
> every reference with "reported no duration" and never sampled a frame; the
> message was plausible and the file was fine. Routed to DeepSeek the pass
> would have failed inside the API call, so it now refuses beforehand and
> names the setting to change. And two found by the mutation sweep: the
> cap-height ratio is only load-bearing as a MEANING (it happens to move no
> band today, so it is asserted on the value), and the guard that stops a
> plain preset being scored on a highlight colour no frame shows only bites
> when the pass reports an accent WITHOUT a family — which is the realistic
> answer from a model that can see two colours but will not commit to how
> they are applied. Without it `cinema-gold` wins on a gold highlight that is
> on screen for 120ms.
>
> **25 mutations, none surviving.** Most of them make the matcher claim
> something rather than refuse it.
>
> **Still to do: the structural archetype** from the transcript, and storing a
> proposal. Templates are files in `shared/templates/`, so the panel offers
> the JSON to copy and says why rather than a Save that quietly does nothing.

---

## Cost visibility

Daniel's ask: *"id like the cost of each action to be highlighted on any button
im about to press, so i can keep an eye on rising costs."*

**First, one shared pricing table.** Unit prices are currently spread across at
least seven files: `stillsReel.js`, `usageTracking.js`, `costLog.js`,
`claude.js`, `visualise.js`, `adResize.js` and `routes/chat.js`. If the number
on the button and the number logged by `recordApiCost()` come from different
places they drift, and a cost label nobody trusts is worse than no label. Put
every unit price in `shared/pricing.mjs` and have both the estimate and the log
read it.

**The cost chip already exists. Extend it, do not build a second one.**
`components/FeatureCost.jsx` with `.feature-cost` in `index.css` is this
component: one fetch for the whole app shared through context, a **median** of
the last 30 days rather than a mean (its own comment explains why: one 4K
upscale drags a mean above what the next click costs, and an estimate that
overstates by 10x gets ignored), and it returns `null` rather than a figure
when there is no history, which is the "a free action shows nothing, not a
zero" rule already enforced in code. Note it is also the provider that caused
the login flicker in the agent guide's §12, so it does not ask for data until
there is somebody to ask for; keep that.

What it needs adding:

1. The unit price. **Already there.**
2. The computed total for the inputs currently on screen, which for a batch
   needs a server estimate. Show the locally-known unit price immediately and
   the total as plain text while it resolves, never a skeleton or a shimmer
   next to a button somebody is about to press.
3. What is left of that task's monthly budget, coloured only when the total
   exceeds it. A permanently coloured chip is decoration.
4. **A currency.** Every provider price here is USD and October works in USD,
   GBP and EUR. `formatMoney(amount, currency)` already exists and the house
   rule is that a wrong symbol is worse than no symbol, so the chip carries
   its currency rather than implying one.

**One chip per card, not per button.** Transcribe, captions, b-roll, visualise
and the batch all spend, and five chips on one card is ambient noise that
destroys the rule that a chip's presence means this one costs money. Put the
chip on the action that commits the spend, and give a card holding more than
two spending actions a single card-level total instead.

After a run it shows actual against estimate, so the table corrects itself
rather than quietly going stale.

Two rules:

- **A free action shows nothing, not a zero.** The chip's presence has to mean
  "this one spends money", or it becomes decoration.
- **A batch gets a pre-flight screen**: line items, a total, and a hard maximum
  that refuses submission above it, with the worker rechecking the cap before
  each paid step. This is the one genuinely good piece of operational
  engineering in `digitalsamba/claude-code-video-toolkit` and it is the right
  guard on a run that spends tens of dollars with nobody watching.

**Register a `video_batch` task budget before the first run.** Migration 185
set up the framework and it resets monthly, so a runaway batch stops itself
without taking chat, reports and press pitching down with it.

> **CORRECTED 8 November: the cap as built cannot stop a batch.**
> `assertUnderTaskCap(task)` in `backend/src/services/budget.js` is a
> point-in-time gate, not a reservation: it throws 429 only once
> month-to-date spend has **already reached** the cap. A thirty-item run
> passes it with one cent of headroom and then bills all thirty. And there is
> no `video_batch` row anywhere in the repo — the name exists only as a JSDoc
> example in `FeatureCost.jsx` — while `assertUnderTaskCap` returns silently
> for a task with no row. So today the cap is a no-op twice over.
>
> Three things follow, and none of them is "call the existing function":
>
> 1. **The pre-flight must project**, comparing estimated total against
>    `remaining_usd` itself. No backend code does this. `planBatch` in
>    `shared/compositionBatch.mjs` now does, including the two rules that
>    matter: no budget never reads as unaffordable, and spending exactly the
>    last of an allowance is within it rather than over it.
> 2. **A migration must seed the `video_batch` row**, or the cap is silent.
> 3. **The runner calls `assertUnderTaskCap('video_batch')` per item**, before
>    billing, with `recordApiCost()` plus `noteTaskSpend()` to keep the 30s
>    cache honest inside the loop. Per item rather than once up front, because
>    the point is to stop partway through a run that is overspending, which a
>    single check at the start cannot do.

---

## The QC gate

Thirty unattended renders need a machine verdict before a human looks at them.
The check set below comes from reading `notivn/AIEVv2`'s `qc.ts` and is entirely
measurable with ffmpeg:

- Resolution and fps against the composition's own `size` and `fps`.
- Loudness against a target (their target is −14 LUFS; our existing pipeline
  normalises to −16 LUFS EBU R128, so pick one and state it).
- True peak above −0.5 dBTP.
- **Black frames mid-video only.** Leading and trailing fades are legitimate,
  so a naive black-frame check fails every correctly-faded video.
- Freeze of two seconds or more.
- Tail silence over 1.2 seconds.
- Audio and video duration drift over 0.5 seconds.
- A safe-area check that always passes but returns frames with obstructed
  bands outlined, for a human or an agent to look at.

Add one of our own: a **render-moved gate**. Take the median of pairwise
grayscale frame differences inside each item's window and fail an item that
should be moving and is not. This catches a camera move that silently did not
apply and an image-to-video call that returned a still, which is the failure
mode the fal dependency makes likely.

> **Built, 8 November.** `shared/renderQc.mjs` judges; the ffmpeg that
> produces the numbers is `backend/src/services/renderQc.js`, in two decode
> passes rather than seven. The verdict is stored on the render row by
> migration 250 and the review sheet orders by it, worst first, which is the
> whole point: the operator's first click is the most broken video rather than
> the first one submitted.
>
> **Three levels, not pass and fail.** `fail` is measurably broken, `look` is
> suspicious but possibly intended, `pass` is nothing measurable wrong — which
> is not the same as the edit being good, and the sentence says so. Nothing
> blocks approval. That is the reelChecks lesson written down in that file: a
> checklist that blocks gets switched off within a fortnight.
>
> **CORRECTED: the loudness target did not exist.** This section said "our
> existing pipeline normalises to −16 LUFS EBU R128, so pick one". Nothing
> normalises loudness anywhere. `loudnorm` appears in the repo exactly once,
> in the list of filters `scripts/ffmpeg-check.js` verifies, and no service
> uses it; the composition mixer runs `amix` with `normalize=0` on purpose so
> volume does not change with track count. So loudness is **measured and
> reported, never graded** — a loudness check with no loudness normalisation
> fails almost everything for a reason the operator cannot act on. It becomes
> a graded check the day the render normalises, which is worth doing: thirty
> videos at wildly different levels is a real problem in a feed.
>
> **Two faults found by running the gate on real renders**, both of which
> would have made it cry wolf:
>
> - a solid colour zoomed is pixel-for-pixel identical, so the motion measure
>   correctly read zero and the gate failed a render that was perfect. A frame
>   with no detail is now UNMEASURABLE rather than broken, and the same fact
>   downgrades a freeze on a flat picture from `fail` to `look`. The detail
>   figure comes free: it is the standard deviation of frames already in
>   memory for the motion measure.
> - `ebur128` logs a running figure per frame as well as a summary, so the
>   first `I:` in its output is the first frame's. A sine measured at
>   −21.8 LUFS was read as −70, which would have reported every video as
>   54 LU too quiet.
>
> The `blackdetect`, `freezedetect` and `ebur128` filters are now in
> `ffmpeg-check.js`'s inventory, along with the render graph's own
> `sidechaincompress`, `amix`, `adelay`, `apad`, `atrim` and `tpad`. A filter
> dropped between ffmpeg versions would otherwise fail inside an unattended
> batch, where the only symptom is thirty videos with no verdict.

---

## The FX library

Six of the seven effects in the social post Daniel sent reduce to one thing: an
animated graphic with alpha, composited over the speaker, with its state driven
by word timings. The animated alpha source kind above is the whole mechanism;
the effects are then data.

| Effect | Needs |
|---|---|
| Glass panels, iOS-style toggles, checklist, editing timeline, orbiting thumbnails | An animated alpha source. Authored in HyperFrames or Remotion, rendered to transparent video |
| Checklist ticking as the speaker reaches each item; a match cut holding one word in place | Word timings driving overlay state. Already available |
| Spotlight (background darkened, subject lit) | Subject segmentation per frame, or a vignette tracked to a face. **The only hard one of the seven** |

**Do not chase the full list.** That aesthetic is tech-creator register, and
October's clients are architects and design-led brands where glass widgets and
phone toggles read as off-brand. Build the mechanism, ship three restrained
effects, and let the register be a per-client choice. Daniel still owes an
answer on whether the library serves his own channel or client work (see **Open
decisions**).

The post that prompted this is gated marketing ("follow me and comment FX").
We have the HyperFrames kit installed already and do not need its setup guide,
and a list of effect names is not evidence any of them render well.

> **Built, 9 November: the mechanism and three effects.**
> `shared/compositionFx.mjs` is the catalogue; `compositionRender.mjs` has an
> `fx` branch; the preview paints the same mask; `stills-montage` and
> `project-reveal` carry a scrim.
>
> **The mechanism did not exist, and the model's vocabulary hid that.** `fx`
> has been a declared, validated source kind since the model was written —
> `SOURCE_KINDS`, `PICTURE_KINDS`, a validator requiring `effect` and
> allowing `duration` and `params`. `compositionRender.mjs` had no branch for
> it, so an fx source became an ordinary ffmpeg input, the route found no
> asset for it and answered `Source "x" has no file on disk`. The same fault
> class as captions, invisible for the same reason: the graph string was
> correct about a file that did not exist. **"Ship three effects as data"
> would have shipped three effects that cannot render.**
>
> **Four ffmpeg facts, each measured, decide the shape of all three.**
>
> - `geq` per frame costs **24x**: 3755ms against 154ms for the same picture
>   generated once, over 60 frames at 1080x1920. A batch of thirty cannot pay
>   the first figure. So every effect is ONE frame, generated with `geq` and
>   held with `loop=-1:size=1` — 252ms for the whole layer.
> - **`drawbox` writes colour and leaves alpha at zero.** A rule drawn with
>   it measured `[228,228,228,0]` where `geq`'s measured `[255,255,255,230]`:
>   it composites as *nothing*, with no error in the log.
> - **`drawbox` exposes neither `t` nor `n`**, so there is no cheap animated
>   mask to fall back to: `n/100` errors outright and `t` silently fills the
>   full width.
> - **`format=yuva420p` must precede `geq`** or there is no alpha plane to
>   write; the expression is evaluated and discarded and the effect comes out
>   opaque.
>
> Movement, where an effect wants it, comes from the item transform the
> template model already animates and tests. An effect that must change shape
> per frame is not in the catalogue, and the reason is cost, not taste.
>
> **The three, and why these three.** Measured against a mid-grey base of 128,
> because on black a scrim is invisible and on white a rule is:
>
> | Effect | What it does | Measured |
> |---|---|---|
> | **Bottom scrim** | Darkens the lower frame so white captions survive a pale picture | 128 at 0.2 and 0.4 down, 55 at 0.80, 36 at full |
> | **Vignette** | Holds the eye on the middle of the frame | centre 128, mid 104, edge 23, corner 0 |
> | **Hairline rule** | A thin inset line under a date or a project name | 244 on the line, 128 four pixels above and inside the inset |
>
> The scrim is the one with a named problem behind it. Both templates that
> burn type over photography ship `gallery-quiet`: `#FBF9F7` at 36pt with a
> 2px outline. Over an architect's white plaster wall that is marginal, and a
> graded scrim under the words is the fix rather than a louder preset. It is
> on `stills-montage` and `project-reveal` and nothing else.
>
> **Where the ramp ends is a measurement, not a taste.** Burned captions sit
> on ASS `MarginV` 320 of a 1920 frame, so a two-line block occupies roughly
> 0.78 to 0.85 down the frame. The first version ramped from 0.62 to the
> bottom EDGE, which puts 30 to 40% black where the words are and the darkest
> part of it in the empty strip underneath. Hence a `full` parameter,
> defaulted to where the type actually is.
>
> **The preview paints the same mask.** The compositor cannot run `geq`, and
> before this the layer was skipped silently — `getElement` returns null for a
> source with no url — so a template's scrim was in every rendered file and in
> none of the previews. That is the state the caption-legibility judgement
> would have been made in. So each effect describes itself three times: the
> `geq` expression for ffmpeg, the arithmetic as a function, and a canvas
> gradient for the browser. Two implementations of one description drift, so
> `composition-fx-agreement.test.js` PARSES THE SHIPPED EXPRESSION, evaluates
> it at every row down the middle of the frame plus a grid, and holds all
> three against each other with every parameter driven to the end of its range
> furthest from its default.
>
> **Reachable from two places.** The templates carry the scrim; the
> composition editor has `+ Add effect`, which is free — generated in the
> render, nothing uploaded, no API call, so no cost chip.
>
> **42 mutations, none surviving**, across the catalogue, the render branch,
> the preview's paint and the template binding. What the sweep caught:
>
> - **An oval vignette passed a test rendered on a square frame.** Dividing by
>   `W/2` and by `H/2` is the same arithmetic at 200x200, so swapping one for
>   the other changed nothing and the test passed on a broken expression.
> - **The preview's corner was lighter than the export's**: 0.935 where the
>   mask was 1.0, because the gradient's stops were spread evenly to the
>   corner and interpolated up to saturation from below. The stops now stop at
>   the saturation radius; 24 segments hold the worst error across the whole
>   parameter range at 0.006, against 0.046 at eight.
> - **A redundant stop.** The sweep walked straight through the removal of the
>   corner stop with nothing failing, which is what redundant means: a
>   gradient holds its last stop's colour past it.
> - **`fps` removed from the render's per-item chain survived**, because the
>   fx branch gave that line a second home and `String.replace` took the
>   first. The sweep was mutating the effect branch and reporting the real
>   one as covered.
> - **A grid that could not see its own parameter.** A 2px line in a 1920-high
>   frame falls between sampled rows, so widening it changed nothing anywhere
>   and `thickness` looked wired when nothing proved it was. And halving it
>   from 2px to 1.5px genuinely changes no pixel, both rounding to the same
>   two rows, so the test now drives each parameter to its furthest extreme.
>
> Two faults in the module itself, both found by its own tests rather than by
> reading it: `Number(n)` read a null parameter as the DARKEST POSSIBLE scrim
> instead of refusing it, and `opts.width || 1080` took the default for a
> falsy zero, so the positive-frame-size guard beneath it could never fire.
>
> **Not built: anything animated, and anything segmented.** The glass panels,
> the iOS toggles and the orbiting thumbnails all need an authored animated
> alpha source, which is a different piece of work from this one. Spotlight
> still needs segmentation and is still the only hard one.

---

## What to take from the five repos, and what not to

Five repos were assessed on 8 November 2026. **No code from any of them enters
this repository.** Three have licences we would not touch and the one with the
best editorial thinking is non-commercial.

| Repo | Licence | Verdict |
|---|---|---|
| `browser-use/video-use` | MIT, clean | Borrow ideas. Best designed of the five |
| `notivn/AIEVv2` | Repo MIT, but vendored AGPL gateways, embedded Remotion above its free threshold, 86 audio files of unknown licence, a watermark remover that violates provider terms | Read it, depend on nothing |
| `digitalsamba/claude-code-video-toolkit` | MIT, actively maintained | Borrow the job and spend protocol |
| `appariciojunior/video-editor-skills` | **CC BY-NC 4.0, non-commercial only** | Blocked. Re-derive its numbers against our own fixtures, copy no prose |
| `assafkip/claude-video-editor` | **MIT plus Commons Clause**, which forbids selling a product whose value derives substantially from the software | Blocked, and worse than AGPL for a hosted product. Mostly other people's work vendored in |

What to take, in priority order:

1. **The packed-transcript agent surface** (video-use). Pack word-level
   transcripts into one compact phrase view as an agent's primary input, and
   render filmstrip and waveform images only at decision points. "Read, don't
   watch." We hold the word timings and the mapping module already.
2. **Rationale fields on items** (video-use). Covered above as model change 3.
3. **The QC check set** (AIEVv2). Covered above.
4. **The spend protocol** (digitalsamba). Estimate, then a hard cap refusing
   submission before spend, the worker rechecking before each paid step, resume
   by job id, and a prune command.
5. **The concurrent-edit protocol** (AIEVv2). Re-read the stored composition
   immediately before writing, edit in place on exact keys, preserve
   unrecognised keys at any depth, snapshot before and after. **We hit this the
   moment an agent edits a composition the operator has open**, because the
   editor autosaves on a 1.5 second debounce and would overwrite the agent
   silently.
6. **Hard rules worth adopting** (video-use): a 30ms audio fade on both edges
   of every segment; `setpts=PTS-STARTPTS+T/TB` for overlays; subtitles written
   on output-timeline offsets; snapping to word boundaries; 30 to 200ms padding
   for ASR drift. Each is a real bug class.
7. **A reimplemented motion check** (assafkip, method only). Covered above as
   the render-moved gate.

**Do not adopt video-use's rule that a single filtergraph is always wrong.**
Their concern is double-encoding when overlays are added. Ours is xfade and
overlay correctness in one pass, and the preview-to-render agreement tests
prove our graph matches what the browser draws. Our architecture is the right
one for our case.

### The silence fix

Both research threads landed on the same point from different repos, and it is
a real defect in shipped code.

`shared/silenceCut.mjs` works purely from Whisper word timings, with no audio
check at all. So a gap holding a cough, a door, a chair or room tone reads as
silence and gets proposed for removal.

Evidence gathered: one repo validates a gap as a pause only when it is at least
85% silent on the waveform. Another measured that at −30 dB, ffmpeg's
`silencedetect` called 48.6 seconds of a file silent while only 18.2 seconds of
that sat in a genuine inter-word gap. A third data point from the same source:
on one file, −40 dB found no silences, −30 dB found 13 and −25 dB found 21, so
the right threshold is a property of the file rather than a constant.

**The correct design uses both signals: word timings choose the candidate gaps,
audio energy confirms each one is actually empty.** Neither alone is right.

Also worth re-deriving as our own defaults, measured against our own fixtures
rather than copied:

| Behaviour | Ours today | Worth testing |
|---|---|---|
| Air left in a shortened pause | `leave_s` 0.12, symmetric | Asymmetric, 40% before the cut and 60% after |
| Padding around a cut | `pad_s` 0.04 both sides | 0.08 before, 0.12 after, snapped to the nearest silence edge |
| Gap validation | None | A gap counts only if ≥85% silent |

And two review artefacts worth copying as ideas: a transcript with cut words
struck through as the human review surface, and a pause report showing cuts and
seconds saved per candidate threshold **before** anything is committed.

---

## Build order

By dependency, not by what demos. The two pieces everything else sits on are
the model changes and the template model.

| | What | Sessions | Why here |
|---|---|---|---|
| 0 | **Fix the broken edges** (below) | 1 | Everything below sits on this code |
| 1 | The silence fix: threshold sweep plus audio cross-check in `silenceCut.mjs` | 1 to 2 | Self-contained, improves a shipped feature, and the batch depends on it being right |
| 2 | Model changes: animated alpha source, transform fields, rationale fields | 3 to 5 | Nothing else is possible until the model holds them |
| 3 | One shared pricing table plus the cost chip | 2 to 3 | Before anything spends in bulk, not after |
| 4 | Template model and the eight preloaded templates | 4 to 6 | The keystone. Bulk is meaningless without it |
| 5 | The batch runner, fan-out, and the review sheet | 4 to 6 | The feature Daniel asked for |
| 6 | The reference analyser | 4 to 6 | Turns ten reference reels into ten templates. Moved up: see below |
| 7 | The QC gate | 2 to 3 | Needed before a batch runs unwatched twice |
| 8 | The worker renders the composition model, **and `update.sh` learns to deploy it** | 3 to 5 | Moves thirty encodes off the app box. See the first trap |
| 9 | The agent skill: Composition JSON schema, invariants, worked examples | 2 to 3 | What makes an agent able to drive the editor |
| 10 | The FX library, three to six effects | 4 to 6 | Nothing depends on it, so it goes late. **Built 9 November: the mechanism, three effects, the preview's copy of the mask** |
| 11 | Spotlight and segmentation | 3 to 5 | The only genuinely hard effect. Last, and optional |

Steps 2 and 4 are where this is won or lost.

> **RE-SEQUENCED 8 November: step 8 must come before step 5.** The render
> "queue" is not a queue. It is two module-level variables in
> `routes/compose.js` (`_activeRender`, `_renderQueue`) and a `processQueue()`
> that runs **exactly one ffmpeg per Node process** and loses every pending
> item on restart, leaving its `composition_renders` rows at `'queued'`
> forever with nobody to run them. Nothing drains that table: there is no
> worker and no cron.
>
> So a batch runner built on it would enqueue thirty renders into an array,
> encode them one at a time on the app box, and silently abandon the
> remainder the next time the process restarted. That is not a fixable detail
> of the runner; it is the runner's foundation.
>
> The repo already has the right pattern and it is proven in production:
> `video_jobs` (migration 090) is claimed with `FOR UPDATE SKIP LOCKED` over
> `POST /api/video/worker/claim` behind `X-Worker-Token`, and drained by
> `dev/platform/worker/index.js` on its own box. `edit_jobs` (migration 128,
> extended by 228) is the only queue here that already models per-item
> percentage progress, which is what the review sheet needs — though its
> drainer and route have both been deleted, so `claimNext`, `complete`, `fail`
> and `setProgress` are live code with no caller.
>
> Revised order: **step 8 (the durable queue and the worker) becomes step 5**,
> and the batch runner follows it. The pure part of the runner does not have
> to wait, and has not: `shared/compositionBatch.mjs` is built and tested.
>
> **Built, 8 November, the durable half.** Migration 248 adds `claimed_at`,
> `claimed_by` and `attempts` to `composition_renders` with two partial
> indexes; `services/compositionRenderQueue.js` owns the claim
> (`FOR UPDATE SKIP LOCKED`, the same statement `video_jobs` uses), the
> reaper, the attempt ceiling and the startup release;
> `services/compositionRenderRunner.js` derives a render from a composition id
> alone, which is what makes one resumable at all. Proved against a real
> Postgres in `composition-render-queue.db.test.js`, including two overlapping
> transactions racing for one row and a thirty-item batch interrupted at item
> twelve, where nineteen still run on the next instance.
>
> **Still one ffmpeg at a time, on the app box.** That is honest rather than
> fixed: thirty renders take thirty renders' worth of wall clock. What changed
> is that they no longer vanish. Moving the encode to the worker box is its
> own piece of work, because that box has no shared disk and pulls its inputs
> over HTTPS, so it is a file-transfer project rather than a flag — and
> `update.sh` has no worker step at all, which is the deployment hole already
> recorded in the traps.
>
> **The editor's Export has never worked, and this is why.** `assetFilePath`
> matched `(\d+)` for the client segment of an asset URL, and a client id is a
> UUID, so it returned null for every asset in the system and every
> composition render answered `Source "sX" has no file on disk.` Its unit test
> passed on a fixture of `/api/brand/file/7/…`, a shape no real asset has
> ever carried. Two further resolution faults sat behind it: the route read
> the `source_assets` column alone and ignored each source's own `asset`, so a
> template-built composition could not resolve either, and the library row was
> keyed on `Date.now()` so two renders in one millisecond collapsed onto one
> row. All three are fixed and covered end to end in
> `composition-render-e2e.db.test.js`, which goes from asset rows to a pixel
> in the output.
>
> One thing deliberately left: `generatedMedia.localPathFor` and
> `adResize.diskPathForOutput` resolve the same URL shape with only the
> client-folder traversal guard, so a client segment of `..` escapes the
> uploads directory there. Their inputs are URLs this server wrote from a
> client id rather than anything a user types, so the reachable risk is nil,
> but it is three copies of one function and the composition one now has both
> guards. Worth consolidating into one helper.

**The analyser was at step 9 and that was phasing with better words.** This
document argues that pointing the analyser at ten reference reels is a better
answer to "I want ten templates" than writing eight by hand, and then
scheduled the hand-written eight at step 4 and the analyser twenty-odd
sessions later. It is one of Daniel's own asks, not a deferred nicety, so it
now sits at step 6, directly after the batch runner it feeds templates to.
Steps 10 and 11 genuinely are deferred features and nothing depends on them.

**When each of his asks lands, stated plainly** so the order is a decision he
can argue with rather than something buried in a table: preloaded templates at
step 4, the batch itself at step 5, the analyser at step 6, cost labels at
step 3, and editing a batch output in the editor from step 5 onward because
the batch writes Compositions and the editor already opens those.

---

## Fix these first

Found while reviewing Produce on 8 November. All four predate this plan and all
four sit under it.

1. **"Send to Edit" on the Record tab is broken.**
   `RecordingsPage.jsx:515` posts to `/edit/clients/:clientId/edit/from-recording`.
   `routes/edit.js` was deleted in step 8 and `/api/edit` is mounted nowhere in
   `index.js`. The button renders at `RecordingsPage.jsx:949` and fails with a
   toast. The Record to Video handoff that `ClientVideoTab` wires through
   `onSendToEdit` never completes.
2. **Stills → Reel is gone from the product but documented as shipped.**
   `components/edit/StillsReelPanel.jsx` is unimported dead code calling the
   same deleted API. `services/stillsReel.js` is orphaned.
   `services/editJobs.js` survives only because `socialCaptionRender.js:55`
   borrows its `diskPathForUrl` helper. `edit-studio.md` still presents the
   feature as live. Either restore the route or delete the remnants, and either
   way **keep `stillsReel.js`'s motion presets and price table**, because this
   plan needs both.
3. **`agent-guide.md` is behind the code.** Its section 9 opens "The video
   timeline, as it stands while the editor rewrite is in progress" and then
   describes `edl.mjs`, `Timeline.jsx` and the five-pass render as live today.
   All of it is deleted. Section 7 stops at PR #1959 and does not record the
   7 November render queue, the render-state persistence (migration 241) or
   `video-editor-review.md`. Four more docs are stale: `edit-studio.md`,
   `video-timeline-spec.md`, `editor-replaces-basic-editing.md` and
   `recorder-polish-roadmap.md`, which points at `editProcessor.js` and
   `routes/edit.js` as reference reading.
4. **Composition renders have no retention sweep and the wrong asset source.**
   They land in `uploads/<client>/` and the 03:15 sweep covers `video-clips/`
   and `video-outputs/` only. They record into the library as `scene_render`
   (`compose.js:520`), a label meant for something else, so the Library cannot
   tell them apart and `assets.archiveBySource` has nothing to target. Thirty a
   fortnight makes both of these matter. Add a `composition` source to the
   three places a source has to be registered (the `client_assets` CHECK
   constraint, `SOURCES` in `services/assets.js`, and `SOURCE_LABEL` in
   `AssetLibrary.jsx`) and give composition output a retention rule.
5. **The refine chat destroys a post's storyboard.** The frontend's refine
   round-trip rewrites `social_posts.storyboard` as an array of plain STRINGS
   and PUTs it back into the same JSONB column, so every frame field goes:
   `on_screen_text`, `style`, `duration_sec`, `voiceover`. The existing
   Remotion path then falls back to the shot description or a hardcoded
   `octobercomms.com` in `resolveFrame`. Any post a client has been through
   refine with is already in this state. **Found 8 November, not fixed**, and
   it has to be fixed before a batch reads storyboards for its text slots.
6. **`compositions` has nowhere to record which batch or template made it.**
   Two migrations created the composition tables (236, 241) and nothing has
   altered either since; there is no metadata column at all, and
   `compositions.create({clientId, createdBy, title, data})` writes exactly
   four columns and cannot set `source_assets` or `transcripts`, so a batch
   has to create then update. A migration is needed before a review sheet can
   group thirty items, and `edit_jobs` (migration 228) is the model to copy
   for per-item `progress` and `stage`.

---

## Open decisions

Two of these change what gets built. Do not guess at them.

### 1. The image-to-video question — ANSWERED 8 November: Path B

**Deterministic camera moves. No new pixels invented. No hosted
image-to-video in the batch.** Daniel's call, and it settles more than the
cost line:

- **No third-party generative API in the critical path** of an unattended
  fortnightly run. That was the real argument, not the money.
- **A fortnight of thirty videos costs about £2** rather than £29 to £67,
  so the spend question stops being a question.
- **Nothing in the batch can fail at a vendor.** A camera move renders in the
  same `filter_complex` as everything else, in under a second, identically
  every time.
- **It makes the transform fields load-bearing rather than cosmetic.** A
  deterministic move IS an animated `scale` and `pos`, so step 2 is now the
  thing the whole batch's motion rests on, not a nicety shared with the
  mockup's inspector. Build it accordingly.
- **The geometry argument is why this is the right answer for these
  clients.** Image-to-video models are trained mostly on people and general
  scenes; on an interior or a façade the common failure is a bowed window
  frame or a drifting reveal line. On a photograph of a person nobody
  notices. On architecture the eye knows what straight looks like, so it
  reads as cheap in exactly the register the clients pay for.

`services/stillsReel.js` keeps its six motion presets as the vocabulary for
the deterministic moves (push-in, drift, reveal, orbit, rise, subtle). Its
fal price table and i2v call path are no longer needed by this plan; leave
them until something else wants them rather than deleting a working
integration on the way past.

The material below is kept as the record of what the decision was made
against, not as an open question.

The cost model for thirty videos was dominated almost entirely by fal
image-to-video: $36 to $81 USD of a $37 to $85 total, at $0.20 to $0.45 per
animated still.

Against that, `assafkip/claude-video-editor` published a root-cause analysis
dated 11 June 2026 reporting **16 of 16 hosted image-to-video runs failing
mid-production**, after which they removed hosted i2v and replaced it with
deterministic camera moves over stills. That claim came from a research agent
reading the repo and has not been independently verified, but it matches the
risk profile of a fortnightly unattended batch leaning on a third-party
generative API.

Deterministic camera moves cost nothing, never fail, and render inside our own
graph once items carry animated `scale` and `pos`. The trade is less motion and
no generated parallax.

**The test:** six real client stills rendered both ways, viewed side by side.
About $1.50 and twenty minutes. The answer decides whether a fortnight of
content costs about £29 to £67 or about £2 (converting $37 to $85 at 1.27,
the rate stated because it moves and because the figures above are billed in
USD), and whether the batch has a third-party dependency in its critical path
at all. The second of those is the reason to run it.

My recommendation, for whoever runs it: default to deterministic moves, make
i2v a per-template option, and let the bake-off decide which templates earn it.

### 2. Who the FX library is for — ANSWERED 8 November: both

Daniel's answer was "for me and clients", so the library serves two registers
and the register is a property of the client, never of the effect author's
taste.

That is not a licence to ship seven loud effects. It means the FX library
follows the caption presets' own pattern, which already solved this problem:
`shared/captions/presets.json` carries 31 entries with a `category`, a
`bestFor` line and an `acceptsAccent` flag, and the four `measured` presets
exist precisely because the 27 ported creator ones were the wrong library for
an institution. The guide states the rule it protects: a client's brand kit may
change a caption's typeface, never its structure, because "a skin that could
change size, weight or highlighting would make 'the Nordic one' mean something
different on every account."

So each FX entry carries a **register**: `creator` (glass panels, phone
toggles, orbiting thumbnails, the checklist) or `editorial` (a spotlight, a
match cut, a restrained lower third, a progress rule). A template names the
register it draws from, and a client's default register is set once beside
their caption preset. October's own channel draws from both; an architecture
practice draws from `editorial` and never sees the rest.

**Do not let the FX library become a ninth tab.** It is inspector sections
plus shipped data, exactly as the caption templates are, and the guide is
explicit that adding a template as a React composition is the `StyleA/C/G.jsx`
pattern that does not scale past three.

> **Built, 9 November, and the register is thinner than this says.** Each
> entry in `shared/compositionFx.mjs` carries a register, and the list is
> `editorial`, `creator` and `both` rather than the two above: the scrim and
> the vignette suit either channel and marking them `editorial` would hide
> them from Daniel's own.
>
> **Nothing shipped is creator-register only, and the test pins the count
> rather than the intention**: `fxFor('creator')` returns two, not three. A
> catalogue listing a creator effect it does not have would be the same
> invention the first eight templates were stripped of. The register is in
> place for when an animated alpha source lands, which is what every
> creator-register effect on the list above actually needs.
>
> It is not a ninth tab: shipped data, one `+ Add effect` control in the
> composition editor, and a `fx` list on a template.

### 3. Smaller calls, with recommendations

| Question | Recommendation |
|---|---|
| What drives a batch | A `social_batches` id. The brief and the per-frame on-screen text already exist there |
| Where the audio comes from | A music bed plus on-screen text from the storyboard. Costs nothing and the timing is exact. TTS voiceover is under $0.20 for thirty videos but needs the transcript mapped back onto the timeline |
| Where images come from | Allow uploads, the client asset library and Visualise. Default to the library |
| Approval | A review sheet with per-item approve, reject and open-in-editor. Nothing reaches Drive or Instagram unapproved |
| One template per batch or per item | Per batch. Per item needs a picker on every row and buys little |
| Loudness target | Pick one and state it. The existing pipeline normalises to −16 LUFS; the QC set we are borrowing from targets −14 |

### 4. Where the template picker lives — DECIDED 8 November, reversible

Three proposals were written independently and judged through two lenses. The
lenses split, which is the useful part:

| Proposal | Operator-speed lens | Design-system lens |
|---|---|---|
| A field in the batch form | **1st** | 2nd |
| A `Templates` row in Produce | 2nd | **1st** |
| A picker inside the editor | 3rd | 3rd |

Both lenses ranked the editor picker last, for the same reason: it hangs on
`!hasSources`, so it is shut the moment a clip lands, and it sits on the one
screen an unattended batch never opens.

The split is a real disagreement about category. Operator-speed says the batch
form has to exist anyway, so a field there costs no navigation and carries the
same editorial payload as a gallery when the rows show `bestFor`, a shape line
and a register. Design-system says the house already decided this with
`{ tab: 'hooks', label: 'Hook vault' }` in `sections.js`: a library of
creative primitives chosen *before* the artefact exists is a row, and the 31
caption presets are not the precedent because `+ Captions` modifies a
composition that already exists.

**Taken: the field in the batch form, built as a shared `TemplatePicker`
component.** It is the cheapest thing to be wrong about. The batch form is
required for the runner regardless, both judges grafted the shared component,
and if the browse turns out to be wanted, the row renders the same component
with no second implementation. Expanded on first visit so the first run *is*
the gallery.

Deliberately not budgeted: eight looping previews. Destination's own author
named this as its weakest point. Previews need eight sample renders, R2
storage with a retention rule composition output still lacks, and a re-render
on every template JSON change. A static poster frame per row is the first
increment; motion is a decision with a cost attached, not a detail.

One correction the judging turned up, now fixed in `agent-guide.md`: the
both-ways door check is `frontend/tests/routeTargets.test.mjs`, not
`tests/lib/tabDoors.mjs`, which no longer exists. A `Templates` row would
need a literal `{tab === 'templates' &&` branch in `ClientVideoTab.jsx` or it
fails CI as a row that opens a blank screen.

---

## Traps

- **The deploy does not reach the video worker, so step 7 would ship nothing.**
  `update.sh` installs and reloads the backend (`october-platform`), builds the
  frontend, syncs nginx and handles the Shopify app (`october-mi-shopify`). It
  has no step for `dev/platform/worker/`, which `docs/omi/video-worker.md` says
  is started by hand on its own box with `pm2 start index.js --name
  video-worker`. A merge touching `dev/platform/**` updates the source on the
  box and the worker keeps running the old code until somebody connects to it.
  Step 7 moves thirty encodes onto that worker, so **step 7 must add the worker
  to `update.sh` or give it its own deploy job**, or it will appear to ship and
  silently will not have. Everything else here (the shared templates JSON, the
  migrations, the budget row) deploys cleanly through the existing path.
- **Remotion is already a direct backend dependency** (`backend/package.json`,
  `remotion ^4.0.0`, plus `@remotion/bundler` and `@remotion/renderer`) and
  renders the StyleA, StyleC, StyleG and StoryboardReel templates. Remotion's
  licence requires a paid company licence above a size threshold. This is
  existing exposure rather than anything this plan introduces, but confirm
  October's position before any new feature leans on that renderer.
- **The retention sweep does not cover composition output.** Covered above;
  repeated because a fortnightly batch fills the app box's disk in months and
  the failure mode is writes failing while deletes still succeed.
- **An agent and a human will edit the same composition.** The editor
  autosaves on a 1.5 second debounce. Without the concurrent-edit protocol the
  later writer wins silently, and the operator's work vanishes with no error.
- **Every duration comparison wants an epsilon.** This rule cost three separate
  bugs in the EDL work and the composition model carries `EPS` and `secs()` for
  it. Write the comparison as a named helper, export it, and use it in the
  tests as well as the module.
- **A new field on an item has to be carried through every helper that copies
  one.** `splitItem`, `moveItemToTrack`, `trimStart`, `trimEnd` and `moveItemTo`
  all build new items. A transform field that survives a drag but not a split
  is the kind of fault that reproduces only in the half nobody is looking at.
- **Preview and render must agree.** `compositor-agreement.test.js` is what
  stops the page lying about its output, and it is the reason the editor rewrite
  worked. Every model change in step 2 needs its agreement case or the
  guarantee quietly stops holding.
- **Per-item failure must not fail a batch.** Repeated because the previous
  stills implementation got this wrong.

---

## Provenance

Scoped 8 November 2026 from a read of the Produce section, the composition
editor code, `video-editor-review.md` (7 November), and an assessment of five
public repositories. Claims sourced from those repositories are attributed
above and marked where they are unverified; everything stated about OMI's own
code was checked against the files named.
