# Composition Editor: Full Review

**Date:** 7 November 2026
**Scope:** UX/UI, technical architecture, feature completeness, improvements

---

## Executive Summary

The composition editor is a well-architected replacement for the old single-track EDL wizard. The shared-model approach (one composition.mjs drives browser preview, ffmpeg render, and timeline UI) is the strongest architectural decision in the project; it eliminates the class of fidelity bugs that plagued the old pipeline by construction rather than by discipline.

The build was sequenced correctly: data model and mapping first (the two pieces most likely to fail), render graph second, visual compositor third, UI last. That ordering meant the riskiest work was validated before the visible work began.

Three areas deserve attention:

1. **UX gaps** that slow down a routine editing session (no waveform-driven rough cut, limited keyboard trimming, no batch export)
2. **Render resilience** issues: in-memory job state is lost on pm2 restart, and no queue prevents concurrent renders from overloading the box
3. **Missing features** that Daniel identified in the brief's "nine jobs" list but that the editor does not yet cover (text overlays without the Design page detour, speed ramping, audio ducking preview)

The technical foundation is strong. The investment should now shift from architecture to workflow speed: the next improvements should make a 2-minute reel take fewer clicks, not add new capabilities.

---

## UX/UI Assessment

### What works well

- **One-page model.** Compositor, timeline, and inspector on a single page. No mode-switching, no wizard steps. This matches Daniel's "one editor" requirement exactly.
- **Drag and drop.** Files drop onto the page and land on the timeline immediately, with probed metadata (duration, resolution, fps). This is the correct onboarding path for a tool aimed at account managers, not editors.
- **Auto-save.** 1.5s debounce save to the server. The "Saved / Saving / Unsaved" indicator is clear. No manual save ceremony.
- **Composition switcher.** Multiple compositions per client, with a dropdown and "New" button. Solves the "rework a previous reel" use case.
- **Undo/redo.** History hook with batch support (drags commit as a single undo step). Ctrl+Z/Ctrl+Shift+Z wired at the page level.
- **Ripple toggle.** R key toggles ripple mode, which shifts subsequent items on delete or trim. This is a workflow accelerator once users learn it exists.

### What needs improvement

**1. Empty state is too passive.** The "Drop clips to begin" text is the only onboarding. An account manager opening this for the first time has no idea what a "composition" is or why there are tracks. A brief inline guide or a 30-second video walkthrough overlay would reduce support load.

**2. The inspector is read-only for timing.** The inspector shows At and Length as formatted timecodes but they are not editable. For precise work (placing a lower third at exactly 00:04:12), the user has to drag and hope the snap catches. Inline editable timecode fields would cost very little and remove guesswork.

**3. No keyboard-driven trimming.** J/K/L for transport, R for ripple, ? for shortcuts. But no [ ] for setting in/out points, no comma/period for nudging items by one frame. These are the shortcuts that separate a 5-minute workflow from a 20-minute one.

**4. Volume slider is buried.** Per-item gain is adjustable, but only via the inspector when the item is selected. There is no visual gain line on the timeline waveform (the standard NLE pattern). For a music bed, the user has to select the item, find the slider, guess a number, play back, adjust. A draggable gain envelope on the timeline would be a large UX win.

**5. The "Tighten" and "B-roll" panels require a selected clip.** If the user has not selected a clip item, the panels show nothing. The happy path should be: click "Find dead air" and the system knows which clip to analyse (the first clip source, or all of them). Requiring explicit selection adds a step that will confuse less technical users.

**6. Export modal lacks queue awareness.** If a render is already running and the user opens Export again, there is no indication of the existing job. The `renderJobs` map is keyed by composition ID, so starting a second render for the same composition silently overwrites the first job's state. This should either block ("render in progress") or queue.

**7. No thumbnail preview in the composition list.** The switcher shows title and date. A thumbnail of the first frame would help when the user has 10+ compositions for the same client.

---

## Technical Assessment

### Architecture strengths

**Shared model is the right call.** `composition.mjs`, `compositionPlayback.mjs`, `compositionRender.mjs`, and `compositionMapping.mjs` all live in `shared/` and are imported by both browser and server. The agreement tests (playback model vs render graph on fixtures) prove the two sides match. This is the single best architectural decision. It eliminates the old pipeline's five-pass encode and the fidelity faults documented in the design doc.

