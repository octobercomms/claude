# Brief: Produce → Studio

> **This is a BRIEF, not a plan.** Where it disagrees with an implementation
> plan in `docs/omi/`, this file wins and the plan is wrong. A plan that
> departs from it has to say so in the plan, in writing, with Daniel's sign
> off. See `docs/omi/briefs/README.md`.
>
> **Source:** agreed with Daniel in conversation, mocked as an artifact
> (`https://claude.ai/artifact/Lhrwt3p8ziDJ9X5QkFfLy7`, titled "OMI Studio").
> Transcribed into the repo on 9 November 2026, after the build diverged from
> it. The artifact is the original; this file is the version sessions read.

## Why this file exists

The mockup was agreed, and then production shipped something else. Not
because anyone overruled it. Because it was never in the repository.

The trail: `video-batch-plan.md:207` cites "the OMI Studio mockup's Transform
panel" as the reason `scale`, `pos` and `rot` were added to the item model.
That is the only mention of the mockup anywhere in the tree. Whoever wrote
the plan had read it, lifted the parts that touched the data model, and left
the IA behind. Every later session read the plan, which by then was the brief,
and the plan says nothing about consolidation.

The nav rows it contradicted predate it (`7419e9ee`, 4 November) and nothing
asked for them to be revisited, so each new capability was added as another
row because the last one was a row. Six co-equal doors, arrived at additively,
none of it a decision.

Daniel, 9 November: *"it's my biggest bugbear about briefing projects, that
what is agreed in the briefing is completely changed for production. it is
almost like the briefing stage is not referenced at all."* He is right, and
the mechanism is this: **an agreed decision that lives outside the repository
is invisible to every session after the one that heard it.**

## What the mockup specifies

One screen. A four-panel editor, dark-first.

- **Top bar** — "OMI Studio", project name, save-state dot, Share, Export.
  Tabs acting as content libraries, not destinations: Media, Audio, Text,
  Effects, Transitions, Captions, Designs, Filters.
- **Left, 240px** — media bin. Search, type filters, Import and Record,
  2-column thumbnails with duration badges and an "already added" state,
  draggable onto the timeline.
- **Centre** — 9:16 player, burned-caption preview, transport with mono
  tabular timecode (current / total), prev / step back / play / step forward /
  next, Fit, Snapshot, Full screen.
- **Right, 260px** — inspector, in this order: Clip Properties (position,
  duration, in point, source), Transform (scale, position, rotation, opacity,
  fit Fill/Fit/Stretch), Audio (volume, fade in, fade out, duck), **AI Tools**
  (Transcribe clip, Tighten, Suggest B-roll, Add captions, Auto colour
  correct), **Reel Checks** as a pass/warn checklist.
- **Bottom** — timeline. Toolbar: undo, redo, split, delete, crop, ripple,
  snap, zoom, fit all. Track headers 52px with per-track visible/lock or
  mute/lock and a coloured kind indicator. Lanes T1 text, V1 to V3 video,
  D1 design, A1 audio. Filmstrips, waveforms, caption blocks. Red playhead
  with a triangular head. Resize handles both ends. Click a lane to seek.

**The consolidation it asks for:** audio, text, captions and designs become
tabs and panels inside one Studio, not separate nav destinations.

## How far the shipped build is from it

Audited 9 November against `dev/platform`. **Roughly 70% is built. Most of
the gap is that the pieces sit in the wrong boxes, not that they are absent.**

Already there and matching: player canvas, caption overlay preview (JASSUB,
the same ASS compiler the render uses), timecode, play and frame step,
filmstrips, waveforms, trim handles, snapping, cross-track drag, undo/redo,
ripple, minimap, transition hatching, keyboard reference, Export with a
flush-before-render, autosave, Transcribe, Tighten, Suggest B-roll, 31 caption
presets, duck, and Reel Checks.

In the wrong box: undo/redo/ripple sit in a right-hand card header rather than
a timeline toolbar; opacity, fit, in point and transition sit in the
timeline's selected-item strip rather than the inspector; the media bin
(`components/AssetLibrary.jsx`) is fully built and mounted at Produce →
Library, in the batch picker and in the reference panel, **but not in the
editor**; Transcribe, Tighten, B-roll and captions are four unlabelled cards
rather than one AI Tools group.

