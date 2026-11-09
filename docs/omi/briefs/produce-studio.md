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
| 2 | ~~Studio top bar: name, save dot, Export, hero suppressed on this screen~~ **Built 9 November**, with `?open=` and inline rename; see below | none |
| 3 | Four-panel shell: 240 / 1fr / 260 with a full-width timeline row | none |
| 4 | ~~Timeline toolbar~~ **Built 9 November**: undo, redo, split, delete, Fit/−/+, `?`. Ripple deleted; zoom slider and snap toggle refused, with reasons below | none |
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

## Built, 9 November: one inspector

The timeline carried its own selected-item strip, which was a second
inspector 700px below the first. It is gone, and its three controls are not:
transition, opacity and fit moved into the inspector FIRST, which is the only
reason the strip could be deleted. `trans:` appeared in exactly two lines of
JSX in the whole frontend and both were in that strip, so a cut without a
rehome would have taken dissolves out of the product. The review was right to
call this a move.

**The fault it fixes.** The two inspectors disagreed about volume: one 0–4,
the other 0–2 with a `Math.min(2, …)` clamp, for the same number on the same
item. A clip set to 3.5 in one read as 2 in the other, and touching the lower
slider wrote the clamped value back. There is now one volume slider at the
model's own bound, and the browser confirms exactly two range inputs on the
page — volume at 4 and opacity at 1.

**One vocabulary.** The inspector said Cover and Contain; the timeline said
Fill frame and Letterbox. Same two values, both reachable in one sitting. It
now says what happens to the picture rather than what the CSS is called.

**A sixth guard, and this one I wrote and broke within the hour.** The shelf
assertion checked for the word "SELECTED", which was the caption of the strip
this change deletes. The claim was that the new item is selected; it now reads
the inspector's own Length and Remove, which render only when something is.

## Built, 9 November: a file says how long it is

The fault, and it was invisible: footage dropped on the **Library** was
recorded with a name, a type and a size, and nothing about the picture. No
width, no height, no duration. `pickAsset` in the editor reads
`asset.duration_s` and falls back to `STILL_DEFAULT_LEN` when a source has
none, so **a 90-second clip from the Library arrived on the timeline 3.2
seconds long** and rendered truncated. Nothing failed; the clip was simply
the wrong length, and the only way to notice was to count.

The clip and audio uploads in `routes/compose.js` had always probed. There
were two copies of the same `ffprobe` spawn in that one file — the clip
version, which reads dimensions and frame rate, and the audio version, which
is the same spawn with everything but duration discarded — and the third
place that needed one did without.

One `services/mediaProbe.js` now, with `probeMedia` for the routes that must
fail loudly on an unreadable file and `probeForRecord` for the batch upload,
which must not lose 24 rows to one bad header.

`parseFraction` moved with it, and that is worth recording on its own: the
test for it in `compose.test.js` **held its own copy of the function** and
asserted against that. It would have stayed green if the product's version
were deleted. It imports the real one now.

The new guard, `tests/media-probe.test.js`, probes footage ffmpeg makes on the
spot — a 2-second clip, a photograph, a sound, and one at 29.97 — because a
stubbed ffprobe would have passed every day the bug existed: the route never
called one. `library-upload.test.js` gained the wiring half, and removing the
line that carries the probe onto the row fails three of its assertions.

One more thing, found in the sweep rather than the code: `drive-studio.mjs`
reported `active row read ""` on a run where the three assertions after it
read correctly. That empty string was the locator's own failure, swallowed by
a `.catch(() => '')`, so a page that had not finished loading looked exactly
like a wrong nav state. It waits for the panel and then for a lit row, and
says which of the two is missing.

## Built, 9 November: looking is not editing, leaving is not losing

Three faults that lived together, all found by the design review of the top
bar rather than by a test, and all fixed before the bar itself because the bar
makes two of them worse.

**Opening a reel wrote to the database.** Measured: one
`PUT /api/compose/compositions/1` with no interaction at all. The autosave
effect skipped its first run, which happens before the row has arrived, and
fired on the second, after `loadFromRow` had put the loaded composition into
state with `compId` set. Two consequences. `compositions.list` orders by
`updated_at`, so **browsing three reels to find the right one restamped all
three and reordered the list you were browsing** — and that date is the only
thing telling two reels called "Untitled" apart. And when the write failed you
got "Your last change is only in this tab", in red, on a page where you had
changed nothing, which is how the loudest state in the editor comes to mean
nothing.

