# Recorder polish roadmap — learning from Recordly (clean-room)

Status: proposal · Scope: OMI in-app screen recorder (`dev/platform`)
Author: strategy note for the video/recorder workstream

This plan is about **improving our own recorder** by borrowing *techniques and
ideas* from Recordly (an AGPL-3.0 open-source desktop recorder), **not** its
code. Everything below is either a standard, publicly-known technique (spring
smoothing, superellipse corners, gradient parsing, the WebCodecs pipeline) or
our own design. We keep our recorder; we do not adopt AGPL source.

References:

- Our recorder: `dev/platform/frontend/src/pages/RecordingsPage.jsx`
  (capture), `dev/platform/backend/src/services/editProcessor.js` +
  `videoWorker.js` (server-side ffmpeg edit pipeline), `routes/recordings.js`,
  `routes/edit.js`.
- Existing plans: `docs/omi/loom-replacement-plan.md`,
  `docs/omi/video-autoedit-plan.md`, `docs/omi/video-pipeline-learnings.md`,
  `docs/omi/video-worker.md`.

---

## TL;DR

- Recordly's "magic" (auto-zoom, cursor polish, styled frames, webcam bubble,
  timeline, MP4/GIF export) is **~80% browser-portable** — they do all
  composition in a single renderer that runs identically for preview and
  export. We can reproduce most of it in our web app + our existing ffmpeg
  pipeline.
- **One hard constraint decides the ceiling:** the whole auto-zoom/cursor-polish
  system is driven by a **cursor + click data track** captured natively. A
  browser tab recording *another* window/screen **cannot see the OS cursor**.
  So true "auto-zoom to where you clicked" is only fully possible when we record
  **our own web content in-tab** (we can read pointer events then). For general
  screen capture it becomes **manual/marker-based zoom**.
- Recommended path: a **phased hybrid**. Ship the high-impact, low-effort wins
  through the ffmpeg pipeline we already run (styled frame, MP4/GIF export,
  marker zooms). Only build a client-side shared canvas renderer if we decide we
  want the full Screen-Studio-grade spring-zoom polish.

---

## The one constraint, stated plainly

Recordly is a **desktop app**; it hooks the OS to record a 30 Hz normalized
`{timeMs, cx, cy, click, cursorShape}` track to a sidecar JSON, hides the real
cursor from the capture, and re-draws a synthetic one. That track is the input
to auto-zoom and cursor smoothing.

A **browser** can only get pointer events **while its own tab is focused**. So:

| Recording target | Cursor/click track? | Auto-zoom possible? |
|---|---|---|
| **Our own web app, recorded in-tab** | Yes (`pointermove`/`pointerdown`/`wheel` on our UI) | **Yes — full auto-zoom** |
| Another browser tab | No | Manual zoom only |
| A desktop window / whole screen | No | Manual zoom only |
| (Future) our own Electron wrapper | Yes (native hooks) | Yes |

**Implication:** we get the biggest wins by (a) doing all the *frame styling* and
*export* work that needs no cursor track, and (b) offering full auto-zoom
specifically for the "record a walkthrough of a web app" case, where we *can*
capture pointer events. Everything else is manual zoom markers.

---

## Two architectures (and the recommendation)

**A. Server-side (extend our existing ffmpeg pipeline).**
`editProcessor.js` already does trim/caption/scale/crop via ffmpeg in a worker.
We can add filter stages for: styled frame (pad + rounded mask + shadow +
background), webcam repositioning (overlay), speed regions, MP4/GIF export, and
*marker-based* zoom (ffmpeg `zoompan`/crop-interpolate).

- ✅ Reuses infrastructure we run today; no new client render engine.
- ✅ Deterministic, headless, scales on the worker.
- ❌ ffmpeg zoom is crude; no live WYSIWYG preview of effects; spring
  cursor-follow and synthetic-cursor smoothing are impractical.

**B. Client-side shared renderer (Recordly's approach).**
One canvas/WebGL renderer driven by a JSON project model, used for **both**
preview and export (export = decode with WebCodecs/`web-demuxer` → re-render every
frame → encode with WebCodecs → mux with `mediabunny`). No server needed.

- ✅ True WYSIWYG; spring zoom + cursor polish; the "premium" feel.
- ✅ Entirely browser-native libraries (WebCodecs, `mediabunny`, `gif.js`).
- ❌ Bigger build; Safari's WebCodecs H.264 is patchier (fall back to server
  ffmpeg or `ffmpeg.wasm`); CPU-heavy without hardware encode.

