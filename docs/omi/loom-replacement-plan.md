# In-OMI screen recorder — Loom replacement (internal)

A lightweight screen/camera recorder built into the OMI admin, to replace paid
Loom seats after their price increase. **Internal-only** (October staff record
client walkthroughs and updates, send a link, see if the client watched).
Hosting on **Cloudflare R2**. Advisory nothing here — it's a create-and-share
tool for our own use.

## Why this is a small build

The platform already owns the *entire back half* of Loom (see
`docs/omi/video-*` and the Video Studio pipeline). What Loom does that we don't
yet have is only three things:

| Piece | Status before this | Plan |
|-------|--------------------|------|
| Browser screen/cam capture | **missing** | native `getDisplayMedia` + `getUserMedia` + `MediaRecorder` — no paid service |
| Durable hosting/CDN | local disk only | Cloudflare R2 (S3-compatible), behind a small storage abstraction |
| Per-view analytics | **missing** | `recording_views` table + a play/progress ping |

Everything else is reused:

- **Transcode** — the existing ffmpeg worker (`worker/lib/ffmpeg.js`) normalises
  the recorded WebM to MP4 with `+faststart` for reliable playback.
- **Transcripts + captions** — the existing Whisper worker
  (`worker/lib/whisper.js`) gives us transcripts for free (Loom upcharges).
- **Share links** — the HMAC signed-URL mechanism (`videoProjects.signMasterUrl`
  / `verifyMasterSig`) and the token-gated public viewer pattern
  (`public_token` → unauth React page, e.g. `PublicCoveragePage.jsx`,
  `routes/prPortal.js`, `routes/publicSnapshot.js`).

## Storage: Cloudflare R2

R2 chosen for cost (≈$0.015/GB/mo, **zero egress fees**) and because we're
already on Cloudflare. Storage sits behind a thin driver interface
(`services/mediaStore.js`) with two backends:

- `disk` — the default, used in dev/test and as a zero-infra fallback. Serves
  from a local dir like the existing `video-outputs/`.
- `r2` — activated when the `R2_*` env vars are set. Uploads via the
  S3-compatible API. The browser still posts the blob to our own endpoint and
  the backend streams it up (`uploadDescriptor` returns `mode: 'app'` on both
  drivers); a presigned direct-to-R2 PUT is a later optimisation that needs
  bucket CORS. Playback redirects to a short-lived presigned GET, so the bytes
  themselves come straight from R2.

Swapping backends is an env change, not a code change — so the recorder works
end-to-end immediately (disk) and moves to R2 the moment the bucket is live.

### R2 provisioning checklist (the one part that needs you)

In the Cloudflare dashboard:

**Account ID: `24e942f4e3f7ee55504eabf271f206a8`** — the one the R2 page itself
shows, under Account Details.

It is worth saying where this did not come from. An earlier version of this
line carried `ead9401db49f4dd778962bedfaa21cff`, read off the Cloudflare Pages
check URL on an OMI pull request, with a note to confirm it against the R2
page. They are different accounts: the Pages project that builds on every PR is
the **Events app**, not OMI, which `agent-guide.md` already warns is a red
herring — and it turns out that holds for its account id too, not just its
preview URL. Take this value from the R2 overview page, nowhere else.

1. **R2 → Create bucket** — `omi-recordings`. **Done, 30 Oct 2026**: the bucket
   exists and reads 0 objects / 0 B, which is correct until the migration runs.
   Leave public access off: the
   watch route hands out short-lived signed URLs, and a public bucket would
   make every recording readable to anyone who guessed an object key.
2. **R2 → Manage API Tokens → Create** — an **Object Read & Write** token scoped
   to that one bucket, not to all buckets. The platform writes, reads, signs and
   deletes objects; it never creates or lists buckets, so an admin token buys
   nothing and costs blast radius. Note the **Access Key ID** and **Secret
   Access Key** — the secret is shown once.

   Do not paste either into a chat. They go straight into
   `dev/platform/backend/.env` on the box; `scripts/r2-preflight.js` then
   confirms they work without printing them.
3. (Optional) Attach a custom domain / public bucket URL if we ever want direct
   CDN playback; not required — we serve via short-lived signed URLs.