**Immutable state updates.** Every editing operation (`addItem`, `removeItem`, `updateItem`, `splitItem`, `moveItemToTrack`) returns a new composition object. The timeline stores a snapshot at drag-start and recomputes from it, so a drag is one edit, not accumulated rounding errors. This is correct and prevents the float-comparison bugs that plagued the old EDL.

**The mapping module resolves the hardest problem correctly.** The three decided rules (cut-out maps to nothing, overlap goes to topmost, straddling word belongs to midpoint's item) are clean, tested, and shared. This is where the project was most likely to die, and it did not.

**Render graph produces a single filter_complex.** Replaces five sequential full encodes. The graph handles per-item trim/scale/place, same-track xfade, multi-track overlay, audio mixing with `amix(normalize=0)`, ducking with `sidechaincompress`, and captions via subtitles filter. All in one encode pass. This is both faster and more correct than the old pipeline.

**Test coverage is strong for the shared modules.** 14 test files covering composition model, mapping, playback, render graph, editing operations, and mutations. The mutation testing (targeted mutations, all killed) is a higher bar than most production codebases.

### Technical concerns

**1. Render job state lives in-memory.** `renderJobs` is a plain `Map()` in the compose route module. A pm2 restart, a deploy, or even a worker rotation loses every in-progress and completed job. The user sees "No completed render available" after a deploy even if the file exists on disk. This should be persisted to the compositions table (a `render_status` JSON column, or a separate `composition_renders` table). The file on disk already gets recorded as an asset, but the polling endpoint does not check for it.

**2. No render concurrency control.** Two users (or the same user on two compositions) can start renders simultaneously. Each spawns an ffmpeg process that will consume all available CPU. On the Hetzner box, two concurrent H.264 encodes at 1080p will compete for resources and both run slowly. A simple queue (one render at a time, others wait) would prevent this.

**3. Compositor video element pool never releases.** `m.current.elements` is a Map that grows as sources are added but elements are never removed. For a long editing session where the user adds and removes many clips, this will leak video elements and their associated memory buffers. A cleanup pass when a source is removed from the composition would fix this.

**4. The `assetFilePath` function uses a regex on the URL.** It expects `/api/brand/file/:clientId/:filename` and extracts the path. If the URL format changes (e.g., R2 migration for media), every composition with the old URL pattern breaks. The source_assets map should store asset IDs, and path resolution should go through the assets service, not URL parsing. The current code does look up the asset by ID first but then ignores the result if the URL-derived path does not exist on disk.

**5. `extractAudio` writes to `os.tmpdir()` without cleanup guarantees.** The `finally` block in the transcribe route calls `unlink`, but if the process crashes between creation and cleanup, orphaned MP3 files accumulate. A temp-file library with automatic cleanup on process exit would be more robust.

**6. The xfade chain builder (`buildXfadeChain`) has a noted complexity hotspot.** The comment "This is the most complex part of the graph builder" is accurate. The logic for grouping items into overlap runs, building per-run xfade chains, then overlaying non-contiguous runs onto a padded base works correctly but is the hardest code to maintain. Any future transition types will need careful testing here.

**7. No CORS or auth on render-download.** The `render-download` endpoint calls `res.download()` with no additional access check beyond `loadComposition` (which checks client access). This is fine for the current single-tenant use case but should be noted for multi-tenant scenarios.

---

## Feature Completeness

Measured against the "nine jobs" from the original brief and Daniel's stated goal of replacing CapCut:

| Job | Status | Notes |
|-----|--------|-------|
| Import clips | Done | Upload + probe + timeline placement |
| Trim and cut | Done | Drag trim, split, ripple edit |
| Reorder / multi-track | Done | Absolute positioning, cross-track drag |
| Transitions | Done | Fade, fadeblack, wipeleft, dissolve as overlaps |
| Captions | Done | Whisper transcription, template selection, libass preview |
| Music bed | Done | Audio upload, per-item gain, ducking in render |
| Graphics overlays | Done | Design pages as sources with alpha |
| B-roll | Done | AI-proposed cutaway moments with asset picker |
| Export | Done | Single-pass render with quality/resolution presets |

**Missing from the CapCut comparison:**

| Feature | Impact | Effort |
|---------|--------|--------|
| Text overlays (without Design page) | High | Medium |
| Speed ramping (slow-mo / time stretch) | Medium | Medium |
| Audio ducking preview in compositor | Medium | Low-Medium |
| Keyframe animation (position, scale, opacity over time) | High | High |
| Template system (save a composition as a reusable template) | Medium | Medium |
| Batch export (multiple resolutions/formats in one go) | Low | Low |
| Colour correction / LUT application | Low | Medium |
| Social platform presets (auto-crop for IG Story vs Reels vs TikTok) | Medium | Low |

---

## Suggested Improvements

### Priority 1: Workflow speed (next session)

1. **Editable timecode fields in the inspector.** Let users type exact positions for At and Length. Low effort, high precision payoff.
2. **Keyboard trim shortcuts.** [ and ] for in/out, comma/period for frame nudge. These are the muscle-memory shortcuts every editor expects.
3. **Auto-select first clip for Tighten/B-roll.** If no item is selected but there is exactly one clip source, use it automatically. Remove the "select a clip first" friction.
4. **Render state persistence.** Move `renderJobs` state to the database. Survive deploys and restarts.

### Priority 2: Production reliability (next 2-3 sessions)

5. **Render queue.** One ffmpeg at a time. Others wait with a position indicator. Prevents CPU starvation.
6. **Video element pool cleanup.** Remove elements when sources are removed from the composition. Prevent memory leaks in long sessions.
7. **Render progress via WebSocket or SSE.** The current polling at 2-second intervals works but adds unnecessary requests. A push model is cleaner.

### Priority 3: Feature depth (future)

8. **Text overlay source kind.** A new source kind `text` that takes a string, font, size, colour, and position. Renders via ffmpeg's `drawtext` filter. Removes the need to create a Design page for a simple lower third.
9. **Speed property on items.** A `speed` field (0.25 to 4.0) that adjusts both `setpts` and `atempo` in the render graph. This covers slow-mo and time-lapse, which are the two most common CapCut uses after basic cutting.
10. **Audio ducking in the compositor.** The render graph does sidechaincompress, but the preview does not duck the music when speech is playing. Adding Web Audio `DynamicsCompressorNode` driven by the speech track's level would close this fidelity gap.
11. **Social format presets.** Buttons for "Instagram Story (9:16)", "YouTube (16:9)", "TikTok (9:16 with safe zones)", "LinkedIn (1:1)". Each preset sets size and overlays safe-area guides. Saves the manual size-select step.

---

## Alternative Approaches Considered

**Could the editor have been built on an existing open-source timeline library (e.g., OpenShot, Shotcut's MLT, or Remotion)?**

The design doc addresses this implicitly. The key constraint is that the same data model must drive both a browser preview (canvas + libass) and a server-side ffmpeg render. No existing browser NLE library provides this: they either produce their own rendering (Remotion targets headless Chrome, which is too slow for production video) or they are desktop applications. The shared-model approach, where the model is pure data and both sides interpret it, is the correct architecture for this constraint.

**Could the render have stayed multi-pass?**

No. The five-pass pipeline was the source of fidelity faults F1 through F9 in the original audit. Each pass re-encoded, losing quality and introducing timing drift. The single-pass `filter_complex` graph is the only approach that produces correct output from the composition model. The speed improvement (one encode vs five) is a bonus, not the motivation.

**Could the timeline UI have used a library like Wavesurfer.js or Plyr?**

Wavesurfer handles waveform visualisation but has no concept of multi-track timelines or drag-to-trim. The custom `CompositionTimeline.jsx` with its pointer-capture drag model, snap engine, and filmstrip rendering is the right approach. The timeline is the most complex UI component, and using a third-party abstraction would have traded one set of problems (building the interaction model) for another (fighting the library's assumptions about data model and rendering).

---

## Summary

The composition editor achieves its stated goal: one page, one editor, no compromises. The architectural foundation (shared pure model, single-pass render graph, agreement-tested preview) is solid and was built in the correct order. The main risks are operational (in-memory render state, no concurrency control) rather than architectural. The next round of investment should target workflow speed (fewer clicks per reel) and production resilience (render queue, state persistence) rather than new features.
