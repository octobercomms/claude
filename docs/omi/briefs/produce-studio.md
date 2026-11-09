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
- **Dark theme: asked for, then withdrawn, same day.** "dark theme is ideal",
  then, once the rail-against-panel contrast problem was put to him, "lets
  keep light theme then". **The app stays light.** No dark token block, no
  `data-theme`, no scoped dark Studio. The player well stays black because it
  already is and because a video preview belongs on black.
  Both halves are recorded on purpose. A brief that keeps only the final
  answer loses why it was reached, and the next session proposing a dark theme
  should find the reason it was dropped rather than the fact that it was.
- **Batch is open**: its own section, or a route inside the Studio.
- **Visualise was not mentioned** and is not in his list of three. Unresolved.

**Decided, second round, same day.** He answered the four collisions:

- **"read only clients dont see Produce - good point. and they dont need it."**
  So Produce becomes agency-only outright, rather than Record surviving as a
  client row. That is one line in the rail (`Layout.jsx:274`, the way
  Dashboard is already conditional) plus a guard on the typed URL, because a
  client typing `/produce/studio` would otherwise reach a branch that renders
  nothing: `useScreen`'s `setTab` returns early when a tab has no row
  (`hooks/useScreen.js:32`), so the existing read-only fallback is silent.
- **"phone - lets not have it on phone. its a desktop application. we can hide
  produce on a phone."** Accepted, and the cost is small: `RecordingsPage`
  captures with `getDisplayMedia`, which is not a phone capability, so phone
  capture for the agency was incidental rather than designed.
- **"batch - desktop only."** So Batch stays its own rows and both go
  `phone: false`. I flagged that this gives up phone approval of a batch,
  which `VideoBatchReviewPage` was built for and argues for in its own header.
  His answer: **"tbh, i build everything on desktop - im not going to do that
  much work on a phone."** So the capability was never used and the phone
  argument in that file is obsolete. **OMI is a desktop application.** That is
  the wider decision, and it settles the phone question for Produce rather
  than only for Batch: `VideoBatchReviewPage`'s phone branch and its
  `useIsPhone` become dead weight to remove, not a constraint to protect.
- **"ok, keep calling it Library."** No rename. Library grows tabs (Assets,
  Transcripts, Audio) and keeps its name. A project already exists as a
  `compositions` row; the thing stopping "the result sits in the projects
  folder" from being true is two missing function calls, below, not a label.

**Open, and cheap for him to answer:** `can_use_visualise` is a per-user grant
whose only purpose is to let a CLIENT into Visualise. If Produce is
agency-only, the grant does nothing. Either it is deleted, or Visualise needs
a home a client can reach.

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

3. **Dark-first is a fork of the design system.** WITHDRAWN by Daniel, 9
   November: "lets keep light theme then." The app stays light. The cost
   estimate in the original was wrong by about an order of magnitude and is
   corrected below anyway, because a wrong number left in a file gets reused. `.card` (`index.css:289`),
   `.chip` (`:611`) and `.input/.select/.textarea` (`:1470`) are pure token
   consumers: `var(--surface)`, `var(--text)`, `var(--card-border)` and
   nothing else. Custom properties inherit, so redeclaring the tokens on a
   wrapper gets all three with no new rules. A scoped dark Studio is one token
   block of about eighteen declarations plus about twelve shared fixes where a
   literal `#fff` is used as ink on a dark fill (`.btn-primary:hover`,
   `.card.filled`, `.tab.active` and a few more), and those fixes improve the
   light theme too, since they are currently correct only because `--text`
   happens to be dark. Do the Studio first: the token block it produces is
   exactly what a whole-app `data-theme` needs later, so it is a step rather
   than a detour.
   One real unknown, not solved by tokens: `index.css:28-35` records that the
   rail at `#000` against the panel at `#222` is 1.32:1, and that the divider
   is what draws the edge. Put a dark page behind both and they stop
   separating. That is a design decision and should not be found late.
   Original reasoning, kept because it is what the replacement answers:
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
9. **Share implies an artefact that does not exist.** **WRONG ON THE FACTS,
   corrected 9 November.** The artefact is shipped. `migrations/027_video_audio_approval.sql`
   creates `approval_links` (opaque token, client, `scope VARCHAR(20)`, expiry)
   and `approval_responses` (per-item decision, comment, reviewer name), and
   `routes/approvals.js` is a live token-gated client view with per-item
   approve, request-changes and comment, plus a public file proxy at `:29`
   that already streams uploaded media to a logged-out client. It carries
   social posts and ad creatives today. `scope` is a VARCHAR with a comment
   listing its three values, not an enum, so a composition is a new string,
   one query branch and a nullable column. **Not a backend story.**
   I withheld a feature on a cost estimate that was wrong, which is precisely
   the failure the ux-critic definition was written to prevent, committed in
   the same document that defines it. Recorded rather than quietly fixed.
   The design argument on top of the correction: for an agency, Share is what
   separates a production surface from a toy. The Batch half already ends
   somewhere ("Nothing leaves for Drive or Instagram until you do"); the
   Studio half ends in `~/Downloads`. Two halves of one product disagreeing
   about what finished means is the consistency fault that matters most here,
   and decision 9 made it permanent by rule.