4. Put these in `dev/platform/backend/.env` on the box. **Note that
   `MEDIA_STORE` stays `disk` at this point** — see the switch order below.
   Setting it to `r2` before the bytes have been copied makes every existing
   share link 404.
   ```
   MEDIA_STORE=disk
   R2_ACCOUNT_ID=24e942f4e3f7ee55504eabf271f206a8
   R2_ACCESS_KEY_ID=0123456789abcdef0123456789abcdef
   R2_SECRET_ACCESS_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
   R2_BUCKET=omi-recordings
   ```

   The two keys are shown here at their real lengths — 32 hex characters and
   64 — rather than as `…` or `<the Access Key ID>`. An earlier version of this
   section used a bracketed placeholder and it went into the file verbatim: the
   preflight answered `Credential access key has length 37, should be 32`,
   which is the check working, but it cost a round trip. A placeholder that
   looks like the thing cannot be pasted by mistake.

   The **Access Key ID stays visible** in Cloudflare under R2 → Manage R2 API
   Tokens; only the secret is shown once. Getting the key wrong does not mean
   regenerating the token.

Until those are set, `MEDIA_STORE` defaults to `disk` and everything still works.

### Thrown — 30 Oct 2026

R2 is live. `MEDIA_STORE=r2` on the box, the switch run in the order below with
Daniel at the keyboard. What it actually looked like, so the next person knows
what "normal" is:

| | |
|---|---|
| bucket | `omi-recordings`, account `24e942f4e3f7ee55504eabf271f206a8` |
| preflight | 7 of 7 after one correction (below) |
| copied | 11 objects, 1.67 GB, 0 already present |
| status after | every referenced object present under all six key columns |
| playback | confirmed by hand on a client share link |

Two things worth keeping:

**The access key went in as placeholder text.** This file said
`R2_ACCESS_KEY_ID=<the Access Key ID>` and that is what landed in `.env`. The
preflight answered `Credential access key has length 37, should be 32` — the
check doing its job, and a cheap failure, but the placeholder is now a string
of the right shape and length so it cannot be pasted by mistake.

**The box runs Node 20.20.2.** The AWS SDK v3 warns on every script run that
versions published after the first week of January 2027 will require Node 22.
Nothing is broken today and nothing about R2 depends on it. It needs scheduling
before then.

The disk copies are still there. `--prune-verified` frees them when there has
been enough time to be sure; there is no hurry.

**And one thing the copy made visible.** 997.4 MB of the 1.67 GB was a single
MP4 export of a 33.3 MB recording. Not corruption and not the key collision —
a legitimate render, made expensive by a quality target with no ceiling.
`exportRecording` used `-crf 20` and no `-maxrate`, so on a source that
arrived bitrate-capped and full of artefacts, x264 spent whatever it took to
reproduce them. Measured on a 60 s 1080p30 high-entropy source: 313.7 MB
uncapped, 60.8 MB at 8 Mbps. On a realistic near-static screen recording the
ceiling is a no-op — 1.78 MB either way, SSIM identical to six decimals.
`mp4Args` now carries `-maxrate 8M -bufsize 16M`, guarded by
`tests/recording-export.test.js`.

`scripts/prune-legacy-exports.js` clears the ones already stored under the
pre-`.export.` scheme, refusing any key the recording is itself served from.
An export is a render: deleting one costs a minute of ffmpeg next time
somebody asks for the file.

### The order to throw the switch in

Setting `MEDIA_STORE=r2` does **not** move anything. The drivers share one
interface and nothing else, so the moment the active driver changes, every key
already on disk reads as missing and every existing share link 404s. The bytes
have to go first, which is what `scripts/media-to-r2.js` is for.

1. Set the four `R2_*` vars in the backend's `.env` on the box and **leave
   `MEDIA_STORE=disk`**. The platform keeps serving from disk; the scripts only
   need the credentials.

   The box, from `update.sh` and `platform-deploy.yml`:

   | | |
   |---|---|
   | source | `/opt/october-source` |
   | backend | `/opt/october-source/dev/platform/backend` |
   | env file | `/opt/october-source/dev/platform/backend/.env` |
   | reload | `pm2 reload /opt/october-source/dev/platform/backend/ecosystem.config.js --update-env` |

   `.env` is gitignored, so `git reset --hard origin/main` on every deploy
   leaves it alone. Set it once.

   The running backend only re-reads it on `pm2 reload --update-env`; the
   scripts below read it themselves on each run, so the reload is only needed
   before step 6.
2. `node scripts/r2-preflight.js` — proves the bucket and token do everything
   playback needs: write, read the size back, read the bytes back, stream down,
   sign a playback URL and fetch it, serve a byte range from it, delete. It
   writes one 64KB object under `__omi-preflight/` and removes it. It never
   prints the secret. Every check is shown to catch its own failure in
   `tests/r2-preflight.test.js`, including the two that look like success from
   outside: a store that ignores `Range`, and one that answers a range with 200
   instead of 206, either of which leaves playback working and seeking silently
   broken.
