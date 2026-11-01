# Replacing basic editing

> **SUPERSEDED, 1 November 2026, a few hours after it was written.**
> This is the increment plan: each slice preserved what was underneath it so
> that something shipped each time. Daniel's answer to it was *"shall we focus
> on the end goal and not the next PR… I'm happy to not use it until we built
> that. You often focus on the task and not the goal."*
>
> **Read `editor-composition-model.md` instead.** It designs backwards from
> one editor rather than forwards from what was safe to ship, which makes the
> composition model, the render graph and the preview rewrites rather than
> extensions.
>
> What is still worth reading here: the nine jobs, the audited list of what the
> preview does not show (F1 to F9), and the faults recorded at the end. Those
> are findings. The slice order is not.

**Status:** direction agreed 1 November 2026, not started. Daniel's goal, in his
words: *"something that can replace basic editing."* The test:

> **An account manager never opens CapCut for a routine reel.**

That is narrower than "the best video editor" and deliberately so. CapCut has
fifty engineers and no interest in architecture practices. What OMI has that
they never will is the client's brand kit, their asset library, their own reel
performance history, and caption templates already carrying their colours. The
editor is worth building because it is wired into OMI, not because it is a
timeline.

A tighter version to measure against: **a finished, on-brand, client-ready reel
in twenty minutes without leaving OMI.**

---

## The nine jobs

Daniel's list of what an AM leaves the product to do, with what OMI does today.

| | Job | Today |
|---|---|---|
| 1 | Trim the top and the tail | Done. Drag the block edges, or arrow keys |
| 2 | Cut out the ums and the dead air | Done, in the Video wizard. Not on the timeline |
| 3 | Stack three clips in order | Done. Drag to reorder, split, delete |
| 4 | Put captions on, on brand | 31 templates, applied at render. **Nothing visible before** |
| 5 | Make it 9:16, or square | Done, but the preview and the render disagree (see F2) |
| 6 | Drop in a logo or a lower third | Text overlays only, and **never drawn in the preview** |
| 7 | Music under it, quieter where someone talks | **Nothing. No second audio source exists anywhere** |
| 8 | Cut away to a detail shot, voice carries on | **The engine exists and works. It is not on the timeline** |
| 9 | Fix a clip recorded quieter than the rest | Done 1 Nov. Per-block volume slider |

Everything in bold is this plan.

---

## Decisions already taken

**Transcription runs on demand, not on upload.** One press, "get the words".
The alternative was transcribing every clip as it arrived, which makes
everything downstream instant and sends every client's footage audio to OpenAI
by default. Today that only happens when someone ticks captions, and
`editProcessor.js:8` claims "no footage leaves October's box". Daniel chose to
keep the opt-in and pay 20 to 40 seconds a session for it.

**Consequence:** the clips still have to reach October's own server when they
are added, because a transcript cannot be taken from a file sitting in the
browser. That is not a privacy change — the footage goes to the box at render
time regardless — but it is the first slice of work, and most of the plan is
downstream of it.

**Whisper spend: fix the logging, decide the cap later.** The cost is recorded
in exactly one place, `editProcessor.js:838-840`. Four other call sites record
nothing: `socialCaptionRender.js`, `silenceCut.js`, `captions.js`, and the
b-roll proposal. There is no Whisper allowance in any migration, unlike
Pangram (`migrations/195_checker_samples.sql:51-60`). Make the real number
visible first, set a ceiling once there is a month of figures.

**Not building WebCodecs for frame accuracy.** The spec's section 2.2 rested on
the claim that a video element seeks to keyframes rather than frames. A probe on
31 October disproved it: 22 of 22 mid-GOP seeks exact, on a clean 30fps file and
on one at 29.97 with B-frames and a 2.5s keyframe interval. `currentTime` does a
precise seek; `fastSeek()` is the keyframe one, and nothing calls it.
`driftFrames` keeps the question open at runtime. WebCodecs may still earn its
keep for pixel-level work; it is not needed for this.

---

## What the preview does not show

Established by audit on 1 November, every item read in the code. This is the
list the "see it before you render" work has to close, worst first.

