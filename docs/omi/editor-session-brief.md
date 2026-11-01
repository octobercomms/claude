# One editor: brief for the next session

**Written 1 November 2026, at the end of the session that agreed the direction.
Read this before you touch anything.** You are picking up a six-to-eight week
build that has already had its arguments. Daniel's instruction for this
document, in his words: *"write the brief so the agent doesn't question
everything again."*

Read in this order: this file, then `editor-composition-model.md`, then the
findings half of `editor-replaces-basic-editing.md` (its sequencing is
superseded; its audit is not).

---

## The goal

**An account manager never opens CapCut for a routine reel.**

One video editor, one page, replacing both the current wizard
(`MakeAReel.jsx`) and the current timeline (`ClientEditPage.jsx`). Design stays
the image tool and feeds the editor graphics.

A sharper version to measure against: **a finished, on-brand, client-ready reel
in twenty minutes without leaving OMI.**

---

## Settled. Do not reopen these without new evidence

Each one cost an argument. Reopening them wastes Daniel's time, and he has
already said as much.

**1. The new editor is locked.** Behind a setting only Daniel turns on. The
current Edit page keeps working, untouched, until step 8. He is using CapCut in
the meantime and said so explicitly, so there is no pressure to make anything
demoable. *"Let's not make a half arsed version."*

**2. Build from the end state, not in shippable increments.** This was the
correction that produced the current plan. Daniel: *"shall we focus on the end
goal and not the next PR… You often focus on the task and not the goal."* Do
not re-sequence the work so that each step delivers something usable. The order
in the model doc is by dependency and by risk, deliberately, and the first two
steps are invisible.

**3. One video editor, not one editor for video and image.** Asked and
answered. Design keeps the canvas; a lower third is a Design page placed in
time. One brand kit, one type system, one library, two pages. The reasoning:
Canva and CapCut are separate products from the same company.

**4. No WebCodecs rebuild for frame accuracy.** The spec's section 2.2 rested
on the claim that a video element seeks to keyframes rather than frames. A
probe on 31 October disproved it: 22 of 22 mid-GOP seeks landed exact, on a
clean 30fps file and on one at 29.97 with B-frames and a 2.5s keyframe
interval. `currentTime` is a precise seek; `fastSeek()` is the keyframe one and
nothing calls it. `driftFrames` keeps the question open at runtime. WebCodecs
may earn its keep for pixel work later; it is not needed for this.

**5. Transcription runs on demand, one press, not on upload.** Daniel chose to
keep the opt-in. Today footage audio reaches OpenAI only when someone ticks
captions, and `editProcessor.js:8` claims "no footage leaves October's box".
Transcribing every upload would change that for every client without anyone
choosing it. The cost of his choice is 20 to 40 seconds a session.

**6. Clips upload to the server when they are dropped**, not at render. Not a
privacy change: the footage reaches the box at render time regardless, so this
moves *when*, not *where*. Only the Whisper call stays gated. While an upload
is in flight the transcribe button is disabled with a **visible line beside
it**, not a tooltip, counting the clips: "Uploading 2 of 5". Render stays
pressable and reads "finishing the upload, then rendering" when it has to wait,
because gating the primary action on a finished edit would be worse than a
wait. Build the failure case from the start: name the clip that failed, offer a
retry on that clip.

**7. Whisper cost logging is fixed before any cap is set.** It is recorded in
one place, `editProcessor.js:838-840`. Four other call sites record nothing.
Make the real number visible, then decide a ceiling.

**8. Captions are rendered by libass, in the browser, compiled to
WebAssembly.** Not canvas text. `shared/captions/compile.mjs` has **no imports
and no requires** — the browser can call it and get the byte-identical ASS the
server generates. The divergences between libass and a browser text stack are
load-bearing (FreeType hinting, the true outline stroker with values to 14,
`BorderStyle=3` where the box follows the spoken word, libass's own balanced
line-breaking, the limited-range BT.709 composite). Running libass reproduces
them by construction.

**9. Asking ffmpeg for a transparent caption layer is closed.** Measured and
recorded at `captions.js:169-175`: the `subtitles` filter writes libass output
into the colour planes and leaves alpha alone, so over `color=black@0.0` every
one of 2,073,600 pixels came back at alpha 0, across `rgba`, `yuva420p` and
`yuva444p`. Do not retry it.

---

## Still open, and genuinely yours to decide or ask

- **Does a dropped clip become a client asset library row?** Daniel has not
  answered. My recommendation was yes, marked as footage rather than finished
  work so the library's default view stays what you would send a client. The
  upload mechanism is the same either way; it is a few lines at the end.
- **The length reel check disagrees with itself in three places.** It accepts
  20 to 50 seconds (`reelChecks.mjs:32-33`), the label says "Thirty to
  forty-five" (`:132`), the rule text says "Thirty to forty" (`:254`). Which
  number is right is Daniel's call. Asked, not yet answered.
- **Keyframes.** The model has none. For "replace basic editing" I think that
  is right, but decide it consciously rather than discovering it in week five.
- **Scope to cut if the estimate slips.** Named in advance so it is not a
  panic decision: the music bed with ducking, and the b-roll lane. Both real,
  neither load-bearing for the rest.

---

## How work is verified in this repo

This is not optional and it is not negotiable by convenience. Everything merged
today went through it.