3. `node scripts/media-to-r2.js` — a dry run. It lists every object the database
   references, what it would copy, and anything already missing from the store.
   Nothing is written.
4. `node scripts/media-to-r2.js --commit` — copies, reading back each object's
   length from R2 and failing the object if it does not match. Re-runnable: an
   object already there at the right length is skipped, so an interrupted run
   carries on where it stopped.
5. `node scripts/media-store-status.js` — confirms what is referenced, what is
   present, and that nothing is missing.
6. Only now set `MEDIA_STORE=r2` and reload. Playback starts redirecting to
   signed R2 URLs.
7. Watch a share link, then `node scripts/media-store-status.js` again.
8. Days later, once you are satisfied:
   `node scripts/media-to-r2.js --commit --prune-verified` frees the disk
   copies. It only ever removes an object whose length in R2 has been read back
   and matches, and it removes nothing on a dry run. There is no hurry — the
   duplicate costs disk, and disk is the thing you have.

`tests/media-to-r2.test.js` drives that verify-then-delete ordering against a
store that lies about what it wrote, because before the switch is thrown the
disk copy is the only copy of every walkthrough ever sent to a client.

## Data model

- `recordings` — `id`, `created_by` (user), `client_id` (nullable — a recording
  can be about a specific client or general), `title`, `storage_key`,
  `mime`, `duration_s`, `size_bytes`, `transcript` (nullable),
  `public_token` (unguessable), `status` (`uploading|ready|failed`),
  `created_at`.
  - `storage_key` is the recorder's own capture: the thing to download, edit or
    re-encode. It is never deleted or rewritten in place.
  - `play_key` / `play_status` (migration 220) — the remuxed, seekable copy the
    public watch stream serves. NULL means "serve the original", which is the
    state of anything recorded before the remux existed and of anything whose
    remux failed.
  - `mp4_key` / `gif_key` / `export_status` (migration 173) — on-demand
    re-encodes for handing someone a file. Different job from `play_key`: those
    are a real transcode, this is a lossless container rewrite.
- `recording_views` — `id`, `recording_id`, `viewed_at`, `watch_seconds`,
  `ip_hash` (hashed, not raw), `referrer` (nullable). One row per view/progress
  ping → "did they watch it, and how much".

## Endpoints

Authed (`/api/recordings`, behind session auth):
- `POST /` → create a recording row, return `{ id, upload }` where `upload` is
  either a presigned PUT (r2) or an app upload URL (disk).
- `POST /:id/finalize` → mark ready, store duration/size, enqueue transcript.
- `GET /` → my recordings library (list, newest first).
- `GET /:id` → detail incl. view stats.
- `DELETE /:id` → remove recording + object.

Public (mounted before auth, like the other portals):
- `GET /api/public/watch/:token` → recording metadata + a short-lived signed
  playback URL.
- `POST /api/public/watch/:token/view` → analytics ping (start + progress).

Plus a public React page at `/watch/:token` (unauth route in `App.jsx`) — the
player, title, transcript toggle, and the view ping.

## Frontend (admin)

- **Recorder** — pick screen + optional camera + mic, record, preview, title,
  upload, copy share link. Native `MediaRecorder`; records WebM/H.264 and lets
  the transcode step normalise (handles Safari's weaker recorder).
- **Library** — "My recordings": thumbnail, title, date, views, share link,
  delete. Lives in the admin side of OMI (staff-only, not a client surface).

## Phasing

1. **Foundation** — data model, `mediaStore` (disk + r2 drivers), authed +
   public routes, mounting. (disk-backed, fully testable now)
2. **Recorder + watch UI** — the admin recorder + library, the public
   `/watch/:token` player + view ping.
3. **R2 + transcripts** — move the bytes, then flip `MEDIA_STORE=r2` (the order
   matters; see "The order to throw the switch in" above). Wire the Whisper
   transcript into the watch page. Transcripts shipped (3b below). **R2
   has not been switched on** — the driver, the migration script and the status
   reporter are all written and tested, but the bucket does not exist yet, so
   every recording is still served off the box's own disk and uplink. That is
   the single largest thing left in the playback path.
4. **Playback (shipped, 30 Oct 2026)** — see "Why playback was slow" below.

## Transcripts (Phase 3b — shipped)

Recordings are transcribed automatically after upload/import by a self-contained
backend path (`services/recordingTranscribe.js`): pull the stored file → extract
a small mono 16 kHz mp3 with **ffmpeg** → OpenAI **Whisper** → store on
`recordings.transcript` (the watch page already shows it). It's fired
fire-and-forget from the upload/import routes and **no-ops cleanly** if the
prerequisites aren't present. A `POST /recordings/:id/transcribe` endpoint (and a
per-row "Transcribe" button) lets you retry or backfill migrated videos.