| | Gap | Evidence |
|---|---|---|
| F1 | **Text overlays are never drawn over the picture.** The operator sets x, y and size as fractions of the frame against a player that renders none of it. First sight of the real placement is the finished render | `EdlPlayer.jsx` contains zero occurrences of `overlay`; controls at `Timeline.jsx:673-772`; render burns ASS at `editProcessor.js:718-747` |
| F2 | **The render forces 30fps and the first clip's dimensions.** Every block is letterboxed into clip 1's shape, then the aspect crop is applied to that. The preview crops each original clip directly and takes its aspect from whichever element is active, so with aspect Original the preview changes shape at every cut while the render puts everything in one shape | `editProcessor.js:405-408`, `:425`, `:626-630` vs `EdlPlayer.jsx:478-479`, `:504`, `:526` |
| F3 | **Captions.** A template draws nothing at all; without one, a fixed "the quick brown fox" | `ClientEditPage.jsx:414-422`, gated at `:414` |
| F4 | **Clean audio is on by default and never previewed.** `afftdn=nf=-25,highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11`. So the default render's audio is never what was heard | `editProcessor.js:621-623`, default `ClientEditPage.jsx:75` |
| F5 | **Gain then loudnorm.** A per-block boost is partly re-normalised away by the whole-programme loudnorm. The preview applies the gain and no loudnorm | `editProcessor.js:429-431` then `:622` |
| F6 | A hard cut inside an otherwise faded edit becomes a one-frame fade at render; the preview draws a plain cut | `edl.mjs:536-546` |
| F7 | Overlay times are clamped against the EDL's computed duration in the browser and against the probed duration of the finished file at render. Any drift from the 30fps resample moves the window | `Timeline.jsx:119-120` vs `editProcessor.js:721-722` |
| F8 | Cross-fade audio is `acrossfade` at render and a linear two-element ramp in the preview. Different curves | `edl.mjs:546` vs `EdlPlayer.jsx:182-198` |
| F9 | `wipeleft` previews as a cut, with a note. Deliberate: the easing would be a guess | `edlPlay.mjs:36-50` |

---

## Captions: the route, and the one that is closed

**Closed.** Asking ffmpeg for a transparent caption layer to composite in the
browser. The `subtitles` filter writes libass output into the colour planes and
leaves alpha alone: over `color=black@0.0`, all 2,073,600 pixels came back at
alpha 0, measured across `rgba`, `yuva420p` and `yuva444p`. Recorded at
`captions.js:169-175`. This is closed by the renderer, not by effort.

**Open, and better than it looked.** `shared/captions/compile.mjs` has **no
imports and no requires**. It is a pure module. The browser can call `compile()`
and get the byte-identical ASS file the server generates. The faithful route is
libass itself compiled to WebAssembly (JASSUB or SubtitlesOctopus), fed that
same string and the same font files from `shared/captions/fonts`, drawn over the
`<video>`.

That reproduces by construction the six places libass diverges from a browser
text stack: FreeType hinting, the true outline stroker (outline values go to 14
on `institution`), `BorderStyle=3` box mode where the box follows the spoken
word, libass's own balanced line-breaking, the `\t` animation interpolation, and
the limited-range BT.709 composite. Re-implementing those in canvas text would
be approximation; running libass is not.

`compile.mjs:4-5` already claims it is "shared between the backend renderer and
the editor preview". Nothing under `frontend/src` imports it. Closing that gap
is the work.

**Two inert fields found while reading:** `wordSpacing` (on all 31 presets) and
`fontNameFallback` (all 31, `"IBM Plex Sans"`, with no such file in the fonts
directory) are read by nothing in `compile.mjs`.

---

## The hard part

**The render transcribes the edit, not the clips.** `editProcessor.js:652`
extracts audio from `base.mp4`, which is the output of trim, the EDL cut and
reorder, per-block gain, and clean audio. A transcript taken on demand from a
source clip has timings in that clip's own timebase. To drive captions on an
edited reel, every timing has to be mapped through the edit:

- a trim shifts everything by `start`
- an EDL cut and reorder is a piecewise-linear remap across blocks. The
  arithmetic exists (`edl.mjs:292-306`, `edlPlay.mjs:187`) and nothing applies
  it to word timings
- a cross-fade overlaps two blocks, so two source times map to one output time
  and a word can straddle the join
- a silence cut removes spans mid-sentence and renumbers timestamps, so the
  mapping is the keep-list
- several clips means several source timebases laid end to end

**This mapping is the largest new piece of logic in the plan, and it must live
in `shared/` and be used by both the browser preview and the renderer.** Two
implementations will drift, which is the exact failure `compile.mjs:4-7` says
the shared compiler exists to prevent.

**Second-order:** clean audio changes what Whisper hears. Today the transcript
comes from denoised, high-passed, loudness-normalised audio. On-demand
transcription takes it from the raw clip. Word boundaries and word choices can
differ. The repo already has this class of bug handled once:
`captions.js:330-333` transcribes the original upload rather than the
normalised copy, because the normalise drops audio entirely. Whichever side is
chosen, the preview and the render must use the same transcript.

---

## The plan, in order

Each slice is one PR, verified the way everything else in this repo is: guards
in CI, a browser drive for anything that is a placement or a visible state, and
mutation testing on the guards.