Model exists, UI does not: `scale` and `pos` are in the model and drawn by the
preview, with no controls.

Genuinely missing: text layer, filters, auto colour correct, Share, crop,
fades, per-track mute/lock, fixed T1/V1-V3/D1/A1 lanes, snapshot, full screen,
prev/next clip.

## Decisions

**Taken, 9 November:**

1. **Produce is regrouped, not collapsed.** Make = Studio, Record, Design,
   Visualise. Batch = Brief, Review. Media = Library, Transcribe, Audio.
   The editor row is named **Studio** and carries `slug: 'studio'`, with
   `keywords: ['video','edit','timeline']` so the palette still answers to the
   word an operator types.
2. **Nothing is deleted and no URL dies.** Every row keeps its `tab` key, so
   every `tab === 'x'` branch in `ClientVideoTab.jsx` is untouched and
   `/produce/compose` still resolves (`tabForSlug` matches the tab key as well
   as the slug; pinned by a test, because it was undocumented).

**Decided by Daniel, 9 November, after reading the audit.** He overruled the
argument in decision 4 below, and he is right to:

> "yes, they aren't all video editors, but you're thinking that the studio is
> a video editor. but naturally it has audio functions and transcribe
> functions. so lets just combine this option into one studio? if i want to
> record my screen, there is a record button in the studio that perhaps opens
> a modal? and the result sits in the studio projects folder. if i want to
> record audio, same thing. if i want to transcribe audio, same thing. it can
> all happen in a studio. Make disappears."

- **Produce collapses to Studio, Design, Library.** Make goes away. Record,
  Audio and Transcribe become actions inside the Studio, each opening a modal,
  with output landing in a Studio project.
- **Dark theme is wanted.** "dark theme is ideal". This supersedes decision 3
  below, which argued for a light palette with a dark canvas well. The
  question left is scope, not whether: a dark Studio only, or `data-theme`
  plus `prefers-color-scheme` across the app.
- **Batch is open**: its own section, or a route inside the Studio.
- **Visualise was not mentioned** and is not in his list of three. Unresolved.

What this collides with, being checked before anything is built: a read-only
client login sees Record and Library and nothing else, and `compose` is
`agencyOnly`, so folding Record into the Studio removes a client's only way to
record anything. `compose` is also `phone: false` while Record works on a
phone. Batch Review is deliberately phone-enabled, so a Batch route inside a
desktop-only Studio would end phone approval of a thirty-video run. And a
"Studio project" is a new entity: today the unit is a composition and assets
are per-client, so grouping recordings, transcripts, cleaned audio and
compositions under one project is a migration, unless a project turns out to
be a composition with its own asset scope.

**Decisions 3 and 4 below are superseded, and are kept because the reasoning
in them is still what the replacement has to answer.** Decisions 5 to 9 stand
until Daniel says otherwise.

3. **Dark-first is a fork of the design system.** SUPERSEDED, see above: he
   wants dark. The cost stands and is now a scoping question, not an argument.
    `index.css` is one light
   theme with no `prefers-color-scheme` and no `data-theme`. A dark Studio
   means a parallel palette plus dark variants of `.card`, `.btn`, `.chip-*`
   and `.input`. The house already settled this once: `.nav-chip` is the one
   dark-surface chip in the sheet, deliberately. Recommendation: keep the
   light palette, give the Studio a dark **canvas well** only. The player
   already paints `#000`, which is the part of the mockup's darkness that
   earns itself.
4. **Four of the six "doors" are not video editors.** SUPERSEDED, see above.
   The reframing that defeats it: the Studio is a production surface, not a
   video editor, and a surface that records, cleans audio and transcribes is
   the same surface that cuts. What survives of the original point is narrow
   and still true: Design is a 2,000-line canvas editor and does not belong
   inside another canvas editor, which is why Design stays a row in his own
   list of three.
   Original reasoning, kept because the replacement has to answer it: Record is a capture
   device, Design is a 2,000-line Fabric canvas, Visualise is image
   generation, Audio is denoise. Folding them behind a timeline would repeat
   the Create-inside-Create fault the nav file already records. The real fault
   was that the one row which IS the video editor was labelled "Video" and sat
   in a list of five equals. Decision 1 fixes that.