**Two backend prerequisites for transcripts to populate:**

- `OPENAI_API_KEY` set in the backend env (same key the video worker uses).
- `ffmpeg` installed on the app server (`apt-get install -y ffmpeg`). Without it,
  only recordings already under 25 MB can be transcribed (the raw file is sent
  directly); longer ones are skipped. With it, any length works.

Recordings still function fully without either — transcripts just stay empty.

## Why playback was slow (fixed 30 Oct 2026)

A share link took a long time to start playing. Five separate causes, found by
measuring rather than guessing, in the order they cost the most:

**1. No CDN.** `MEDIA_STORE` is still `disk`, so every byte comes off the one
box over one uplink, competing with every API request OMI serves. Unfixed: it
needs the bucket. See "The order to throw the switch in" above. Everything
below is fixed.

**2. Caching was switched off.** The stream sent
`Cache-Control: private, max-age=0, no-store`, which forbids the browser from
keeping a single byte. Scrubbing back ten seconds, replaying, or reloading
re-downloaded the whole file. Now `private, max-age=604800, immutable`:
`private` rather than `public` because the share token is the only secret
protecting a recording, so a shared cache keyed on that URL would hold copies
that deleting the recording cannot reach.

**3. The file had no index at the front.** MediaRecorder streams bytes out as it
records, so it cannot go back and write one. Measured against real Chromium
captures:

| | before | after the remux |
|---|---|---|
| mp4 | `ftyp moov(695) moof mdat moof mdat mfra` — index last | `ftyp moov(2740) mdat` — index first |
| webm | **no Cues element at all**, `duration=N/A` with the whole file in hand | Cues at byte 102, `duration=5.971` |

`services/recordingRemux.js` runs `-c copy` with `+faststart` (mp4) or
`-cues_to_front 1` (webm) after upload: no re-encode, seconds to run, about 400
bytes larger. The result is stored under `play_key` and is what the watch
stream serves; the original capture is untouched and stays what Download and
Send to editor use. `play_key` NULL falls back to the original, so a failed
remux costs seek quality and nothing else. `scripts/remux-backfill.js` does the
back catalogue.

**4. A recipient downloaded the whole admin app first.** `WatchPage` was a
static import in `App.jsx`, so `/watch/:token` fetched 2.69MB of JavaScript
(718KB gzipped) covering every OMI screen, and parsed it, before the `<video>`
element existed. Now every page except the three arrival pages (login, home,
watch) is a lazy chunk: **287KB raw, 83KB gzipped**, an 88% reduction.
The player also takes its `src` from the token instead of waiting for the
metadata response, which removed a round trip before the first video byte.
`tests/shareLinkWeight.test.mjs` fails if a static import of an admin page
comes back.

**5. nginx buffered the video through its own disk.** The stream fell through to
`location /api/`, where `proxy_buffering` is on by default, so nginx spilled the
response to a temp file while proxying: the box read a 200MB file off disk and
wrote most of it back, per view. `/api/public/watch/` now has its own location
with `proxy_buffering off`.

### What capture does now

The recorder used to pass a frame rate and nothing else, so it captured at the
display's native resolution — 3840x2160 on a 4K monitor. That reads like a
quality setting and is the opposite of one: Chrome's MediaRecorder default
bitrate is a flat 2.5 Mbps that [does not scale with
resolution](https://blog.addpipe.com/mediarecorder-video-bitrates/), so a 4K
capture was the same number of megabytes as a 1080p one with four times as many
pixels to spend them on. Screen text went soft and the file was no smaller for
it.

`utils/captureSettings.js` now caps capture at 1920x1080 with `max` (never
`ideal`, which would upscale a small screen) and states 2.5 Mbps rather than
inheriting it. Same file size as before, four times the budget per pixel. About
**20 MB a minute**, so a ten-minute walkthrough is roughly 200 MB.

### Memory

`recordingExport`, `recordingTranscribe` and `edit/from-recording` each read the
whole recording into a Buffer and then wrote it straight back out to a file —
700MB of heap for a 700MB recording, on the box that serves every request.
`mediaStore.localFile(key)` replaces that: on disk it hands back the stored
file's own path and copies nothing; on R2 it streams the object down to a temp
file. Callers release it in a `finally`.

## Out of scope (v1)

Threaded comments, emoji reactions, in-browser trim/edit, workspaces/folders,
and any client-facing (multi-tenant) exposure — this is an internal tool first.
Client-facing is a later decision (see the earlier "start internal, open later"
option).