## The project model, and what is actually missing

A "Studio project" needs no new table. `migrations/236_compositions.sql` gives
each composition `client_id`, `title`, `data` (the whole composition including
`data.sources`), **`source_assets`** (sourceId to `client_assets.id`, which is
the project's file list) and **`transcripts`** (sourceId to a word array).
Migration 249 added `batch_id` and `template_id`. The projects folder is
`data.sources` joined to `source_assets`, which is what a media bin renders.
A recording made in the Studio already becomes a source, through
`POST /compose/clients/:id/compositions/from-recording`, which
`RecordingsPage.jsx:516-526` already calls.

**What is missing is two function calls, and it is the reason his sentence is
currently false.** `assets.record` is called in exactly one place in the
backend, `routes/recordings.js:150`. `routes/audio.js` and
`routes/transcripts.js` never call it. So **a cleaned audio file and a
transcript appear in no library at all today.** "The result sits in the studio
projects folder" holds for recordings and for neither of the other two.

The fix is the three-places rule: the `client_assets` source CHECK constraint
(pattern in `migrations/251_composition_asset_source.sql`), `SOURCES` in
`services/assets.js`, and `SOURCE_LABEL` in `components/AssetLibrary.jsx`. Two
new sources, two calls, one migration, about forty lines. `assets.record` is
written never to throw at its caller, so a library write cannot lose a job.

A nullable `composition_id` on `transcripts` and `audio_cleanups` is the next
tier, and only worth it when a standalone transcript needs to find its
project. Both tables already have a nullable `client_id` for the standalone
case (migrations 171 and 231).

**The rename is off.** "ok, keep calling it Library." It grows tabs (Assets,
Transcripts, Audio) and keeps the name, which is the right outcome anyway:
Library lists every asset for a client rather than projects, so Projects would
have been a label that lies.

**Transcribe is the one modal that does not work.** `AudioPage` is
record-or-upload, one job, one result, which is modal-shaped. `TranscribePage`
is a list-detail whose detail is a speaker-naming form, one input per detected
voice with a sample quote, then a segment reader with copy, download and edit.
The house rule is written down at `nav/sections.js:517-521`: "anything you
would deep link to, or spend more than a minute inside, is a page." So the
*job start* is a Studio modal and the *reading surface* lives in Library's
Transcripts tab. His sentence stays true and the rule is kept.

## Build order

Chrome first, because all of it is moving JSX that already works, and none of
it touches the model, the renderer or ffmpeg.

| | What | Model risk |
|---|---|---|
| 1 | Studio in the nav (9 November). **Was declared done and was not:**
`/produce/<any-unknown-slug>` rendered the editor with Studio lit in the
panel, and `/produce/review` — nearly the slug of a real screen — did the
same. `useScreen` now corrects the address bar to the canonical slug, which
fixes it for all nine sections rather than only Produce, since nothing ever
used the `screenSlugs` guard it exports. Pinned by five drive assertions,
one of which is a real slug that must be left alone. | none |
| 2 | Studio top bar: name, save dot, Export, hero suppressed on this screen | none |
| 3 | Four-panel shell: 240 / 1fr / 260 with a full-width timeline row | none |
| 4 | Timeline toolbar: undo, redo, ripple, split, delete, zoom slider, snap toggle | none |
| 5 | One ordered inspector; delete the timeline's selected-item strip; **collapse the two volume sliders** (see below) | none |
| 6 | Media bin in the editor: `AssetLibrary` with `onPick` | none |
| 7 | Transform panel on scale and pos, with a preview-vs-render agreement test | model already holds it |
| 8+ | Drag from bin, fades, per-track mute, fixed lanes, text, filters | real, costed separately |

## The design critique, 9 November

Commissioned after Daniel asked whether the UX agent had ideas or had only
reported that things were fine. It ran the app rather than reading the plan.
What it found, with the claims I verified myself marked:

**The shape is wrong at the front door. VERIFIED.** Eight templates already
ship (`shared/templates/*.json`), one of which describes itself as "six to
eight photographs carried by deterministic camera moves, two to four short
phrase titles and a music bed" — word for word the job the Studio is being
built for. The engine that does volume already exists. The Studio's job is
the one the template got wrong, and the build order spends seven of nine
steps making the exception path look more like Premiere.
`VideoBatchReviewPage.jsx:150` carries the agency's real unit of work in a
comment: "Approve, reject, and move. Ninety clicks otherwise." On that same
screen "Open in the editor" is already `btn-ghost`, the lowest emphasis in
the system, beside a primary Approve. The code knew.

**Six photographs cannot enter the Studio at all. VERIFIED, and this is the
largest finding.** `CompositionEditorPage.jsx:910` is `accept="video/*"` and
`:299` filters to `video/`, answering "Choose video files." Meanwhile
`composition.mjs:73` has `src.still` with the `-loop 1` and no-audio-stream
handling the render needs, `compositionPlayback.mjs` previews stills,
`composition.mjs` says in a comment that a camera move over a still IS an
animated scale and pos, and `VideoBatchPage.jsx:70` emits a photograph as
`{ kind: 'clip', asset: a.id }`. **The model, the renderer, the preview and
the batch all do photographs. One `accept` attribute and one `.filter()`
refuse them.** Nine build steps and not one of them was "you can put a
photograph in a reel".

**Every clip on the timeline is labelled with a database row id. VERIFIED.**
`CompositionTimeline.jsx:578` renders `src.asset || item.source`, and
`src.asset` is an integer. A lane reads `V1 | 11 | 12`. The human name is
computed into `sourceNames` at `CompositionEditorPage.jsx:206` and spent in
exactly one place, the inspector heading at `:976`. The timeline takes twelve
props and `sourceNames` is not one of them.

**Two volume sliders, two scales and two unit systems, both on screen.
VERIFIED.** Inspector `max="4"` reading `1.0`; timeline `max="2"` clamped
with `Math.min(2, ...)` reading `100%`. Same number, 25px of scroll apart.

**The 9:16 problem, which nobody had said out loud.** At 1600px the player
well is about 865px wide and a 1080x1920 composition occupies about 388px of
it, so roughly 70% of the largest element on the page is empty black. The
mockup's answer is a 240px bin and a 260px inspector, which narrows the
centre column and makes the only thing being judged smaller. A four-panel
layout is a landscape layout, which is what Premiere looks like because
Premiere assumes 16:9. October's output is vertical.

**Reel checks is in the wrong place.** Eight named checks, each carrying the
evidence that produced it, with a `null` state for checks that could only
pass by absence and a written admission that the thresholds are reasoned
assumptions. It is the most honest component in Produce and it sits at the
bottom of a scrolling column under the frame-rate chips. It answers "is this
good", which is the operator's actual question, and it is not in the build
order at all.

**The transcript as the edit surface.** For the talking half of October's
video the transcript is the edit: click a word to seek, select a phrase to
cut. `TightenPanel` and `BrollPanel` already operate on the transcript and
are currently two unlabelled cards in a scroll. The operator is an account
manager who thinks in sentences, not an editor who thinks in frames.

**And the sentence that was the whole problem**, from this brief's own build
order: "Chrome first, because all of it is moving JSX that already works."
That is an engineering sequence wearing a design hat. Reordered by what the
operator hits first: the bin, stills, the caption picker, Reel checks'
position, then the chrome.

Not everything was criticism, and this matters because rubber-stamping in
either direction is the same failure: the shipped Reel checks are better than
the mockup's four, the Batch Brief screen is better than anything in the
mockup, and Review is the best-designed page in Produce. Numbered steps, a
pre-flight sentence from the planner, per-item problems inline, a cost chip on
the button that commits the spend, and j/k/a/r on the rail.

## Built, 9 November: a photograph can enter the Studio

The largest finding is closed. `accept` comes from one shared list,
`isStillMime` gates the upload on both sides of the wire, a photograph becomes
a `still: true` clip source, and the six camera moves are chips on the
inspector.

Four things worth recording because they were found by building it rather
than by reading it:

**The model draws a line between absent and zero, and the first version of
this change got it wrong.** A clip source carrying `duration: 0` is rejected
outright ("clip duration must be positive"), and a photograph has no duration,
so the field is omitted. The first attempt wrote 0 and produced an invalid
composition; `composition-still.test.js` caught it before it ran anywhere. The
same guard now covers footage whose probe came back empty, which the old
`duration: clip.duration || 0` would also have written as 0.

**A photograph holds for 3.2 seconds, and the number is not new.**
`stills-montage` gives its photographs 2.6s to 3.8s; 3.2 is the middle of that
range, exported as `STILL_DEFAULT_LEN` so the editor and the batch cannot
drift. A test asserts it stays inside the template's own range.

**Turning a move off has to clear what the move set.** A chip that cleared
only the name would leave a `scale` and `pos` the inspector reports as off and
the render still performs. Pinned.

**The pixel test accused the renderer of a bug it did not have, and that is
worth keeping in the record.** `rise` measured 3.55 against `drift`'s 28.8 at
the same magnitude, with a held photograph at 3.6, which read as vertical
motion not rendering at all. The graphs were correct. The test picture was
`testsrc2`, which is built from broad horizontal bands, so a vertical move
slides within one band and changes almost nothing. On a 6px checkerboard a
held photograph measures exactly **0.000** and every move measures 54 to 76.
The lesson is the one this project keeps relearning: a fixture that does not
match reality hides the thing you are testing, and here it invented a fault
instead.

The same test deliberately does **not** assert that the moves rank in the
order their descriptions imply. An earlier version required `subtle` to
measure smallest, because its tooltip says it barely moves. On a checkerboard
it measures largest, since a small scale change on a high-frequency pattern
moves every pixel across an edge. The ranking is a property of the picture,
not the move, and that assertion was testing my own prose.

## Built, 9 November: Share

Decision 9 was wrong on the facts and the correction is above. What shipped:

**A link carries renders, not compositions.** A composition keeps being
edited; a render is the file that was made. Share the composition and the
thing a client approved on Tuesday is not the thing they see on Thursday, with
nothing recording the difference. `composition_renders` rows are immutable
once done, so a link means "these files", for good. The dialog lists exports
by time, so a stale one is visible before it is sent.

**Migration 252 is two columns.** `approval_links.render_ids INTEGER[]` and
`approval_responses.composition_render_id`. `post_ids` could not be reused:
it is `UUID[]` and composition ids are `SERIAL`. The `scope` column has no
CHECK, so `render_list` needed no constraint change, and a test asserts that
is still true.

**No new file route.** The existing public proxy serves `uploads/<client>/…`
to a logged-out reviewer, gated on the token, which is exactly where
`compositionRenderRunner` writes `render-<comp>-<render>.mp4`.

**The two bindings are the dangerous part, not the new part.** The route's own
comments already record the fault it is built around: anyone holding a public
token could record a decision against any row by supplying its id. For a post
that id is a UUID. For a render it is a small integer, so guessing the one
next door is not a feat, which makes the binding more important here rather
than less. So: the public respond route refuses a render that is not on the
link, and the minting route refuses renders that are not this client's and
are not finished. `requireClientAccess` checks the client in the path and says
nothing about ids in the body, so that second check is the only place the
tenancy of a shared render is established.

**Share deliberately does not flush the autosave.** Export must, or it
encodes the previous cut and reports success. Share must not: the link carries
files that already exist, and flushing would imply the unsaved edit is part of
what the client will see. Both halves are pinned, because tidying the two
buttons into one handler would reverse it.

## Built, 9 November: the verdict sits beside the picture

Reel checks moves from the last card of the right-hand column, below the
frame-rate chips and collapsed, to the frame's right elbow, open. It is the
one thing on screen that answers "is this any good", which is the operator's
actual question, and it was the furthest thing from the picture.

Beside rather than under, for a specific reason: the composition is 9:16 and
the player well is not. Measured in the browser at 1600px, the well is 865px
wide and the frame occupies 281px of it, so most of the largest element on the
page is empty black. The checks go into that space and the picture loses
nothing. The mockup's answer, a 240px bin and a 260px inspector, would narrow
the centre column and make the only thing being judged smaller.

**A regression that only a measurement would have found.** Opened, the eight
checks and their evidence measured 964px against the player's 500. A grid row
is as tall as its tallest cell, so the timeline was pushed 460px down and off
a 1000px screen. The panel is now capped to the player's own height and
scrolls. Mutation-checked: removing the cap puts the timeline at y=1304.

**The drives can finally see the editor.** Until now the stub had no
`/api/compose/*` fixtures, so the editor rendered its empty state in every
drive and nothing about it could be checked in a browser — the design critique
had to intercept those calls in a script of its own. `drives/fixtures/` now
carries a validated composition with a filmed clip, two photographs with
camera moves, a music bed and a transcript, and `drive-fixtures.test.js` runs
it through the real model so it cannot drift.

The first version of that fixture was wrong in a way worth recording: the
composition LIST returned thin rows, because that is what a list endpoint
looks like it should return. `services/compositions.js` selects the whole row
including `data`, and the editor opens `list[0]` without a second fetch, so
every assertion about the editor passed against an empty composition.

## The design review before items 4 and 5, 9 November

Run under `.claude/agents/ux-critic.md` for the first time, against the
running app at four widths. It changed the plan, and three of its findings
are corrections to things recorded earlier in this file.

**The media bin as scoped would have broken the screen.** At 1440px, a normal
laptop, the stage's player cell is 284px. Insert the mockup's 240px bin beside
it and the player cell becomes **28px**; at 1600 it becomes 124px. A bin
beside the stage is survivable only at 1920 and wider. So "the small version
first" was not a cheap first step but a regression that destroys the only
thing on screen being judged.

**It retracted its own three-zone design, and said why.** That design put the
transcript in the centre column. In a 9:16 product the centre column is the
*narrowest* part of the page, and a transcript four words wide is not an edit
surface. Its words: it imported Premiere's landscape assumption, which is the
fault it had accused the mockup of. `.studio-stage` as shipped — frame plus
verdict — is better than its three zones and should stay.

**What it proposes instead:** one full-width strip between the transport and
the timeline, 600px at 1440 rather than 240, next to the timeline where the
material is going, with two states (Material, and later Transcript). It pays
for its 130px of vertical with the hero that build-order step 2 already
removes.

**And the finding that reorders everything: there is no way at all to put
material OMI already owns into the Studio.** Not an awkward path. None.
`+ Add clip` reads local disk, `+ Add design` takes design pages, the b-roll
picker fills planned cutaway slots. So the agreed sentence about recording
and the result landing in the project was false twice over, and the second
half is the one that mattered.

### Two corrections to this file

- Asset ids are **UUIDs** (`migrations/212_client_assets.sql:23`), so an
  unnamed timeline block renders truncated hex rather than the integer
  recorded earlier. The integer was `composition_renders`, which is SERIAL.
- The timeline has **three** controls today (Fit, −, +), not eight. The
  eight-button toolbar exists only in build-order step 4, so cutting it is
  cutting a plan.

## Built, 9 November: the three things ranked above the bin

**Names on the timeline.** `sourceNames` was computed at load and spent in one
place, the inspector heading, so the clip you had selected was named and the
block you were looking at was not. One prop. A lane now reads
`atlas-walkthrough.mp4 · showroom-01.jpg · showroom-02.jpg`, verified in a
browser.

**The black player, which was the precondition for the bin.**
`compositions.fromRecording` writes `asset: <id>` and no url, because a
recording lives behind `mediaStore` under a storage key. `loadFromRow` filled
`sourceUrls` only from `src.url`. So "Send to Edit" on the Record tab opened a
correct timeline over a black player while the render was fine — the renderer
has resolved by asset id through `assetMedia` since the same fault was found
on its side.

`GET /api/assets/:id/file` is the browser's half: behind `assetAccess`, inline
rather than an attachment, `nosniff`, and it honours a Range header so a
`<video>` can seek. An uploaded asset redirects to the path it already has
rather than adding a second way of serving the uploads tree. **Every future
way into a composition reproduced this fault without it**, because anything
picked from a library is an id, not a path.

**The save state.** 12px grey, and "Save failed" rendered in exactly the same
size, weight and colour as "Saved": you had to read the DOM to tell which. Now
failure is the only one that shouts, says what it means for your work ("only
in this tab") and offers a retry. The other three stay quiet on purpose,
because a tool that congratulates itself every 1500ms trains you to stop
reading the one message that matters.

## Built, 9 November: the shelf

Where material enters the Studio. Before it there was no way to put anything
OMI already owns into a composition.

**Full width, below the timeline.** The review's measurement killed the bin
beside the stage: at 1440x900 the player cell is 284px, and a 240px bin beside
it leaves the player 28px. The shelf is 600px across the bottom instead. It
also sits BELOW the timeline rather than above it, which departs from the
review and is the better answer for a measured reason: above, it pushed the
timeline to y=1018 on a 900px screen; below, the timeline is at **831** —
better than the 931 the review measured before any of this, because removing
the hero on this screen bought back 102px. The timeline is where you work
continuously, the shelf is where you go deliberately.

**The player was not shrunk to make room.** Measured at three stage heights:
fitting the timeline that way takes the player to 182px wide, narrower than a
phone shows it, which is the trade the review said not to make.

**Two scopes, the reel first.** "In this reel" is the composition's own
sources, already in memory, and it is the default because it is the only
surface that makes a project's contents visible — it gives back a clip you
already trimmed, and it is where a recording made here lands. "All footage" is
`AssetLibrary` with two new props: `filters` false drops the kind chips and
source select, which cost about 110px of a 130px strip, and `layout` strip
makes one horizontal row rather than a grid that hides itself.

**A count badge, not a disabled state.** Reusing a clip for b-roll is normal,
and a picker that silently no-ops on an already-added item reads as a broken
click.

**Click, not drag, and everything lands at the END of its track.** That is the
rule the upload already uses, so the shelf introduces no second rule. The
playhead sits at 0 until somebody moves it, so "at the playhead" would mean
"insert at the start", and dropping onto an occupied range raises
insert-or-overwrite, which this editor has no answer for. Three things make it
feel like placing rather than a database write: the new item is selected, so a
camera move is one more click; the toast names it; and it says the timecode it
landed on.

**One door for files.** `+ Add clip` and `+ Add music` are gone from the
inspector. Two buttons for one gesture is the two-doors problem, and the clip
one was the only yellow button on the screen while it opened an OS file dialog
with this client's media one panel away. "Add files" routes by mime, because
`isStillMime` and `CLIP_ACCEPT` already decide that everywhere else.
`+ Add design` stays: a design is not a file, it is a page of a set this
client already has, so it is a picker rather than an upload.

**A bug worth recording.** The new file router was declared below the handler
that calls it. In JavaScript that is a temporal dead zone, which renders a
blank page rather than failing a lint rule. The browser check caught it in
seconds; no unit test would have.

## Built, 9 November: the cuts

Five removals, each one a control that cost permanent screen space for a
decision nobody makes.

| Cut | Why |
|---|---|
| **Save now** | Autosave is 1500ms, Export flushes before it renders, and the state is displayed. Three affordances for one fact, and this was the one that did nothing the other two did not |
| **Export resolution** | Four presets, three of them LANDSCAPE, for a product whose every template is 1080x1920. Offering a reel an export at 1920x1080 is offering to ruin it |
| **Export quality** | An agency sending client work exports at High every time. Medium and Low exist to make a worse file. The size estimate stays, as a statement rather than the consequence of a decision |
| **Frame size and rate chips** | Seven chips permanently on screen for two values nobody changes mid-edit. Now a line reading `1080 x 1920 · 30fps` with the chips one click away under Change |
| **The "Editor" card title** | It named the screen you were already on, in an app whose nav row for it is lit |

Removing Save now also fixed something measured: the header row ran from
x=1086 to x=1498 inside a card ending at 1400, so it sat 58px outside a 1440
viewport. It now ends at 1326.

**Not cut, and the review was right to say so.** The timeline's selected-item
strip is a MOVE rather than a removal: `trans:` appears in exactly two lines
of JSX in the whole frontend, both inside it, and it holds the only opacity
and fit controls for a clip. Deleting it without rehoming those loses
transitions entirely. That move, and collapsing the two volume sliders to the
model's own 0–4 bound, is its own change.

Also not cut: text in the Studio stays refused, for the reason the review gave
rather than cost — the house already makes type in two places, and a third
type system inside the editor is the two-vocabularies fault at its worst.

**A fourth guard rewritten for the same reason.** Two tests broke on these
cuts, both pinning a marker that happened to be on screen rather than the
claim: one required the literal `accept={CLIP_ACCEPT}`, and one identified
"this is the editor" by the words "Editor" or "Frame size", both of which the
cuts removed on purpose. The second now matches the timeline, which is the
editor's one irreducible part.

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