5. **Rotation is not buildable as drawn.** The render graph's output box is
   init-only, so an animated rotation needs a different construction, and the
   preview deliberately refuses to draw what the export cannot produce. Ship
   scale and position; say in the panel why rotation is absent.
6. **The mockup's Reel Checks are weaker than the shipped ones.** Four checks
   against eight; "under 90s" against the growth plan's 30 to 45; "hook under
   3s" against "lands inside one second"; and no equivalent of the rule that a
   check which could only pass by absence returns `null` rather than a tick.
   Keep `shared/reelChecks.mjs`. The one thing worth taking is the **9:16
   aspect check**, which is deterministic and cheap.
7. **Filters and Auto colour correct have no backend.** The three fx are
   overlays, not grades. Both are new ffmpeg work with a QC implication. Do
   not ship empty tabs.
8. **Fixed T1/V1-V3/D1/A1 lanes are a model change the mockup does not
   price.** `TRACK_KINDS` is `['video','audio']`; captions and designs are
   source kinds on video tracks. Fixed lanes mean new track kinds, renderer
   changes, a migration over stored `compositions.data`, revalidating the
   eight shipped templates, and regenerating the schema and the agent skill.
   Recommendation: colour the 52px header by kind (the colours exist in the
   minimap already) and defer the lanes until something needs them.
9. **Share implies an artefact that does not exist.** Export offers Download
   only. A share link is a tokenised page like `/coverage` and `/watch`, which
   is a backend story. Do not ship the button ahead of the thing.

## Build order

Chrome first, because all of it is moving JSX that already works, and none of
it touches the model, the renderer or ffmpeg.

| | What | Model risk |
|---|---|---|
| 1 | Studio in the nav (**done**, 9 November) | none |
| 2 | Studio top bar: name, save dot, Export, hero suppressed on this screen | none |
| 3 | Four-panel shell: 240 / 1fr / 260 with a full-width timeline row | none |
| 4 | Timeline toolbar: undo, redo, ripple, split, delete, zoom slider, snap toggle | none |
| 5 | One ordered inspector; delete the timeline's selected-item strip; **collapse the two volume sliders** (see below) | none |
| 6 | Media bin in the editor: `AssetLibrary` with `onPick` | none |
| 7 | Transform panel on scale and pos, with a preview-vs-render agreement test | model already holds it |
| 8+ | Drag from bin, fades, per-track mute, fixed lanes, text, filters | real, costed separately |

## Faults found while auditing, worth fixing in passing

- **Two volume sliders disagree.** `CompositionEditorPage.jsx:1067` is
  `max="4"`; `CompositionTimeline.jsx:731` is `max="2"` and clamps its
  displayed value with `Math.min(2, …)`. The model allows 0 to 4. So an item
  set to 3.5 in the inspector reads as 2 in the timeline, and touching that
  slider writes the clamped value. Step 5 collapses them to one control at the
  model's own bound.
- **Fit has two vocabularies**: "Fill frame"/"Letterbox" in the timeline,
  "Cover"/"Contain" for designs. Same two values. Step 5 picks one.
- **No 9:16 aspect check** in `reelChecks.mjs`, per decision 6.

## Corrected, so it is not repeated

The first audit of this reported that nothing deletes composition renders and
a fortnightly batch would fill the box. **That is out of date.**
`services/videoCleanup.js` has `RENDER_FILE = /^render-(\d+)-(\d+)\.mp4$/`,
sweeps `uploads/<client>/`, holds any render belonging to an unreviewed batch
item however old, and archives the matching library row by source. Migration
251 gave composition renders their own asset source. Closed 9 November.

The claim came from the body of `video-batch-plan.md`'s "Fix these first"
section rather than its status header, which says the item is done. A stale
paragraph above a correction is read before the correction.
