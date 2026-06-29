# Video pipeline — learnings from OpenMontage & claude-video

What we can learn from two external video projects and fold into OMI's own video
worker. **We are not vendoring either codebase** — see licences below. This is a
synthesis of *ideas* plus, where the licence allows, *adapted code*.

## The two references

### OpenMontage — `calesthio/OpenMontage` · **AGPLv3** ⚠️
An agentic video **production/generation** system (12 pipelines, 52 tools across
video/audio/graphics/analysis, Remotion + HyperFrames + FFmpeg). Driven by an AI
assistant reading YAML manifests + Markdown skills.

> **Licence: AGPLv3 — do NOT integrate its code into OMI.** The network-copyleft
> clause would oblige us to release OMI's source. We learn from its *design only*
> (ideas aren't copyrightable). Running it as a wholly separate internal tool to
> produce videos is lower-risk, but no AGPL code goes into `dev/platform`.

**Worth stealing (as ideas):**
- **Post-render self-review** — after render, ffprobe-validate, sample frames for
  black, check audio for silence/clipping, verify subtitle presence; only present
  if it passes. ✅ *Built — see below.*
- **Pre-compose validation gate** — block render if the plan/assets violate the
  delivery promise, before wasting compute.
- **Cost governance** — estimate before execute, per-action approval threshold
  ($0.50 default), total budget cap ($10 default), full decision audit trail.
- **Scored provider selection** — 7-dimension scoring (task fit, quality, control,
  reliability, cost, latency, continuity) with logged confidence.
- **"Animated PowerPoint" risk scoring** — guards against slideshow-y output
  (less relevant to us: we cut real clips, not slides).
- **Reference-video analysis** — paste a reference → analyse transcript/pacing/
  scenes → return 2–3 concepts with "what it keeps / what it changes" + cost
  estimate before generating anything.

### claude-video — `bradautomates/claude-video` · **MIT** ✅
A small, sharp "watch any video" skill: `yt-dlp` download → `ffmpeg` frame
extraction (auto-scaled FPS by duration) → transcript (native captions, else
Groq/OpenAI Whisper) → hand frames + timestamped transcript to Claude.

> **Licence: MIT — safe to adapt code**, with attribution.

**Worth stealing (code + ideas):** the whole *ingestion primitive* — it's exactly
what we'd need to let OMI **watch a reference or competitor video**. Smart frame
budgeting (30 frames ≤30s, up to 100 for longer), captions-first/Whisper-fallback,
time-window flags, multi-source (YouTube/TikTok/Reel/Vimeo/local).

## Where OMI is today (the `worker/` auto-edit pipeline)

Node worker on a separate box: **ingest → roughcut → caption → grade → export**.
- Trims dead air (ffmpeg silencedetect), normalises to vertical 1080×1920,
  concatenates; burns brand-styled ASS captions (Whisper word timings, font/colour
  from the client brand kit — deterministic, never model-chosen).
- **Grade** = Claude Vision scores the cut 0–100; if <85 and re-edits remain, loops
  back to roughcut with structured feedback (`{tighten, drop_intro}`).
- Delivers to download / Google Drive / Instagram Reel. 7-day retention.

OMI's strengths vs the references: **API-first, distributed worker, brand-locked
typography (no AI drift), and a real automated re-edit QA loop.** Gaps: motion
graphics (captions are static ASS), no reference-video analysis, no objective
render QC, no per-project cost cap, no transcript archival.

## Build plan (prioritised, licence-safe)

### ✅ 1. Objective post-render QC gate — *shipped*
Lifts OpenMontage's post-render self-review. New `worker/lib/qc.js`
`validateMaster()` runs cheap ffprobe/ffmpeg checks at export, **before upload**:
unreadable / too-short / no-video → fail; **mostly-black** (≥50%) → fail (≥20%
warn); **fully-silent** master → fail if no captions, warn if captioned. Error-level
issues fail the job (surfaced in `video_jobs.error`) so a broken render never
reaches a client. Each detector degrades to "skip" on error — no false failures.
Complements (doesn't replace) the subjective Claude-Vision grade, and costs nothing.

### 2. Reference / competitor-video analysis — *next, high value*
Adapt **claude-video** (MIT) as an ingestion primitive: a worker stage or service
that takes a URL/upload → `yt-dlp` (or our upload) → frame extraction (auto-scaled)
→ Whisper transcript → Claude. Then apply OpenMontage's framing: return 2–3
differentiated concepts with **"what it keeps / what it changes"** and a cost
estimate. Pairs naturally with the Social module's competitor tracking and with
ad/social creative. Use `callClaude({feature:'video_reference_analysis'})` so it's
cost-tracked and model-routable.

### 3. Per-project cost estimate + budget cap
We already log spend to `api_cost_events`. Add a per-project estimate (Whisper +
Vision calls) shown before "Auto-edit", and a configurable cap that halts the
re-edit loop early. Cheap governance win from OpenMontage's cost controls.

### 4. Pre-export validation gate
Before encode: assert clips ingested, captions present if the preset expects them,
audio track exists. Fail fast with a clear reason instead of producing a dud and
discovering it at QC.

### 5. Transcript archival
The caption stage discards `transcript.txt`. Persist it (e.g. on `video_projects`)
— useful for repurposing, search, and as grounding for the analysis feature.

### 6. Motion-graphics captions (bigger)
The `karaoke`/animated presets are placeholders (static ASS today). A Remotion/
HyperFrames overlay layer is the real lift — large, deferred. The repo already has
the hyperframes/remotion skills to draw on.

## Notes for whoever picks this up

- Keep the worker dependency-light: ffmpeg-first, APIs optional with graceful
  fallback (the existing pattern — no key → skip the stage, don't crash).
- Anything that calls an LLM goes through `callClaude({feature})` (see
  `docs/platform/integrations.md`).
- Respect the licences: OpenMontage = ideas only; claude-video = adapt with
  attribution.

---

_Last verified: 2026-06-28. Item 1 shipped; 2–6 proposed._