### Slice 1 · Clips reach the server when added
Everything else is downstream. Uploads on add rather than on render, which also
fixes the filmstrip and waveform wall and makes autosave possible (there is no
autosave and no undo today). The Edit page writes clips straight into the job's
`clips` JSONB (`routes/edit.js:159`) and does not index them into
`client_assets`, so there are two front doors and both need to work.

### Slice 2 · The words, on one press
A transcript column (a dedicated `transcript JSONB` plus a state column, not
inside `metadata`, which several producers write wholesale and would clobber).
A "get the words" button. Cost recorded at every Whisper call site. Derived
clips must **not** inherit a transcript: a tighten renumbers timestamps, so an
inherited transcript would be confidently wrong rather than absent.

**What comes alive for free:** six of the eight reel checks, which are
hard-coded to `timings={[]}` on both screens and can never currently be judged.
And Tighten stops paying Whisper again on every page reload, because the words
are held in browser memory today and thrown away.

### Slice 3 · The timeline-to-source mapping
The shared module described above. No visible feature. It is the thing both
following slices stand on, and doing it badly drifts the captions.

### Slice 4 · Captions you can see
`compile.mjs` imported in the browser, libass in WebAssembly over the `<video>`,
the real words, at the real position and size. Closes F3.

### Slice 5 · Overlays you can see, and a frame that matches
Draw the text overlays in the preview (F1). Make the preview letterbox and crop
the way the render does rather than the way it finds convenient (F2). Reconcile
the overlay clamp (F7).

### Slice 6 · Audio that sounds mixed
Per-block level matching so job 9 stops being a manual fix. Then a music bed
with ducking under speech, which needs a second audio source threaded through
seven places, none of which exist today: the EDL model, `cutEdl`, the job's
clips column, the route validator, `opsPayload`, the timeline's single lane, and
the preview's one-gain-node-per-element graph.

### Slice 7 · The b-roll lane
The render engine already does real video-over-video with the base audio carried
through (`brollRender.js:86-107`). It is reachable from Make a reel and the
asset library; `editProcessor` has **zero** references to it, and as built it
bakes the cutaway into a flat file that cannot be moved, retimed or removed.

Making it a timeline feature runs into something deliberate: `edl.mjs:15-19`
refuses a second video track on the grounds that "a second track drawn on a
surface that cannot render it would be the page lying about what it will
produce". That reasoning no longer holds, because the render evidently can. The
engine is free; the model and the lane are not.

**Held unless something demands it.** Slices 1 to 6 meet the twenty-minute test.

---

## Separate from this plan

Faults found during the audit, each verified, none of them this plan's job.

**Reels made in the editor record no check judgement.** `reelOutcomes.record` is
called from exactly one place, `socialCaptionRender.js:145`. `editProcessor` has
zero references to it. So the pool the reel rules learn from silently excludes
every reel an AM made in the editor, which is most of them. The number is not
wrong; it is drawn from the wrong population.

**Three controls that do nothing.**
- "Apply the client's kit" in the template picker switches the swatch image and
  never reaches `ops`. The render calls `kitFromAssets` unconditionally either
  way (`editProcessor.js:671-672`). Unticking it changes nothing about the
  output.
- Caption size and position are still sent as `ops.caption_style` when a
  template is chosen, and the template path never reads them.
- Dragging a block's right edge reads `clips[0]`'s duration rather than that
  block's own (`Timeline.jsx:212`). On clip two or later the drag is mis-scaled.

**Two more of the unreachable-capability shape**, the same as the gain fixed on
1 November: `ops.trim` and `ops.segments` are both honoured by the render and
set by no control.

**The length reel check disagrees with itself in three places.** It accepts
20 to 50 seconds (`reelChecks.mjs:32-33`), the label says "Thirty to
forty-five" (`:132`), the rule text says "Thirty to forty" (`:254`). A
22-second reel passes while the panel states a rule it is not applying. Which
number is right is Daniel's call.

**A dropped block silently turns every cross-fade into a hard cut.** `cutEdl`
uses the xfade graph only when every segment survived (`editProcessor.js:464`);
a source missing from disk drops one (`:411-412`) and the render falls through
to a plain concat with no warning and no note on the job.

**The plain-caption burn cannot be cancelled.** Every other ffmpeg call passes
`jobId` so Stop can kill it. That one passes only `cwd`
(`editProcessor.js:694-697`), so Stop kills nothing and the pass runs to
completion.

**`docs/omi/edit-studio.md` is stale**, describing a letterboxed `contain`
preview against a render that crops, and a page with no timeline.
`video-timeline-spec.md` is the current record.