The effect now compares what is on screen against what the server is known to
hold, rather than carrying a skip-the-next-run flag: a flag has to guess how
many renders a load takes, and the comparison also gets undo right.

**Switching reels with a failed save discarded the work.** `switchComposition`
and `createNew` guarded `saveStatus === 'unsaved'` and let `'error'` fall
straight through. So the control that said your change was only in this tab sat
beside a control that threw it away without a question. Both states hold
unsaved work; the difference is only whether a write has been tried. One
`leaveSafely` now, which flushes, and **stays where it is and says so** when
the write fails. Losing an edit quietly is the one outcome worth refusing.

Two smaller halves of the same thing: the unmount cleanup cleared the pending
autosave timer and saved nothing, so a click on any nav row within 1500ms of a
trim discarded it in silence; and the editor had no `beforeunload` warning
though `ClientDesignPage` and `RecordingsPage` both do, and the editor is the
screen with the autosave window.

**Every share link a client received was called "Reel, for your review".**
`title={composition?.title}` — but `composition` is the `data` blob and
`emptyComposition()` has no title in it. The name lives on the row, which the
editor never held. The one place the reel's name was meant to reach a client,
it never arrived. The editor holds the title now, which is also what the top
bar needs, so the bar is what forced this out.

Four new drive assertions, each shown to fail against the old code with the
old fault in its message: opening writes nothing, an untouched reel does not
claim your work is at risk, switching with an unsavable edit does not switch
and says why, and the share link carries the reel's name.

**A seventh guard that pinned a marker.** `compositionExportFlush.test.mjs`
asserted that the two reel handoffs contain `await doSave(` or
`await flushSave(`. They await `leaveSafely`, which does both and more, so a
correct change failed the test. It pins what `leaveSafely` does instead: that
it awaits the write, that it treats a failed write as work in hand, and that
it reports whether it succeeded.

## The design review before item 2, 9 November

The critic ran the app at four widths rather than reading the plan. It agreed
with the layout and named the hole in it.

**The composition has no address, and that is the real reason the `<select>`
is wrong.** `openCompId` is React state in `ClientVideoTab.jsx:30`, never a URL
parameter, so a reel cannot be linked, bookmarked or reached with Back. The
select is not a File-Open menu pretending to be a toolbar; it is a navigation
system standing in for a URL nobody wrote, and demoting it without giving the
composition an address takes the only door off the only room. OMI already has
the fix: `useOpenState()` in `hooks/useOpenRecord.js:139`, which every other
record type in the product uses, and whose own comment describes this exact
situation. **Decision: `?open=<id>` ships with the bar.**

**The switcher's one disambiguator is useless and invisible.** With fourteen
reels injected, twelve of them never named, the select rendered 14 options with
**3 distinct strings** — twelve rows reading `Untitled (11/9/2026)`. The date
is `toLocaleDateString()`, so it carries no time and cannot separate two reels
made the same afternoon, which is the only kind of afternoon this agency has.
It also sits at the end of the string, so it is the first thing a 260px box
truncates.

**The bar is shorter than what it replaces.** The top-left heading slot is not
empty: it holds an `h2` reading "Studio", naming the screen whose nav row is
lit and whose panel header says PRODUCE above it. Replacing that with the
project name and folding the save state into the same row gives back about
40px of vertical, which moves the timeline up on a 1440x900 screen. The better
design is also the shorter one.

**Undo, redo and Ripple are physically unreachable from the surface they act
on.** Measured at 1440x900: with the timeline scrolled into view, every control
in the inspector header is above the viewport. Only Ctrl+Z works. Step 4 moves
them; step 2's job is not to drag them into the bar on the way past.

**Sticky will not work, and it was measured rather than assumed.**
`position: sticky` on that row does not stick, because `.app-main` is
`overflow: auto` and sticky resolves against a scroll container that is not the
one scrolling. Making the bar stick is a change to the shell's scrolling model,
not a line in this component.

**Rename is cheap and exists end to end.** `PUT /compose/compositions/:id`
takes `title`, and `compositions.update` builds its SET list field by field, so
a rename sends `{ title }` alone and **cannot race the autosave**.

Open, for Daniel:

1. **`+ New` makes the Untitled problem.** It posts an empty composition and
   lands you on a black player, and it is what manufactures the twelve
   identical rows. The critic would delete it and have new reels come from
   Batch, from Record's "Send to Edit", and from a New reel step in Library
   that offers the eight shipped templates and prefills a name. That is a cut
   rather than a feature, but it needs Library's Reels tab first, so `+ New`
   stays until then.
