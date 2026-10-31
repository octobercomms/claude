# A video timeline in OMI: what it is, what it costs, what it replaces

Written 31 October 2026, against review item 7.2 ("Edit, and the CapCut
question"). The decision taken on 31 October was **scope the timeline properly
before any build**, so this is that scope. No code has been written for it.

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
