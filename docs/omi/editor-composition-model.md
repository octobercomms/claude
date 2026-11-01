# One editor: the composition model

> **PARKED, 1 November 2026, the same evening this was agreed. Nothing here
> is being built. Do not start step 1.**
>
> Asked to weigh the editor against Phase 3, the per-client GTM Brain, Daniel
> chose the GTM Brain. The editor is 25 to 35 sessions and the GTM Brain has
> been the stated remaining prize since the agent guide was written, so the
> two were competing for the same month and had never been put side by side.
>
> The design below is not withdrawn and nothing in it is known to be wrong.
> It is waiting. If it is picked up again, start at **Build order** and read
> **The mapping** first, which is still the part most likely to kill it.
>
> The practical consequence, from the deal below: Daniel uses CapCut for
> reels until this is built, and that is a cost he accepted knowingly.

**Status:** design, agreed 1 November 2026 and parked the same day. Supersedes
`editor-replaces-basic-editing.md`, which was an increment plan and is the
wrong plan.

## The deal

Daniel's words: *"I'm happy to say now that I'll use CapCut until we have built
this… So let's not make a half arsed version… I want an editor. One page. One
editor. That does it all. Not a version we can ship today."*

So:

- **The new editor is locked** behind a setting only Daniel turns on. There is
  no way to wander into it. The current Edit page keeps working, untouched, for
  as long as it takes.
- **Nothing is compromised to be demoable.** Pieces ship towards the model
  below, not towards something shippable this week.
- **Scope: one video editor.** It replaces both the wizard and the timeline.
  Design stays the image tool and feeds it graphics; a lower third is a Design
  page placed in time. One brand kit, one type system, one library, two pages.
  Canva and CapCut are separate products from the same company for this reason.
- **Estimate: 25 to 35 sessions.** A rewrite's last fifth reliably takes longer
  than its first four fifths, so the top of that range is the likely one.

---

## Why the current model cannot get there

`shared/edl.mjs` is a list of blocks laid end to end. Four properties block
the end state, and all four are load-bearing:

1. **A block's position is derived, not stated.** `laidOut` (`edl.mjs:292-306`)
   accumulates a running total. There is no way to say "this thing is at 7.4
   seconds". Layers need exactly that.
2. **Two position languages already disagree.** Blocks pin to sequence;
   overlays pin to time (`overlays.mjs:96-99`, which calls this out as a
   deliberate choice to revisit). So reordering the timeline moves the footage
   under an overlay.
3. **A second video track is refused on purpose** (`edl.mjs:15-19`): "a second
   track drawn on a surface that cannot render it would be the page lying about
   what it will produce." The render can, as `brollRender.js:86-107` proves.
   The refusal is wired into the model, the timeline and the player.
4. **The frame is inherited, not chosen.** `cutEdl` letterboxes every block
   into the first clip on disk (`editProcessor.js:405-408`), then `render()`
   crops that (`:626-630`), and `fps=30` is forced on everything
   (`:425`). The preview does none of this, which is fidelity fault F2.

---

## The model

```
Composition {
  version: 1
  size:   { width, height }     // CHOSEN. Not inherited from clip 1
  fps                           // CHOSEN and shown. Not silently forced to 30
  sources: { [id]: Source }
  tracks:  [Track]              // index 0 is the base; higher composite over
}

Track {
  id
  kind:  'video' | 'audio'
  items: [Item]                 // ordered by `at`
}

Item {
  id
  at                            // ABSOLUTE seconds on the timeline
  len                           // duration on the timeline
  source                        // a Source id
  in?                           // offset into the source (clip and audio)
  fit?:     'cover' | 'contain' // how it fills the frame
  gain?                         // audio multiplier, 0..4
  opacity?                      // graphics
  trans?:   { type }            // the transition INTO this item; see below
}

Source =
  | { kind: 'clip',     asset, url, duration, width, height, fps }
  | { kind: 'design',   project, page, alpha: true }   // a Design page
  | { kind: 'audio',    asset, url, duration }
  | { kind: 'captions', transcript, template, marginV }
```

### The decisions inside that, and why

**`at` is absolute.** The single most important change. It makes layers
possible, makes blocks and graphics speak one language, and makes the
source-to-timeline mapping expressible as a lookup rather than a sum.

**A transition's duration is the overlap, not a number beside it.** Two items
on one track whose ranges overlap *are* a cross-fade; `trans.type` says which
kind. That deletes `maxTransitionAt`, the clamping machinery, and the
"a hard cut inside a faded edit becomes a one-frame fade" fault
(`edl.mjs:536-546`) in one move, because the model can no longer express a
transition longer than the material it has.

**Captions are a source, not a burn step.** A caption source references a
transcript and a template. That is what lets one description drive both the
browser compositor and the renderer, and it means changing template costs
nothing because the transcript is not re-derived.

**Graphics are a source with alpha.** A Design page. The video editor never
grows a type system, a colour picker or a layer panel, because Design has
those. The editor's job is time.