2. **Export as the one primary on the screen.** Today `Play` is the only accent
   fill on the page and Export is drawn like `-1 frame`. The most emphasised
   control in the Studio is "play the preview" and the thing the screen exists
   to produce is a secondary button. It touches `Compositor.jsx`, so it is
   flagged rather than smuggled in.
3. **Retry before shouting.** A failed save schedules nothing and asks the
   operator to press a button for a condition that would often clear itself.
   Two or three retries with backoff, red only when they have all failed.

## Built, 9 November: the top bar, and a reel with an address

Build order step 2, and the last of the chrome.

**What it replaces.** A composition `<select>` as the first thing on the page,
`+ New` beside it, and the save state pushed to the far right of the same row.
Two measurements condemned that row. With fourteen reels and twelve never
named, the box rendered 14 options with **three distinct strings**, and the
date meant to tell them apart carries no time and is the first thing a 260px
box truncates. And the save state, right-aligned, sat 35px under the fixed
connector indicator in the same corner, reading as part of that status cluster
rather than as a fact about the document.

**What is there now.** A kicker reading `Reel • Draft`, the reel's name as the
only heading on the page, the save state beside it, and at the right a reel
picker, `+ New`, Share and Export. Measured: the title ends at 603px and the
save state starts at 643, no horizontal overflow at 1280, and the stage starts
25px higher than it did because the bar replaced an `h2` that named the screen
whose row is lit and whose panel header says PRODUCE above it.

**A reel has an address.** `openCompId` was component state in
`ClientVideoTab`, so a reel could not be linked, pasted into a message or
reached with Back, and a refresh landed on whatever the editor would have
picked. It is `?open=<id>` now, through `useOpenState`, which every other
record type in OMI already uses. That, rather than its styling, is what made
the `<select>` load-bearing: it was a navigation system standing in for a URL
nobody had written. The picker is demoted and holds no value, reading as
"Open a reel…" rather than repeating the title beside it; `setTab` gained an
optional search argument so "Send to Edit" can name a reel and change screen
in one navigation rather than two, the second of which dropped the first.

**Renaming, which is why the bar is worth building.** Without it the name is a
label nobody can change and "Untitled" is permanent. The pencil opens an input
at the same size, Enter or blur commits, Escape cancels, and the request
carries the title ALONE — `compositions.update` sets only the fields it is
given, so a rename cannot write a stale timeline over an edit in flight. A
reel that has never been named reads "Untitled reel" in muted grey and opens
the field empty, so the first thing you do is type rather than clear.

**Export is the one primary on the screen, and Play is not.** Play was the
only accent fill in the Studio while Export, the thing the screen exists to
produce, was drawn in the same class as "-1 frame". The critic's argument,
taken: one accent per screen, and it belongs to the control that commits.

**The stub now saves.** `drives/stub-server.js` served no PUT for a
composition at all, so the editor's save always failed there — which is how
four save-state assertions came to pass on a page nobody had touched, and why
a rename could not be driven. It answers the PUT like the backend, and a drive
that wants a failed save asks for one with `route.abort()`. The fault belongs
in the test that is testing it.

Seventeen new drive assertions across two sections, including the three that
pin the address: a pasted link opens the reel it names, opening another
changes the address, and the screen follows it.

Left alone on purpose: undo, redo, ripple and the shortcut reference stay in
the inspector header until step 4 moves them onto the timeline's own toolbar.
Measured at 1440x900, every one of them is above the viewport when the
timeline is in front of you, so only Ctrl+Z works — but dragging them into the
top bar on the way past would make that worse, not better.

Still open from the design review: `+ New` stays until Library grows a Reels
tab, because cutting the only door to reel seven before the other one exists
would strand the operator; and a failed save still shouts on the first
failure rather than retrying first.

## Built, 9 November: the chip that did not exist

Found by the design review of step 4, and the largest thing anyone has found
in this screen's styling.

**`.btn-chip` matched no rule in any stylesheet.** Seventeen controls in the
Studio carry it and seven of them pass `is-active`; the only `is-active` rules
in the application are `.sp-row`, `.sp-step` and `.adprev-chip`. So every chip
rendered as a native button: measured at **14px tall, #efefef, no border, no
radius, weight 400**, beside a 36px pill with a 2px border.