**Recommendation: phased hybrid.** Do Phase 1–2 server-side (fast value, fits
today's pipeline). Adopt the shared-renderer approach (Phase 3+) **only for the
effects that genuinely need per-frame, cursor-aware composition** (spring zoom,
synthetic cursor) — and there, copy Recordly's single most important discipline:
**one renderer for preview and export**, so what you see is what you get.

---

## Prioritized roadmap (impact × effort)

### Phase 1 — Free wins, no cursor track needed (server-side ffmpeg)

1. **MP4 (+ GIF) export.** *Highest impact / lowest effort.* We record WebM
   only; WebM is a compatibility footgun for sharing. Add an ffmpeg transcode
   to H.264 MP4 (and short-clip GIF) in `editProcessor`/`videoWorker`. Recordly
   captures/exports MP4 throughout for exactly this reason.
2. **Styled frame / background.** *High impact / low-moderate effort.* Composite
   the recording inside padding + rounded corners + soft shadow on a
   wallpaper/gradient/solid/blurred background. ffmpeg `pad` + rounded-mask
   overlay + a pre-rendered shadow PNG. Borrow two specifics from Recordly:
   - **Squircle (superellipse) corners**, not plain `border-radius` — visibly
     more "Apple". (Re-implement the superellipse formula; it's standard math.)
   - **Multi-layer soft shadow** — stack a few offset/blurred shadow layers
     rather than one, for a realistic drop shadow.
3. **Webcam repositioning + shape presets.** *Moderate impact / low effort.* We
   already composite a fixed bottom-left circle (`makeCameraComposite` in
   `RecordingsPage.jsx`). Add 9 anchor presets + custom X/Y, size, mirror,
   rounded-square (squircle) option, and shadow. Cheap upgrade to what we have.

### Phase 2 — Manual zoom + speed (server-side, still no cursor track)

4. **Marker-based zoom.** In the editor, let the user drop zoom regions on the
   timeline: `{startMs, endMs, depth, focus:{x,y}}`. Render via ffmpeg
   `zoompan`/animated crop with eased in/out. Borrow Recordly's **depth→scale
   ladder** ({1:1.25 … 6:5.0}) and named easing curves. This is the pragmatic
   substitute for auto-zoom on general screen capture.
5. **Speed regions (with correct audio retiming).** 0.25–2× regions. The
   fiddly-but-solved part is timeline↔source time mapping and speed-aware audio;
   Recordly's `clip`/`speed` model (source-time vs timeline-time conversion) is
   the reference design to reimplement.

### Phase 3 — Auto-zoom for the in-tab / web-app case (client-side capture)

6. **Cursor+click telemetry, but only where a browser can get it.** When the
   recording target is *our own web content in-tab*, listen to
   `pointermove`/`pointerdown`/`wheel` and record a **30 Hz normalized
   `{timeMs, cx, cy, click}` track** (copy Recordly's sidecar JSON *schema*, not
   code). Ship it alongside the video.
7. **Auto-zoom algorithm.** Reimplement the click-clustering: merge clicks
   `< ~2.5 s` apart into one zoom window, pad `±0.5 s`, focus on the strongest
   click, map to the depth ladder. This is pure math over the track from (6).
   Run it to *suggest* zoom regions the user can accept/tweak (Recordly
   auto-applies on fresh recordings; suggesting is safer for us).

### Phase 4 — Premium polish (only if we build the shared client renderer)

8. **Spring-smoothed cursor-follow zoom.** The "crown jewel": a damped-harmonic
   spring on scale/x/y, plus a **cursor-follow camera with safe-zone
   hysteresis** (only recenter when the cursor leaves an inner zone). Standard
   spring ODE — reimplement from the physics, don't copy.
9. **Synthetic cursor** (requires hiding the real one — only reliable in an
   Electron wrapper; browser risks a double cursor). Defer unless we ship a
   desktop wrapper.
10. **Annotations** (text/arrow/image/**blur-to-redact**) and **auto-captions**
    (word-level, styled) — captions can reuse our existing transcription
    (`recordingTranscribe.js` / ElevenLabs Scribe) instead of on-device Whisper.

---

## Specific techniques worth borrowing (all standard / re-implementable)

- **Cursor/click track schema:** `{ version, samples:[{timeMs, cx, cy, click, cursorType}] }`, cursor coords normalized 0–1, sampled ~30 Hz. Clean data contract; copy the shape.
- **Click-cluster → zoom** with a ~2.5 s merge gap and ±0.5 s padding.
- **Depth→scale ladder** and named easing curves for consistent zoom feel.
- **Squircle / superellipse** corners for frame + webcam (nicer than border-radius).
- **Multi-layer rasterized shadows** for realistic soft drop shadows, cheaply.
- **`1 / zoomScale` webcam sizing** so the bubble stays visually constant while the scene zooms.
- **Spring (damped harmonic oscillator)** for cursor/zoom smoothing, with an overshoot clamp.
- **Effect sizes normalized to a fixed reference width (~640 px)** so preview and export match at any resolution.
- **One renderer for preview and export** — the single most important architectural rule if we go client-side.
- **Defensive project-file validation/migration** — clamp every field, migrate legacy keys, on load.

## Don't bother / can't do in a browser

- **True global cursor/click track for arbitrary windows** — native only.
- **Hiding the real OS cursor** from a browser capture — unreliable; skip synthetic cursor until/unless we wrap in Electron.
- **Hardware-accelerated CUDA/native encode** — desktop only; our server ffmpeg covers headless encode.

---

## Suggested first sprint (2 weeks, all server-side, no new engine)

1. **MP4 export** from the existing pipeline (biggest compatibility win).
2. **Styled frame v1**: padding + squircle corners + one wallpaper/gradient +
   multi-layer shadow.
3. **Webcam presets**: 9 positions + size + mirror + rounded-square.

These three need no cursor track, ride our existing `editProcessor`/`videoWorker`
ffmpeg pipeline, and move the output from "raw Loom-ish clip" to "looks
designed" — which is 80% of the perceived gap to Recordly. Auto-zoom (Phase 3)
comes after, scoped to the in-tab web-app case where a browser can actually
track the cursor.
