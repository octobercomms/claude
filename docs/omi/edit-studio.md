# Edit studio — guided video editor

_Phase 1 shipped 2026-07-21. Follows the OpenCut evaluation
(`opencut-evaluation.md`): build the three jobs an AM actually uses as a guided,
server-side tool now; a full timeline editor (embed) can come later._

## What it is

A guided video editor in OMI (nav: **Edit**), covering the CapCut basics October
actually uses:

- **Trim** — cut to a start/end.
- **Clean audio** — ffmpeg denoise (`afftdn`) + rumble highpass + loudness
  normalise (`loudnorm`, EBU R128 −16 LUFS). Free, no external calls.
- **Auto-captions** — Whisper → `.srt`, burned onto the video (readable
  social-caption style) **and** offered as a downloadable `.srt`.

Everything renders **server-side with ffmpeg** on October's own box — no footage
is uploaded to a third party (the privacy point of moving off CapCut). Only
captions cost anything (~$0.006/min of audio via Whisper).

## Flow

Upload a clip → tick trim / clean audio / captions → **Render edit**. The job is
queued and rendered inline; the UI polls until it's **Ready**, then offers
**Download MP4** and **Download .srt**. Past edits list with retry/delete.

## Architecture

- **`migrations/128_edit_studio.sql`** — `edit_jobs` table (one row per job;
  doubles as the work queue). Source + rendered files on disk per client.
- **`services/editJobs.js`** — data access, queue (claim/complete/fail, SKIP
  LOCKED), and per-client on-disk storage served through an authed route.
- **`services/editProcessor.js`** — the ffmpeg/Whisper pipeline:
  - Pass 1: trim (`-ss`/`-t`) + optional audio filters → `base.mp4`.
  - Pass 2 (captions): extract audio → Whisper `response_format=srt` → burn with
    the `subtitles` filter (ASS `force_style`) → final mp4 + `.srt`.
  - Inline queue drain (`kick()` on create/retry), like `swipeProcessor`.
- **`routes/edit.js`** — agency-only (read-only client logins blocked; captions
  spend). Upload/list/get(poll)/retry/delete + client-scoped file serve.
- **Frontend `ClientEditPage.jsx`** + nav link (Layout) + route (App) — upload,
  controls, cost estimate, polling, results, history.

## Dependencies / notes

- Needs **ffmpeg** (with `libass` for caption burn, `afftdn` for denoise) on the
  platform box — the same binary the swipe file already shells out to. If it's
  missing, jobs fail with a clear "video tools aren't available" message.
- Captions need `OPENAI_API_KEY` (Settings → AI) — same key as the swipe file.
- **Live smoke test outstanding:** ffmpeg isn't runnable in CI, so the render
  commands were validated by construction. First real run on the server confirms
  the ffmpeg build has the needed filters.

## Phase 2 (shipped 2026-07-22)

- **Combine clips** — upload several clips (or drop them in); they're normalised
  to the first clip's shape (scale + letterbox, uniform codec/fps, silent track
  added where missing) and concatenated into one video, which then flows through
  the same trim/clean/caption render. `combineClips()` in editProcessor; ordered
  `clips` jsonb on the job (migration 129).
- **Reopen** ("Edit again") — re-edit a saved job without re-uploading: the
  stored source clip(s) are copied to fresh files and a new job is queued with
  the tweaked ops (`editJobs.reopen`, `POST /edit/:id/reopen`).
- **Rename** — an optional `name` per job so the history stays scannable
  (`PATCH /edit/:id`).

## Later (not built)

- Full timeline editor via an embedded OpenCut (see `opencut-evaluation.md`).
- More caption styles / positions; music bed; simple transitions; a probe step
  to skip audio filters on silent clips; per-clip trim before combining.