The cost was not cosmetic. **`is-active` meant nothing**, so the selected
camera move, the selected transition, the selected fit and the shelf's
selected scope were pixel for pixel identical to the unselected ones. The
camera-move chips shipped this morning with no way to see which move was on.

One rule, and it is `.btn` at a smaller size rather than a new vocabulary —
`index.css:343` invited exactly this in writing: "If a genuinely tiny inline
button is ever needed, reintroduce a size here." 26px, pill, 2px border, white
at rest, and the same ink invert on hover and on `is-active` that `.btn` and
`.tab.active` already use.

**`--primary` is defined nowhere either**, and eight places asked for it. Two
of them were `accentColor` on the volume and opacity sliders, where an invalid
value falls back to the browser's own blue — which made them the only blue
controls in OMI, on the screen whose style guide says no brand blues. The
progress bars take the accent, the sliders take ink, and two redundant colour
overrides on a `.btn-link` are gone.

Six drive assertions, and removing the rule fails two of them with the old
measurements in the message.

## Built, 9 November: the keys fire after you click the thing you want to edit

The second of three changes for step 4, and the fault underneath it.

**Measured on the shipped build: click a clip, press Delete, nothing happens.
Press S, nothing happens.** The editing keys lived on the timeline lane's own
`onKeyDown`, which fires only when that div has DOM focus — and clicking a
CLIP does not focus it. Clicking the ruler does. So whether the editing keys
worked depended on where you last clicked, and the loser was whoever clicked
the thing they wanted to edit. The lane was not reachable with Tab either, in
forty presses. Meanwhile the timeline printed a paragraph underneath itself
telling you to press exactly those keys.

Selection is a property of the document, not of which div has focus. S, Delete
and the arrows are on the window handler now, beside `[`, `]`, `,`, `.` and
Ctrl+Z, which have always worked from anywhere.

**One meaning for the arrows.** They used to mean three different things
depending on focus: nothing, a frame step in the player, or a 0.1s item nudge
on the lane. They step the playhead now, always, because scrubbing is the
constant act. **Shift and an arrow moves a second** — which the shortcut
reference has promised since it was written while `Compositor.jsx` explicitly
ignored shifted arrows, so it had never once worked. `,` and `.` keep the item
nudge and gain the same Shift second, so there is one vocabulary for "a frame"
and "a second".

**Split selects the tail.** `splitItem` has always returned `{ comp, id }`
where `id` is the new second piece, and the timeline's handler destructured
only `comp` and threw the id away, leaving you holding the half you had
finished with. Cut, move on, cut again, delete the middle is the gesture.

Smaller things in the same change: K toggles rather than being a second pause
(the compositor already toggled it, so it was handled twice); Space works
without the player having focus, and leaves a focused button its own space
bar; `role="application"` on the lane became `role="group"`, because it no
longer handles its own keys and telling a screen reader otherwise is a lie;
and three ripple imports that were never called are gone.

**The shortcut panel is true now.** It promised two shortcuts that did not
exist, carried a TODO about planned J/K/L, and filed S, Delete and the arrows
under "select an item on the timeline first" — which was not the condition
that was failing. A reference that is wrong is worse than none, because it
sends you looking for your own mistake.

Five drive assertions, each shown to fail against the old code: clicking a
clip still does not focus the lane (which is the point — the keys must not
depend on it), Delete removes the clip you clicked, S splits at the playhead,
the piece left selected is the second one, and Shift with an arrow moves a
second.

## Built, 9 November: the timeline has a toolbar

Step 4, the last of the chrome. **Four of the seven controls the brief listed,
one deleted, and three never built.**

```
↩  ↪  │  Split   Delete                              Fit  −  +  │  ?
```

Left acts on the reel, right looks at it. Undo and redo are icons because
arrows are universal; Split and Delete are words because a scissors glyph is
ambiguous between "cut here" and "cut to clipboard" and a bin at 12px reads as
nothing. No accent anywhere: Export is the screen's one primary, and the
loudest thing in a timeline should not be a destructive verb.

**Disabled says why.** Split is off until the playhead is inside the selected
clip, which is the rule `splitItem` has always enforced and `[` and `]` have
always no-opped on in silence. The toolbar says it once, in a place you can
see.

**The inspector's Remove is deleted in the same change, not left as a second
door.** Measured at 1280x800 with the timeline scrolled into view — the only
position you can work on the timeline from — that button sat at y = -86 and
the Delete key did nothing, so **there was no reachable way to delete a clip
at all**. At 1440 it rendered five pixels from the fixed client topbar,
reading as the sixth item in the application's global header.

