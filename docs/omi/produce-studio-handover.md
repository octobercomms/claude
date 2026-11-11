# Produce → Studio: where this got to

**Paused 11 November 2026, at Daniel's request**, with everything merged and
deployed. Nothing is half-finished in the tree: `main` is `053922d2`, there is
no open PR, and the branch is in step with it.

This file is the short version. The long version, with the reasoning and every
measurement, is `briefs/produce-studio.md`, which is the **brief** and wins
over any plan. Read this to pick the work up; read that to understand why
something is the way it is.

---

## Where it stands

The Studio is a four-panel editing instrument that fills the window:
`240px / 1fr / clamp(320px, 24vw, 460px)` with the timeline across the bottom,
and the rail and section panel collapsed to 56px icon strips on this screen
only.

Measured on the shipped build at 1440x900, cold:

| | |
|---|---|
| picture | **353 x 628** |
| the mockup's | 269 x 479 |
| page scroll | none, at 1440x900 and 1280x800 |
| inspector | 346px, all ten reel checks on screen without scrolling |

The picture being larger than the artefact's is **not** a win to bank: the
fixture reel has two lanes and the timeline is content-sized in our build and
in the artefact, which only looks settled because it draws exactly six lanes.
At six lanes ours is about 235px. The splitter exists so an operator can
settle that for themselves; it is remembered per browser.

---

## What shipped

Grouped by what it does for the operator, newest first.

