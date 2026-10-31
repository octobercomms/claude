# A video timeline in OMI: what it is, what it costs, what it replaces

Written 31 October 2026, against review item 7.2 ("Edit, and the CapCut
question"). Scoped first, then decided: **option C, build the timeline**, with
**WebCodecs** for the preview. Section 7 records what has been built and what
the build has already changed about the estimate; sections 1 to 6 are the
original scope, left as written so the estimate can be judged against it.

Read sections 1 and 6 if you read nothing else. Section 1 is what you already
have, which is more than the Edit page lets you see. Section 6 is the decision.

---

## 1 · What OMI already does, today

This matters because the gap is not where it looks. The render pipeline is
real and multi-clip; what is missing is an interface over it.

**The data model already holds an edit, not a file.** `edit_jobs` (migrations
128 and 129) stores `clips` as an ordered list and `ops` as a set of choices:

| What is stored | Where | What it does |
|---|---|---|
| `clips[]` | `edit_jobs.clips` | An ordered list of sources. Two or more combine. |
| `ops.trim` | `edit_jobs.ops` | Keep segments, several per clip, on a single clip |
| `ops.aspect` | same | Reframe to 9:16, 1:1, 4:5 or original |
| `ops.clean_audio` | same | Denoise, high-pass, loudness normalise |
| `ops.captions` | same | Whisper to SRT, burned on, and the SRT offered as a file |
| `ops.caption_template`, `ops.caption_style` | same | How the burned captions look |
| `ops.stills_reel` | same | Build a reel from stills instead of footage |

**Everything renders server-side with ffmpeg**, in `services/editProcessor.js`,
on October's own box. No footage leaves it. Jobs queue, retry, and can be
reopened with changed `ops` so a tweak needs no re-upload.

**Three more services already do work a timeline would otherwise claim
credit for:** `silenceCut.js` (cut pauses and filler), `scenes.js` (the scene
template engine), `brollRender.js` (B-roll placement).

**The Edit page already combines clips.** `ClientEditPage.jsx` takes several
files, appends them in order, lets you remove and reorder, and renders. It
also does per-segment trimming, but only when there is exactly one clip:
`single && doTrim`.

So the honest statement of the gap is narrow: **you cannot see the edit, and
you cannot trim across more than one clip.** The review's own account of the
failure is consistent with that. "There is only a render button" is a page
that does not show its own state, and "it just generated the exact same
video" is the `nothingChosen` path, where no option was ticked and the render
was a re-encode of the input.

---

## 2 · What a timeline actually is

Not one feature. Seven, and the cheap ones are not the ones people picture.

### 2.1 The timeline surface · 3 to 4 sessions

Tracks as rows, clips as blocks on them. Drag a block to reorder, drag its
edge to trim, drag between tracks. A playhead that moves with playback and
can be scrubbed. Zoom, because a 90-second reel and a 20-minute recording
need different pixel-per-second scales.

DOM or canvas. DOM is faster to build and fine to about 50 blocks; canvas is
the right answer beyond that and costs roughly a session more. Either way
this is the part where the estimate is most reliable, because it is ordinary
interface work.

### 2.2 Frame-accurate preview · 2 to 3 sessions

This is the part that makes or breaks a timeline, and it is not a UI problem.

An HTML `<video>` seeks to keyframes, not frames. On a phone recording with a
two-second keyframe interval, asking for 00:04.20 lands you somewhere between
00:03 and 00:05. A timeline whose playhead and whose picture disagree is
worse than no timeline, because every trim is then a guess that only the
render settles.

Two ways out:

- **Proxy renders.** On upload, transcode each clip to a low-resolution,
  all-keyframe copy and scrub that. Correct, works everywhere, costs an extra
  ffmpeg pass per clip plus storage, and needs invalidating when the source
  changes. This is what desktop NLEs do.
- **WebCodecs.** Decode frames in the browser. No server cost, genuinely
  frame-accurate, and supported in current Chrome and Edge. Safari's support
  arrived recently enough that I would not rely on it for a client-facing
  tool without testing on the actual devices.

I would build proxies. Predictable beats clever on the thing that has to be
right.

### 2.3 Filmstrip thumbnails · 1 session

A row of stills along each block, so you can see where a cut lands without
scrubbing. ffmpeg extracts them at an interval on upload; the front end
places them. Cheap, and it is most of what makes a timeline feel like one.

### 2.4 Audio waveform · 1 session

Peaks extracted server-side on upload, drawn under each block. You cut on
speech, so this is not decoration: without it you are cutting blind in the
middle of a word. `silenceCut.js` already computes something adjacent and may
shorten this.

### 2.5 The edit decision list · 3 to 4 sessions

The model that replaces `ops.trim`. Per clip: in point, out point, position,
track, audio gain. Plus transitions between adjacent clips. A migration, and
then the part that is genuinely hard: **translating an EDL into one ffmpeg
filter graph.**

Concatenating clips that differ in resolution, frame rate, pixel format or
rotation requires normalising each input before the concat, and getting that
wrong produces output that plays on your machine and not on the client's
phone. The current processor sidesteps this because it combines whole clips
with a known path. An arbitrary EDL does not get to sidestep it.

### 2.6 Render queue changes · 1 to 2 sessions

A timeline render is longer than a trim, so it needs progress rather than a
spinner, cancellation, and a queue that does not block the three existing job
kinds behind one long render.

### 2.7 Text and overlays over time · 2 sessions

A timeline implies text that appears at 00:03 and leaves at 00:06, positioned
where you put it. Caption burn-in already exists but is whole-video and
template-driven. This is a different feature wearing the same word.

### Transitions · 1 to 2 sessions

Cross-fades at minimum, because a client will ask within a week of seeing a
timeline. Each one is an ffmpeg `xfade` with its own timing arithmetic
against the EDL.

---

## 3 · The total, and the honest uncertainty

**14 to 20 sessions for a first version somebody would use**, excluding
undo/redo, autosave, colour, speed ramps, keyframed anything, and any mobile
support. The spread is mostly 2.2 and 2.5: the preview approach and the
filter graph are where a plan meets a codec and loses.

Two things I would say out loud rather than bury:

**This is the first thing in OMI that needs frame-level correctness.** Every
other output is a document, a number or a post, and an error is embarrassing.
A wrong frame in a client's reel is visible to their audience. That raises the
standard of testing from "does it run" to "is it right", which is slower work
than the session counts above suggest on their own.

**It is a project with an ongoing cost, not a build.** Browser codec support
moves, phones produce new container quirks, and a timeline is the component
people notice first when it drifts. Budget maintenance, not just
construction.

---

## 4 · What it replaces, and what it does not

**Replaces:**

- The Edit page's toggle list, for anything beyond a single trim
- `ops.trim` as a model, which becomes a special case of the EDL
- Guessing where a cut lands, which is the actual daily cost today

**Does not replace, and should not be sold as replacing:**

| Stays | Why |
|---|---|
| HeyGen avatar reels | A generator, not an edit |
| The Resize engine | Fixed-size composition, and carousels belong there |
| Caption burn-in templates | Whole-video styling, which a timeline does not do better |
| `silenceCut.js` | It decides *where* to cut; a timeline only shows you |
| `scenes.js`, `brollRender.js` | Both produce an edit; the timeline would then let you adjust it |

The last two rows are the interesting ones. A timeline makes the existing
automatic edits **adjustable** rather than take-it-or-leave-it, which is
arguably worth more than the timeline as a thing to type into.

---

## 5 · The cheaper thing, costed

Not a smaller timeline. A different fix for the actual complaint.

| Change | Sessions | What it fixes |
|---|---|---|
| The page says what it will produce before the render | 0.5 | "It generated the exact same video": `nothingChosen` becomes visible, with a line saying what will change |
| Clips as an ordered strip with thumbnails, reorderable | 1 | You can see the edit you have assembled |
| Trim segments across every clip, not only a single one | 1 to 1.5 | The one real capability gap, using the EDL idea without the surface |
| A waveform under the trim control | 0.5 | Stop cutting mid-word |

**3 to 3.5 sessions**, reusing the processor as it stands, and it leaves the
door open: the third row is the EDL by another name, so a timeline later
builds on it rather than replacing it.

What this does **not** give you: frame-accurate scrubbing, transitions,
positioned text over time, or anything a client watching over your shoulder
would call an editor.

---

## 6 · The decision

Three options, and I have a recommendation.

| Option | Cost | What you get |
|---|---|---|
| **A · The cheap fix** | 3 to 3.5 sessions | The Edit page stops lying about what it will do, and trimming works across clips. No timeline. |
| **B · Cheap fix now, timeline scoped later** | 3.5 now, decide again in a month | A working page, and the EDL groundwork laid, with the timeline decided on evidence of whether you still want it |
| **C · Build the timeline** | 14 to 20 sessions, plus upkeep | A browser editor, and the automatic edits become adjustable |

**I would do B.** Not because the timeline is a bad idea: making
`silenceCut`, `scenes` and `brollRender` adjustable is a genuinely good one.
Because of the order. The complaint that started this was that the Edit page
does not say what it does, and that is three sessions, not twenty. Fix that,
use it for a month on real client work, and the answer to "do we need a
timeline" will be obvious rather than argued.

The downside of B, stated plainly: if you already know you want the timeline,
B delays it by three sessions and the cheap fix's first two rows are work the
timeline throws away. That is a real cost, about a session and a half of
waste, and it buys a decision made on evidence.

**What I need from you:** A, B or C. Nothing is being built on this until you
say.

If C, one further answer before any code: proxy renders or WebCodecs for the
preview (section 2.2). I would take proxies, and the difference is an ffmpeg
pass and some storage against a dependency on Safari's codec support. It is
the one choice in here that is hard to reverse later.


---

## 7 · Build log, and what the build changed about the estimate

### Session 1 · the model and the surface

Built: **2.1 (the timeline surface)** and the model half of **2.5 (the edit
decision list)**.

| What | Where |
|---|---|
| The EDL, as a pure model | `dev/platform/shared/edl.mjs` |
| The surface | `dev/platform/frontend/src/components/video/Timeline.jsx` |
| Wired into the page | `frontend/src/pages/ClientEditPage.jsx` |
| Render across clips | `backend/src/services/editProcessor.js` → `cutEdl()` |
| Guards | `backend/tests/edl.test.js` (30), `edit-edl-render.test.js` (7), `edit-route-edl.test.js` (9), plus a 37-assertion browser drive |

The surface does: blocks on one track, drag to reorder, drag either edge to
trim, click the ruler to move the playhead, zoom with fit-to-width as the
default, split at the playhead, delete, and a keyboard equivalent for every
one of those. The preview follows the playhead and shows the clip it is over.

**The one real capability gap is closed.** Trimming used to work only when
there was exactly one clip (`single && doTrim` in the page,
`segs.length && paths.length === 1` in the processor). An EDL cuts across any
number of clips, and `cutEdl` renders it.

### What this changed about the estimate

**2.5 is cheaper than scoped: 1.5 to 2 sessions, not 3 to 4.** The scope
assumed an arbitrary EDL needs one ffmpeg filter graph, and that normalising
inputs that differ in resolution, frame rate, pixel format or rotation was the
hard part. Neither held. Cut each block, normalise it the way `combineClips`
already normalises a whole clip, and concatenate by stream copy: the
normalisation problem was solved in that function in migration 129's work and
is reused rather than rebuilt. The filter graph is still needed for
**transitions** (`xfade` has to overlap two inputs, which a concat cannot),
so that cost moves from 2.5 into the transitions line rather than disappearing.

**No migration was needed.** The EDL lives in the existing `edit_jobs.ops`
JSONB as `ops.edl`, so reopening a job already carries it and the scope's
"a migration, and then the hard part" is just the hard part. Jobs saved before
this read their old `ops.segments` or `ops.trim` back as blocks over clip 0, so
reopening an older edit keeps its cuts.

### What is deliberately not there

- **No second track.** Stacked tracks mean overlay compositing, which the
  processor cannot do. A track that renders to nothing is the page lying about
  its output, which is the complaint this work exists to answer.
- **No playback across a cut.** The preview seeks within the block the playhead
  is over and stops at its edge. Playing the assembled edit is 2.2, and a
  preview that stitched clips in the browser would be showing frames the render
  will not contain.
- **No filmstrip or waveform yet** (2.3, 2.4). Both are server-side extraction
  on upload plus placement on the block, and both are cheap; neither is built.

### Three bugs found while building, worth knowing about

1. **Float comparison deleted blocks.** `(5 + 0.05) - 5` is
   0.049999999999999822 in IEEE doubles, so an exact `>= MIN_ITEM` check
   rejected a block that was exactly the minimum length, and rejected it at 5s
   while accepting it at 1s. Every length test now goes through
   `atLeastMin()`, and times are pinned to the microsecond. This is the class
   of bug the scope warned about under "the first thing in OMI that needs
   frame-level correctness", and it arrived in the first hour.
2. **`clipPaths` shifted every index after a missing clip.** The processor
   built its path list by pushing only files that existed, so a job whose
   second clip had gone from disk rendered the third clip's cuts from the
   second clip's footage. Harmless while clips were whole and in order;
   silently wrong the moment indices mean something. Now built with `map` and
   a null hole.
3. **Fit-to-width rescaled mid-drag.** A trim shortens the edit, fit stretches
   the edit back across the lane, so the edge being dragged chased the pointer
   and every trim landed short. The scale is now frozen for the duration of a
   drag, which is what desktop editors do and why their trims feel direct.

### Session 2 · the filmstrip

Built: **2.3 (filmstrip thumbnails)**.

| What | Where |
|---|---|
| Extraction, in the browser | `frontend/src/utils/filmstrip.js` |
| Placement, pure and tested | `frontend/src/utils/filmstripPlace.js` |
| Drawn on the block | `Timeline.jsx` |
| Guards | `frontend/tests/filmstripPlace.test.mjs` (12), plus a 66-assertion browser drive |

**The scope was wrong about where this runs, and the correction matters.** It
said "ffmpeg extracts them at an interval on upload; the front end places
them". On the Edit page a clip is a local `File` with a `blob:` URL from the
moment it is dropped and does not reach the server until Render is pressed, so
server-side extraction would leave the timeline blank for exactly as long as
the timeline is being used, filling in only for a job reopened later. The
filmstrip is most of what makes a timeline feel like one, so it has to be there
while the edit is being made.

A browser can do it: seek a `<video>`, draw the frame to a canvas, keep the
JPEG. Thumbnails are the one part of a timeline that does not need frame
accuracy, so seeking to a keyframe rather than a frame costs nothing here,
which is exactly why this is cheap when 2.2 is not. Twelve stills per clip at
44 CSS pixels tall, sampled at the middle of each slice rather than the start
because a still taken at 0 is often a black frame from a fade-in.

One strip per source clip serves any number of blocks over that clip. A trim
changes which stills are in range, a split changes which block each belongs to,
a reorder changes neither, and nothing is re-extracted for any of them. The
half-open interval matters: a still at exactly the cut point belongs to the
block starting there, or a split draws one frame twice.

**Still no server work, and no waveform yet.** 2.4 needs peaks, which a browser
*can* compute via `AudioContext.decodeAudioData`, but decoding a whole audio
track to float arrays is a different order of cost from twelve seeks. That one
is worth doing on the server, on upload, for remote clips, with the local case
honestly left blank until the first render. Decide that at the start of 2.4
rather than assuming either way.

### Two bugs in the extraction loop, both only findable by driving it

1. **A duration arriving tore down the extraction.** The hook keyed its effect
   on the clips array, and the page replaces that array whenever the browser's
   metadata probe lands a duration, which is within a second of every upload.
   The in-flight extraction was cancelled and never retried, because the cache
   already held a `working` entry for that clip. Every block said "reading
   frames" for the rest of the session. Keyed on the clip ids now.
2. **A mutex plus a teardown deadlocked.** With the first fix in, adding a
   second file still killed it: the loop reading the first clip was cancelled,
   and the replacement loop found the `running` mutex still held by the loop
   that had not finished unwinding, so it returned and nothing was read again.
   Replaced with one pump for the life of the component that takes another pass
   when the clip list changes, rather than being replaced.

Neither would have been caught by reading the code, and neither throws.

### Next session

**2.2, the frame-accurate preview, on WebCodecs** — but not before the
capability probe comes back from the real devices. The probe reports whether
`VideoDecoder` exists and how far a plain seek lands from the frame asked for,
on footage shot on that device. If a plain seek is already inside a frame, the
preview is cheaper than scoped; if Safari has no `VideoDecoder`, proxies are
needed as a fallback and that is better known now than in session 12.

Cheapest useful work that needs no probe result: **2.3 filmstrip** and **2.4
waveform**, one session each, both server-side extraction on upload.