**Ripple is cut, not moved.** `shiftAfter` shifts ONE track, and every October
reel has a music bed, so a ripple delete on the picture shortened the video
and left the music at full length: `duration()` takes the max, so the reel
still reported 00:14:12 and ended on music over nothing. Its tooltip claimed
it worked on trimming, which it never did — `rippleTrimStart` and
`rippleTrimEnd` were imported by the timeline and never called. And it was an
invisible mode, enterable from anywhere with `r`, whose only indicator sat
193px above the top of the viewport when the timeline was in view.

What replaces it is narrower and needs no mode: **Delete closes the gap when
the next clip on that track abuts the one going, and leaves it when it does
not.** Measured both ways — a butted clip moves from 00:11:05 to 00:08:00, and
a clip with air in front of it stays at 00:13:05 where the edit put it.

**Three things the brief asked for and did not get.** A zoom slider, over a
logarithmic 2-to-400 pixels-per-second range with no detent at "fit", would
eat 100px of a 504px row to do worse than `Fit − +` does in 63px. A snap
toggle is an invisible mode with a delayed failure; Alt held during a drag is
the next thing to build there. And ripple, above.

**Also cut**: `Timeline · 2 tracks · 00:14:12`, the third statement of the
same two facts on a screen where the transport and the inspector footer both
already say them; the prose paragraph under the lane, which listed the
keyboard and named keys that could not be fired; and the minimap at default
zoom, where the lane does not overflow, so the viewport indicator covered
100% of the bar and carried no information — 40px of the loudest colour on
the screen for nothing. It renders when the lane actually overflows.

The timeline block measures **202px against 292** at 1280.

**Four marker guards, broken by one deleted caption.** The word `TIMELINE`
was load-bearing in four assertions across three files, and each of those
four had already been rewritten once for exactly the same reason — they used
to read `Editor`, or `Frame size`, and those were cut as the screen improved.

| File | Proved | Now |
|---|---|---|
| `drive-studio.mjs` | the editor rendered | the timeline element and its lanes |
| `drive-studio.mjs` | a new clip is selected (by finding `Remove`) | the inspector's `Length` row and the toolbar's live `Delete` |
| `drive-embedded.mjs` | the editor rendered | `screen()` takes a selector now; the component must be present |
| `drive-produce-access.mjs` | the editor rendered, **and that it does not leak to a client** | the component present, and absent |

The last one is the dangerous shape and it has now gone silently green twice:
a NEGATIVE written against a word passes the moment that word is deleted, for
a client, for a visitor and for a blank page alike. Both halves were checked
by pointing them at a selector that gives the wrong answer.

Two of the four were found by the full sweep rather than by the drive being
edited, which is the argument for running all 26 every time.


## The ship review of the toolbar, 9 November

Run against the built tree before merging. Six changes came out of it, three
of which I would not have shipped without.

**The abut rule had a hole, and it was exactly the clips with a transition.**
`Math.abs(next.at - end) < EPS` is false for any OVERLAPPING pair, which is
what every dissolve is. Deleting the first half of a dissolving pair left a
2.9 second hole of black in the middle of the reel — and the reel's reported
duration did not change, because the music bed is the longest track. The rule
lives in `shared/composition.mjs` as `removeAndClose` now, with its own unit
tests: joined means the next item starts after this one starts and at or
before it ends, and the shift is `next.at - item.at` rather than `item.len`.
For a butted pair those are the same number, so the measured cases are
unchanged; for a dissolving pair the length would slide the run too far and
open a gap in front of it instead.

**Split is offered whenever a clip is selected, and says what it needs.**
Greying it on the playhead hid the one precondition a person cannot see: it
is a RELATIONSHIP between two things on screen rather than a property of one.
Measured, Split was grey on load, grey after the gesture that selects a clip,
and grey again the instant you used it, so the only state it was live in was
one the operator reaches by clicking a 22px ruler that nothing asks them to
click. A grey control reads as "this does not work on this clip". It now says
"Put the playhead where you want the cut, then Split" once, to the person who
has just shown what they wanted. Delete stays disabled, and the asymmetry is
the point: its precondition is the selection, and an unselected timeline
looks unselected.

**Delete says what it did.** One button with two behaviours and no voice is
how an operator learns to distrust a toolbar: sometimes the rest of the reel
jumps left and sometimes nothing moves, and nothing said which rule you were
under. "Removed showroom-01.jpg. Reel is now 00:14:12."