1. `npm run lint:hooks`
2. `npm run test:units`
3. `npx vite build`
4. `PW_CHROMIUM=/opt/pw-browsers/chromium npm run test:browser` — about ninety
   seconds, and it catches render-time throws that lint and the build cannot
   see. Skipping it turned a PR red today
5. A **browser drive** in `dev/platform/drives/` for anything that is a
   placement or a visible state. A diff does not show where a button sits or
   whether it is disabled. Four "Delivered" marks were wrong last week because
   a commit was checked instead of a screen
6. A **guard** in `dev/platform/backend/tests/`, registered in
   `.github/workflows/platform-checks.yml`
7. **Mutation-test every guard.** Break the code on purpose; the guard must
   notice. 114 mutations were attempted today and 114 caught, and six guards
   had to be fixed first because they were pinning the wrong thing

Then commit, push, open a PR, and let it merge on green.

### Traps already paid for. Do not rediscover these

- **`indexOf` returns -1, and -1 is less than everything.** An ordering
  assertion passes when the string it compares has been deleted outright. Three
  guards hit this in one day.
- **`indexOf('<Thing')` matches `<ThingX`.** A rename slips past. Pin the
  attribute.
- **A comment-stripping helper eats from a `/*` inside a string.**
  `accept="video/*,image/*"` opens a comment that closes at the next real
  `*/`, taking the file with it, so an "is this gone" check passes because the
  reader deleted the code. Strip only for absence checks.
- **If a mutation harness mutates a path, that path goes in its backup.** One
  today backed up two directories and mutated three, so four mutations
  accumulated instead of reverting and left real faults in the tree.
- **A guard assertion fails on your own comment** quoting the string it bans.
  Strip comments first.
- **`text-transform: uppercase`** has caught three browser drives. Compare
  case-insensitively.

---

## A review of ReaCut (Xiangyu-CAS/rea-capcut)

Daniel asked for this. **I read the README, not the code.** Treat what follows
as a read of the project's own claims plus my judgement about transfer, and
read the source before relying on any of it.

**What it is.** An open-source desktop video editor, MIT for its own code,
describing itself as "an independently implemented, open-source video editor
informed by REA-assisted research into Jianying / CapCut". Electron, React,
TypeScript, FFmpeg and FFprobe, with Vite and Vitest. Not a wrapper: the README
states REA, Ghidra and Jianying are not runtime dependencies. Its layout
separates the interface, the editor state with undo/redo and preview, a core
holding the project model, timeline, subtitles and visual processing, and an
Electron layer for file access, media processing and export. Multitrack
timelines, linked video and audio clips, keyframes, and `.reacut` project
files. 116 stars, 34 forks, **41 commits**, a v0.7.1 preview release.

**Its own stated limits.** Early stages. Preview binaries are macOS on Apple
Silicon only, ad-hoc signed and not notarised, with Windows test failures
outstanding. Speech recognition needs a separate local Python and MLX setup.
Cloud sync, SaaS, direct AI integration and portrait cutout are not
implemented. Jianying import is experimental and loses complex text, effects
and keyframes. Most of the detailed documentation is in Chinese.

### My read

**Worth reading for two specific things, and bounded to those.**

1. **Their project model and timeline schema.** This is prior art for exactly
   the decision in `editor-composition-model.md`: how to represent multitrack
   time, linked audio, and a transition. The README does not document the
   schema, so this means reading `src/core/`. Worth a session's hour, not more,
   and worth it mainly as a check that the model here has not missed a concept
   that everyone building one of these ends up needing. Their **keyframes** and
   **linked video/audio clips** are two such concepts the model here does not
   have; decide consciously rather than by omission.
2. **Their FFmpeg export graph for a multitrack composition.** Step 2 of the
   build order is exactly this and it is the riskiest step. A working graph to
   read against is worth real time.

**Not a dependency, and not a template for the architecture.** Two reasons, and
the second is the important one.

The shallow reason is maturity: 41 commits, one platform, early by its own
account. Nothing to build a client-facing product on.

**The deeper reason is that ReaCut does not have OMI's hardest problem.** It is
Electron. It renders locally, with the same FFmpeg binary that drives its
export, on the same machine. Its preview and its output agree because they come
from one place. OMI's preview is a browser and its render is a server, and
making those two agree about captions, graphics, framing and audio **is the
entire fidelity problem** this plan exists to solve. ReaCut sidesteps it by
construction. So their preview architecture transfers to OMI hardly at all,
and anyone reading it looking for how to make a browser preview match a server
render will find that question was never asked.

**One licensing note.** ReaCut's own code is MIT, but it bundles FFmpeg and
x264 under GPL. OMI shells out to ffmpeg as a separate process server-side,
which is the normal way to stay clear of that, and nothing here should change
to vendoring a GPL build. If anyone proposes lifting their export layer
wholesale, that is the line to check.

**And the thing not to take from it at all:** its scope. It is a general
editor, and OMI's advantage is the opposite. The value here is the client's
brand kit, their asset library, their caption colours and their own reel
performance history. Every step towards general makes OMI worse at the only
thing it has an edge in. ReaCut is competing with CapCut. OMI is not, and
should not start.

---

## Where the work stands

Nothing built. The model is designed and reviewed, the decisions above are
taken, and the build order is in `editor-composition-model.md`.

**Start at step 1:** the composition model and the source-to-timeline mapping,
in `shared/`, with unit tests and mutation testing, and no UI. It is invisible
and it is where this dies if it is going to. Step 2, the render graph proved
against the new model, is the other one. Build neither a timeline nor a preview
until both hold.