| | |
|---|---|
| **The Studio knows its batch** (#2061) | `Atlas Q4 showroom · 2 of 4 · 3 still to judge` in the bar, the run's name as the way back to the sheet, `[` and `]` to walk the reels still waiting, and a verb that changes with what the server will accept |
| **The Studio's own ladder** (#2060) | 11/12/13/15/20 type scoped to the screen, three control heights instead of nine, colour by kind on the timeline, the ruler saying `0s` not `00:00:00` |
| **Geometry** (#2059) | the surplus width to the inspector instead of to the black; the transport as 28px glyphs so it cannot wrap |
| **Three defects** (#2058) | an empty reel showing the previous reel's picture; the verdict chip carrying a stale score across reels; a stub route that invented a third defect |
| **A splitter and the verdict chip** (#2057) | picture against timeline, remembered; `6 of 10` in the bar, reported by the panel so the two cannot disagree |
| **The shell** (#2050–#2056) | icon strips, full height, checks into the inspector, the 240px bin replacing the shelf, 48px lanes, verdict-first checks, four named inspector groups, camera moves on footage |

Before that, in the same stretch: the top bar with a reel's address, the
timeline toolbar, one inspector, the cuts, the keyboard fixes, the player
drawing anything at all, two more reel checks, and the frame-you-judge fix.
`git log --no-merges --since=2026-11-09` over `dev/platform/frontend/src` is
the full list.

**Build-order items 1 to 7 of the brief are complete.** Item 8+ (drag from
bin, fades, per-track mute, fixed lanes, text, filters) was always costed
separately and none of it is started.

---

## What needs completing

### Two decisions, which is why this stopped rather than where it ran out of work

**1. The eight library tabs.** Media, Audio, Text, Effects, Transitions,
Captions, Designs, Filters along the top bar. This is the artefact's whole
consolidation idea — the reason it exists is that Produce had six co-equal nav
rows and the brief says they should become one Studio with tabs. Three of the
eight are already ruled out (Text refused; Filters and auto colour have no
backend). **The other five have never been ruled on.** Until they are, the
brief's target is not met and the screen is an editor with a file picker
rather than the Studio that was briefed.

**2. The bin's default scope.** It opens on "In this reel", which on a new
reel is empty and on any other reel shows the same four things the timeline
shows 300px away. The argument for defaulting to "All footage" is that a bin's
job is to show you what you have **not** used yet. The counter-argument is
that "In this reel" is the only surface that makes a project's contents
visible, which is why it was made the default in the first place.

### Ranked work, ready to build once those are answered

From the broad UX review of 10 November, in its order:

1. **The transcript as an edit surface.** Today it is 96px of grey prose in
   the inspector with the word timings thrown away by a `.join(' ')` — timings
   that `TightenPanel` and `BrollPanel` already use. Put it in the black beside
   the picture: click a word to move the playhead, drag a phrase to get
   `Cut these words (2.4s)`, dead air shaded in place. Every function it needs
   exists. For the talking half of October's output the sentence is the unit,
   not the frame.
2. **Where a reel begins.** `+ New` makes an untitled empty document. It
   should offer the eight shipped templates by name, which also stops
   `Untitled (11/9/2026)` being manufactured twelve times. The brief parked
   this behind "Library needs a Reels tab"; it does not.
3. **Getting material in.** No multi-select in the bin, no drag to the
   timeline, everything lands at the end of its track. Building the montage
   the `stills-montage` template describes is about twenty clicks per reel,
   thirty times. Shift-click plus `Add 6 to the reel` takes it to about nine.
   Bin tiles also carry no duration.
4. **The verdict as a gate.** `6 of 10` is arithmetic; the operator wants
   **Ready** or **3 to fix**. Each failing check should carry its own remedy
   rather than diagnosing and leaving.
5. **Transform controls.** Scale and position have no controls at all. The
   recorded reason not to build them was disproved (see below), so the only
   remaining question is whether numeric fields belong at all — this repo
   argued in writing that the named camera move is the unit of work and
   "nobody chooses that by typing 1.12 into a number field". Rotation stays
   refused: the render graph cannot draw it.

### Smaller, recorded, unbuilt

- Photographs draw no filmstrip on the timeline, though a photograph is the
  one source that already **is** an image.
- The playhead has no grabbable head.
- `Crop` is absent from the timeline toolbar, neither built nor refused in
  writing.
- Per-track visible / lock / mute on the 52px headers.
- `J`/`K`/`L` are mapped but do not behave as they do in any NLE, and there is
  no variable-speed playback.
- 25 tab stops stand between the top of the page and the first Studio control;
  the skip link lands in the application's global header, not the Studio.
- The Export modal has one dead field and no decisions left in it.

---

## Four claims that did **not** survive measurement

Recorded so nobody rebuilds them. Each cost real time.

| claim | what measurement showed |
|---|---|
| "The preview and the renderer disagree outside the overscan" | They agree exactly, at `pos` 0.45 with `scale` 1.5 and beyond. It had been blocking the Transform controls. The arithmetic is now one shared function, `framePlacement`, with a pixel test |
| "A 240px bin leaves the player 28px" | True of a scrolling page where the picture was width-bound; false once the Studio filled the window and it became height-bound. This claim cost the brief its build-order step 3 |
| "`+ New` gives the new reel no address" | The product always set it. The **stub** had no handler for the create POST and answered with the GET list |
| "The picture is judged against white filling 56–65% of the stage" | The player well is `rgb(0,0,0)` and spans the full width. The review had measured the page background |

---

## Traps this screen has already taught

Worth reading before writing a test here.

- **A guard that names a marker rather than the claim goes green when the
  marker is deleted.** Twelve instances found so far. The brief keeps the list.
- **A comparison with one operand is the same failure.** The verdict chip
  compared its number to the panel's; on an empty reel there is only one number
  on the page, so it passed with nothing to compare — while the chip was
  showing the previous reel's score.
- **A presence assertion cannot see what is drawn on top.** Every test passed
  on the day `Play` could not be clicked and hit-tested to `Redo`. Hit-test.
- **A stub that answers an unimplemented route with 200 invents defects.**
  Twice now.
- **A test that passes on a fresh stub and fails on the second run is green in
  CI and red on a desk.** The batch section resets its own fixture.

---

## Picking it up

```bash
cd dev/platform/frontend && npm run build
cd ../drives && node stub-server.js &
node drive-studio.mjs          # the Studio's own guards, sections 1–32
```

Then `http://127.0.0.1:4599/clients/c1/produce/studio`. Reel 1 is in no batch;
reels 2 and 3 are in batch `vb1`, which is how the batch bar is driven.

The house standard here is **mutation testing**: break the thing the guard is
about, confirm the guard fails and names what it saw, put it back. Every
change in this stretch was checked that way and the PR bodies record the
failure output.

| | |
|---|---|
| The brief, which wins over any plan | `docs/omi/briefs/produce-studio.md` |
| The artefact, in the repo | `docs/omi/briefs/produce-studio-mockup.html` |
| The screen | `dev/platform/frontend/src/pages/CompositionEditorPage.jsx` |
| Timeline, player, bin | `dev/platform/frontend/src/components/video/` |
| The guards | `dev/platform/drives/drive-studio.mjs` |
| The design authority | `.claude/agents/ux-critic.md` — it measures against the artefact first and may not conclude the artefact should be abandoned |
