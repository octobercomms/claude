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
  S3-compatible API; large recordings use a **presigned PUT** so the browser
  uploads straight to R2 without proxying gigabytes through the app server.

Swapping backends is an env change, not a code change — so the recorder works
end-to-end immediately (disk) and moves to R2 the moment the bucket is live.

### R2 provisioning checklist (the one part that needs you)

In the Cloudflare dashboard:

1. **R2 → Create bucket** — e.g. `omi-recordings` (private).
2. **R2 → Manage API Tokens → Create** — an **Object Read & Write** token scoped
   to that bucket. Note the **Access Key ID** and **Secret Access Key**.
3. Note your **Account ID** (R2 endpoint is
   `https://<accountid>.r2.cloudflarestorage.com`).
4. (Optional) Attach a custom domain / public bucket URL if we ever want direct
   CDN playback; not required — we serve via short-lived signed URLs.
5. Set these env vars on the backend:
   ```
   MEDIA_STORE=r2
   R2_ACCOUNT_ID=…
   R2_ACCESS_KEY_ID=…
   R2_SECRET_ACCESS_KEY=…
   R2_BUCKET=omi-recordings
   ```

Until those are set, `MEDIA_STORE` defaults to `disk` and everything still works.

## Data model

- `recordings` — `id`, `created_by` (user), `client_id` (nullable — a recording
  can be about a specific client or general), `title`, `storage_key`,
  `mime`, `duration_s`, `size_bytes`, `transcript` (nullable),
  `public_token` (unguessable), `status` (`uploading|ready|failed`),
  `created_at`.
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
3. **R2 + transcripts** — flip `MEDIA_STORE=r2` once the bucket is live; wire the
   Whisper transcript into the watch page.

## Out of scope (v1)

Threaded comments, emoji reactions, in-browser trim/edit, workspaces/folders,
and any client-facing (multi-tenant) exposure — this is an internal tool first.
Client-facing is a later decision (see the earlier "start internal, open later"
option).
