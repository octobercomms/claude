# OMI Video Worker (auto-edit pipeline — slice 2)

The dedicated worker that drains `video_jobs` and runs the Video Studio
auto-edit pipeline. Code lives in `dev/platform/worker/`. It runs on its **own
box** (editing is CPU/IO-heavy and the media is untrusted — kept off the app
server), talks to the platform **only over HTTPS** with a shared `WORKER_TOKEN`,
and needs no database access or shared disk.

Pipeline: **ingest → roughcut → caption → grade → export**, with a QA grade loop
(score < 85 → tighten & re-cut, capped at 2 re-edits) before export.

## Worker API (platform side)
Mounted at `/api/video/worker` (in `backend/src/routes/videoWorker.js`), before
the global rate limiter and the session-authed `/api/video` router. Every call
carries `X-Worker-Token: <WORKER_TOKEN>` (constant-time checked; the API refuses
all requests until `WORKER_TOKEN` is set in the backend env).

- `POST /claim` → claims the next queued job (`FOR UPDATE SKIP LOCKED`) and
  returns it with the project + ordered clips.
- `GET /clips/:clipId` → stream a raw clip.
- `GET /projects/:id/brandkit` → fonts (with usage role) + palette for
  deterministic caption typography; `GET /brand-asset/:id/file` streams a font.
- `POST /clips/:clipId/probe` → ingest reports duration/dimensions.
- `POST /jobs/:id/complete` → advance the queue; for `stage:'grade'` it carries
  the score and the platform decides loop-back vs. export.
- `POST /jobs/:id/fail` → mark failed.
- `POST /projects/:id/output` → upload the finished master (the AM downloads it
  from the session-authed `GET /api/video/projects/:id/output`).

## Stages
- **ingest** — download each clip, `ffprobe`, report duration/dimensions.
- **roughcut** — trim dead air (`silencedetect`), normalise every kept segment
  to vertical 1080×1920, concat.
- **caption** — transcribe (OpenAI Whisper) → brand-styled ASS captions. Font =
  the client's uploaded brand font (body role), resolved by its real family name
  from the font's `name` table; colour = the brand palette. **Typography is
  deterministic from the brand kit, never model-chosen.** Skipped cleanly with
  no `OPENAI_API_KEY`.
- **grade** — sample frames + transcript → Claude scores 0–100. Under 85 (and
  under the re-edit cap) loops back to roughcut; else advances to export. Passes
  ungraded (85) with no `ANTHROPIC_API_KEY`.
- **export** — burn captions, encode the delivery master, upload, clean up.

A minimal box (just ffmpeg, no API keys) still produces a trimmed vertical cut;
add the keys for captions + the QA loop.

## Box setup
1. **System deps:** `ffmpeg` + `ffprobe` (`apt-get install -y ffmpeg`), Node ≥ 18.
2. **Platform:** set `WORKER_TOKEN` (any long random string) in the backend env.
3. **Worker:**
   ```bash
   cd dev/platform/worker
   npm install
   cp .env.example .env   # PLATFORM_URL, WORKER_TOKEN, optional API keys
   npm start
   ```
4. Keep it up with pm2/systemd (`pm2 start index.js --name video-worker`). Run
   several with distinct `WORKER_ID` to scale — claims are SKIP LOCKED so
   workers never collide.

## Status / next
- Slice 1 (#641): platform-side data model, project/clip/job queue, upload UI.
- Slice 2 (this): worker API + the worker box + all five stages, brand-kit
  typography, the QA re-edit loop, master upload + download.
- Smarter re-edit loop: the grade stage returns structured feedback
  (`{notes, adjust:{tighten, drop_intro}}`) stored on the project; the next
  roughcut acts on it (cut more dead air / drop a slow open) instead of a blunt
  re-trim. See `stages/{grade,roughcut}.js`.
- Delivery: when a project reaches `done`, the team is emailed (QA score +
  links to the Studio / direct download) — recipients = the client's report
  recipients ∪ `ALERT_EMAIL`. Drive/Dropbox/social delivery per `output_target`
  is the next delivery slice.
- Later: S3-backed clip/master storage; motion-graphics (Remotion) intro/outro
  + lower-thirds.