**Music is a track, not a special case.** `kind: 'audio'`. Ducking is a
property of one audio track relative to another, not a filter bolted to the
end.

**The frame and the rate are chosen and shown.** Fixes F2 by construction
rather than by making the preview imitate a quirk.

---

## The mapping, which is where this project dies if it is going to

A transcript taken from a source clip has timings in that clip's timebase. The
render transcribes the *edit* today (`editProcessor.js:652` pulls audio from
`base.mp4`, after trim, cut, gain and clean audio), so captions currently get
the right times by accident of ordering. On-demand transcription breaks that.

With absolute `at` and `in`, the mapping is a lookup rather than a sum:

```
sourceToTimeline(comp, sourceId, t):
  for each item where item.source === sourceId and item.in <= t < item.in + item.len:
    yield item.at + (t - item.in)
```

Three cases have to be decided, not discovered:

- **A word in a region that was cut out** maps to nothing. It is not in the
  reel and must not be captioned.
- **A word inside an overlap** maps to two timeline times. The rule: it belongs
  to whichever item is uppermost at that moment. Stated, so both sides agree.
- **A word straddling a cut** belongs to the item its midpoint falls in. Any
  other rule puts half a word on screen.

**This module lives in `shared/`, and the browser compositor and the renderer
both call it.** Two implementations drift, which is the exact failure
`compile.mjs:4-7` says the shared compiler exists to prevent — and which
`compile.mjs` itself currently suffers from, because the frontend does not
import it at all.

---

## The preview

One compositor, not three approximations layered in DOM. Per frame, in order:

1. the base video track's element, drawn to canvas
2. higher video tracks, composited in track order
3. graphics sources: Design pages rendered to images with alpha
4. captions: `compile.mjs` imported **in the browser** to produce the same ASS
   string the server produces, rendered by libass compiled to WebAssembly
   (JASSUB or SubtitlesOctopus)
5. guides: safe areas, which remain preview-only and say so

Captions via libass rather than canvas text because the divergences are
load-bearing: FreeType hinting (the repo already hit this —
`captions.js:299-301` burns the gallery at full size and scales down because
"libass would otherwise hint the type at 540 wide and the example would show a
weight the real render never produces"), the true outline stroker (outline
values reach 14 on `institution`), `BorderStyle=3` where the box follows the
spoken word, libass's own balanced line-breaking, and the limited-range BT.709
composite. Running libass reproduces all of it by construction. Canvas text
approximates it.

**What the preview still cannot show, and must say:** encoding artefacts, and
`afftdn`/`loudnorm` on the audio. Everything else is the same description
drawn twice.

---

## The render

Today: five sequential full encodes — cut, concat, trim and clean, burn
captions, burn overlays. `editProcessor.js:709-713` admits the cost in its own
comment.

End state: **one `filter_complex` graph, one encode.**

- each item: `trim` + `setpts` to place it at `at`, `scale`/`crop` per `fit`
- video tracks: `overlay` in track order
- overlaps: `xfade` where two items on one track overlap
- audio: per-item `volume`, tracks mixed with `amix`, ducking with
  `sidechaincompress` keyed on the speech track
- captions: one `subtitles` filter from the same ASS string

Correct architecture and a large speed-up, from the same change.

---

## Build order

By dependency and by risk, not by what demos. The two pieces most likely to
kill the project are both invisible, so they go first.

| | What | Visible? | Why here |
|---|---|---|---|
| 1 | The composition model and the mapping, in `shared/`, with unit tests and mutation testing | No | Everything reads it. Wrong here means everything after is wasted |
| 2 | The render graph against the new model | No | "The renderer cannot do that" is the other way this dies. Find out before building a UI for it |
| 3 | The compositor, proved to agree with the renderer on fixtures | Yes, locked | The agreement is the product. Prove it on fixtures before trusting it |
| 4 | The timeline UI, with tracks | Yes, locked | Only worth building once 1 to 3 hold |
| 5 | Clips upload on add; transcript on one press; captions from the real words | Yes, locked | Brings six dead reel checks alive as a side effect |
| 6 | Design pages as graphics in time | Yes, locked | Closes "drop in a logo or a lower third" without a second type system |
| 7 | Audio: level matching, music bed, ducking under speech | Yes, locked | Needs the audio track from step 1 |
| 8 | Fold Tighten and B-roll in. Delete the wizard. Unlock | Yes | Both live in the wizard today and the timeline cannot reach either |

Steps 1 and 2 are where the six weeks is won or lost.

## The lock

A setting, off by default, that only Daniel turns on. The route exists; the nav
row does not appear; a direct URL without the setting lands on the current
editor. Guarded in CI, because a lock that quietly stops working is worse than
no lock: anyone could be editing a client reel in a half-built tool.

## What gets deleted at the end

The wizard (`MakeAReel.jsx`), the single-track EDL, the five-pass render, the
caption placeholder, the safe-zone clamp that the render has no knowledge of,
and `editor-replaces-basic-editing.md`.

Nothing is deleted before step 8. The current editor works the whole way
through.
