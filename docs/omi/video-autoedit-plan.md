# OMI — AI Video Auto-Edit + QA Grading Loop

Scope/decision record for an end-to-end video editor inside the platform: raw
clips in → silence-trimmed, captioned, motion-graphic'd vertical edit out, with
an automated quality-grading loop that re-edits until it passes. Produces social
clips for October's own channels **and** for clients.

Status: **scope — awaiting sign-off before build.**

---

## Why

The whole edit — cut the dead air, add word-synced captions and motion graphics,
check it actually flows — is the slow, manual part of turning a talking-head
recording into a publishable vertical clip. This automates the loop the
"Higgsfield editor" video demonstrates: rough-cut → caption/graphics → grade →
re-edit until a score threshold, then deliver.

## What already exists vs what's new

| Capability | Today in OMI | This build |
|---|---|---|
| Remotion render infra | ✅ `remotionRender.js` bundles + renders compositions (StyleA/C/G ad clips) on demand | Reused to render the **caption + motion-graphic layer** over the cut |
| Template ad clips | ✅ `backend/remotion/*` (StyleA/C/G), `dev/video` | Different job — that's *generating* templated clips; this *edits raw footage* |
| Replicate connector | ✅ `connectors/replicate.js` | Reused for **transcription** (Whisper) and optional generative steps |
| HyperFrames | ✅ skills available (`hyperframes*`) | Used to author the motion-graphics layer |
| Silence-cut / captions / QA grading / clip ingest / export | ❌ none | **All new** |

So the render pipe exists; the **post-production pipeline** (ingest → cut →
caption → grade → export) is the new work.

## The pipeline

1. **Ingest** — AM uploads raw clips (or points at a Drive/Dropbox folder).
   Stored with the project; metadata (duration, resolution) probed via ffmpeg.
2. **Transcribe** — per-clip speech-to-text with word-level timings (Whisper via
   the Replicate connector). The transcript drives both silence detection and
   captions.
3. **Rough cut** — build an edit-decision list: drop silences/dead-space and
   filler (long pauses, "um"s if asked) using the word timings + ffmpeg
   `silencedetect`; concatenate the keep-segments into a tight cut. (Adobe
   `video_create_quick_cut` is an alternative engine for this step.)
4. **Caption + motion-graphics layer** — render word-synced captions and
   on-brand motion graphics over the cut via Remotion + HyperFrames, composited
   to a vertical (9:16) master.
5. **QA grade — the loop ("Higgsfield" step)** — sample frames + the caption
   track + transcript and have Claude (vision) grade three things the source
   video calls out: **clean cuts** (no mid-word/jarring jumps), **caption
   timing** (on screen when spoken), **pacing/flow**. Returns a **0–100 score +
   specific, addressable issues**. If `< 85`, the named issues feed back into the
   relevant stage (re-cut or re-time captions) and it re-grades. Capped at N
   iterations (e.g. 3) so it can't loop forever; on cap-out it surfaces the best
   attempt + the outstanding issues for the AM.
   - *Note:* the grader is a model-vision QA agent (provider-agnostic), not a
     dependency on Higgsfield's API. Higgsfield/other generators can be slotted
     into step 4 later if we want generative b-roll.
6. **Export** — on pass (≥85), deliver to Google Drive / Dropbox and/or hand the
   finished vertical to the **Social suite** for scheduling.

## Moving parts (new)

| Piece | Location |
|---|---|
| Orchestrator (runs the stages + grade loop, tracks state) | `backend/src/services/videoEditor.js` |
| Transcription | `backend/src/services/videoTranscribe.js` (Replicate Whisper) |
| Rough cut (EDL + ffmpeg concat) | `backend/src/services/videoRoughCut.js` |
| Caption/graphics render | extends `remotionRender.js` + a new Remotion composition |
| QA grader | `backend/src/services/videoGrade.js` (frame sampling + Claude vision) |
| Routes (`/api/video/*` — create project, upload, run, poll, export) | `backend/src/routes/video.js` |
| Storage + state | migration: `video_projects`, `video_clips`, `video_jobs` (pipeline stage, iteration, score, issues, output_url) |
| UI — "Video Studio" | `frontend/src/pages/ClientVideoPage.jsx` (upload → run → live pipeline progress → preview → export) |
| Infra | **ffmpeg on the box**; renders/transcription run as **async jobs** (fire-and-respond + poll, the existing site-audit/brand-voice pattern); clip + artifact storage (disk now, S3 if it grows) |

## PR slices (each independently mergeable)

1. **Ingest + scaffold** — `video_projects`/`video_clips` tables, upload route +
   Studio page, ffmpeg probe, async-job scaffold. No editing yet.
2. **Transcribe + rough cut** — Whisper transcription → silence EDL → ffmpeg
   concat → preview the rough cut. The "cut the dead air" win on its own.
3. **Captions + motion graphics** — Remotion caption track + HyperFrames
   graphics composited to a 9:16 master.
4. **QA grade loop** — `videoGrade.js` (vision QA → score + issues), the
   re-edit loop with an iteration cap, and the ≥85 pass gate.
5. **Export + Social hand-off** — deliver to Drive/Dropbox; "send to Social
   suite" to schedule the finished clip.

## Open questions / risks

- **Compute.** ffmpeg + Remotion + Chromium renders are CPU/RAM heavy. The
  current PM2 box may need a dedicated worker (or a sidecar) so a render doesn't
  starve the API. Decide before slice 2.
- **Home.** Its own "Studio" module vs a tab inside the Social suite. Leaning
  Studio (it's a production tool that feeds Social).
- **Transcription provider.** Replicate Whisper (reuses the existing connector)
  vs a dedicated STT API. Replicate first.
- **Cost/time per video** should be measured at slice 2 before committing to the
  full loop.

## Out of scope (v1)

- Generative b-roll / AI-generated footage (Higgsfield-style) — the loop is
  edit-and-grade on real footage first.
- Multi-speaker timeline editing, music beat-syncing, multicam.
- Auto-posting (we hand to the Social suite, which owns scheduling).