**An empty reel is not four dead verbs.** On a reel made with `+ New` the
timeline was 134px of empty ruler under four greyed chips, which cannot ever
be live there — not "not yet" but decoration that looks broken, and the first
thing the Studio shows somebody who has just made a reel. The row says "Add a
clip to start editing" until there is something to edit. Zoom and the
shortcut reference stay, because they always mean something.

**Undo no longer lights up after a click that edited nothing.** The drag
batch committed on pointer-up even when the pointer never moved, so selecting
a clip lit Undo, and pressing it changed nothing and handed back a Redo. A
safety net that fires and does nothing is worse than no net, because the one
time it was needed the press has been spent on a phantom.

**The `?` was the only control in the row that was not a pill.**
`ShortcutButton` carried its own radius inline from the days before
`.btn-chip` matched any rule, and the inline radius won.

Two things the review raised that are NOT built, recorded here rather than
lost: the delete announcement exists but there is still no check for music
that outlasts the picture, and the transport under the player still offers
`Play` at full strength on an empty reel in 36px pills while the toolbar
below it is scrupulous about disabling what cannot act. The four lines of
grey prose under the transport also survive the argument that killed the
timeline's paragraph.

One correction the reviewer made against itself, worth keeping because it is
the behaviour this arrangement exists to produce: it had measured that a
`title` never appears on a disabled button, re-ran the probe properly, found
the opposite, and said so before making its argument on merit instead.

## Built, 9 November: two more reel checks

Decision 6 said the one thing worth taking from the mockup's check list was
the **9:16 aspect check**, "deterministic and cheap". It is built, with the
check the delete work made visible beside it.

**Shot for a phone, nine by sixteen.** 1080x1920 and 720x1280 pass; 1080x1350
does not, which is the portrait size people reach for out of habit and which
is letterboxed on every surface October posts to. The evidence is the size
itself.

**The sound ends with the picture.** `duration()` takes the MAX across tracks,
so a bed running three seconds past the last clip is invisible in every number
on the screen: the reel reports its full length and ends on sound over black.
The editor passes where each half stops; the server has no tracks to read on a
finished render, so the check returns null there rather than a tick, which is
the rule this file keeps everywhere else. Half a second of tail is allowed,
because that is a bed fading rather than a reel ending on nothing.

Both arrived from the same place: the delete that closes a gap shortens the
picture and leaves every audio track alone, so it is now easy to make this
mistake by accident.

**Two counts that were written as literals, in the same breath as a comment
warning against it.** `reel-checks.test.js` asserted `total === 8` four lines
under its own note that "a count in a test is a count that disagrees with the
code the first time a check is added, which is what happened here". It reads
`Object.keys(LABELS).length` now, because every check has a label. And
`drive-studio.mjs` matched `/of 8/`; it reads the number off the page and
asserts it beats the mockup's four. That is the twelfth assertion in this
project to name something the product then moved.

The verdict thresholds were proportional-ised with them: `passed >= 5` was
five of eight, and with ten checks the same literal would have called half a
reel "most".

## Faults found while auditing, worth fixing in passing

- ~~**Two volume sliders disagree.**~~ Fixed with step 5: one slider at the
  model's own bound, measured in the browser as two range inputs on the page.
- ~~**Fit has two vocabularies.**~~ Fixed with step 5: "Fill frame" and
  "Letterbox" everywhere, because they say what happens to the picture.
- ~~**A Library clip arrives 3.2 seconds long.**~~ Fixed; see below.
- ~~**No 9:16 aspect check**~~ and ~~**no check for music that outlasts the
  picture**~~. Both built; see below.
- **The transport is not the toolbar.** `Play`, `-1 frame`, `+1 frame` and
  `Start` are 36px pills wrapping onto two rows in a 188px column, 130px above
  a row of 26px chips, and `Play` is offered at full strength on an empty reel
  with nothing to play.
- **Alt to suspend snapping** during a drag, which is what replaces the snap
  toggle that was refused.
- **The checks panel hides 54% of itself by default.** The critic's finding:
  each of the eight checks carries the evidence that produced it and the
  default state shows the verdict without it. Verdict first, evidence on
  click, is the design it asked for. Not built.
- **MOTION chips are offered on stills only.** `transformFor` does not care
  what the source is, so a slow push on a clip is the same animated scale.
  Not built.

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
