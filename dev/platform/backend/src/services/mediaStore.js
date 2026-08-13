// Storage abstraction for recordings (and any future large media). Two drivers
// behind one interface so the recorder works end-to-end today on local disk and
// moves to Cloudflare R2 by setting env vars — no code change at the call sites.
//
//   MEDIA_STORE=disk   (default) — files under backend/recordings-store/,
//                       streamed by the app (supports HTTP range for seeking).
//   MEDIA_STORE=r2     — Cloudflare R2 via the S3-compatible API. Wired in
//                       phase 3 (see docs/omi/loom-replacement-plan.md); the
//                       R2_* env vars drive it. Until then `disk` is used.
//
// Interface (all async where I/O):
//   uploadDescriptor(key, mime) → how the browser should deliver the bytes:
//       { mode: 'app', path }        POST the blob to our own endpoint (disk)
//       { mode: 'presigned', url }   PUT straight to R2 (r2)
//   saveBuffer(key, buf)             server-side write (disk upload endpoint, worker)
//   openRead(key, range)             { stream, size, start, end, mime } for playback
//   signedGetUrl(key, ttlSec)        a URL to redirect playback to, or null → stream locally
//   remove(key)                      delete the object
//   keyFor(id, ext)                  canonical storage key for a recording

const fs = require('fs');
const path = require('path');

const DRIVER = (process.env.MEDIA_STORE || 'disk').toLowerCase();

const MIME_EXT = {
  'video/webm': 'webm',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

function extFor(mime) {
  return MIME_EXT[String(mime || '').toLowerCase()] || 'webm';
}

// ── disk driver ──────────────────────────────────────────────────────────────
const DISK_DIR = path.join(__dirname, '../../recordings-store');
function ensureDiskDir() {
  try { fs.mkdirSync(DISK_DIR, { recursive: true }); } catch { /* ignore */ }
}
function diskPath(key) {
  // Keys are our own generated tokens + a known extension — no user input in the
  // path — but normalise defensively so a key can never escape the store dir.
  const safe = String(key).replace(/[^\w.\-/]+/g, '_').replace(/\.\.+/g, '_');
  return path.join(DISK_DIR, safe);
}

const disk = {
  uploadDescriptor(key /*, mime */) {
    // Browser posts the recorded blob to our authed finalize-upload endpoint.
    return { mode: 'app', path: `/api/recordings/${encodeURIComponent(key)}/blob` };
  },
  async saveBuffer(key, buf) {
    ensureDiskDir();
    await fs.promises.writeFile(diskPath(key), buf);
    return { size: buf.length };
  },
  async openRead(key, range) {
    const p = diskPath(key);
    const st = await fs.promises.stat(p); // throws if missing
    const size = st.size;
    let start = 0, end = size - 1;
    if (range && range.start != null) {
      start = range.start;
      end = range.end != null ? range.end : end;
      if (start >= size) { const e = new Error('Range not satisfiable'); e.code = 'RANGE'; throw e; }
      if (end >= size) end = size - 1;
    }
    const stream = fs.createReadStream(p, { start, end });
    return { stream, size, start, end };
  },
  async signedGetUrl() { return null; }, // disk streams locally — no external URL
  async remove(key) {
    try { await fs.promises.unlink(diskPath(key)); } catch { /* already gone */ }
  },
};

// ── r2 driver (phase 3) ──────────────────────────────────────────────────────
// Kept as an explicit not-yet-configured stub so the swap is a small, isolated
// change once the bucket + credentials exist. See the provisioning checklist in
// docs/omi/loom-replacement-plan.md.
function r2Configured() {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID &&
            process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);
}
const r2NotReady = () => { throw new Error('R2 media store not configured (set R2_* env vars).'); };
const r2 = {
  uploadDescriptor: r2NotReady,
  saveBuffer: r2NotReady,
  openRead: r2NotReady,
  signedGetUrl: r2NotReady,
  remove: r2NotReady,
};

// Select the active driver. Fall back to disk if r2 is asked for but not yet
// configured, so a half-set env never takes the recorder offline.
const active = (DRIVER === 'r2' && r2Configured()) ? r2 : disk;

module.exports = {
  driverName: active === r2 ? 'r2' : 'disk',
  extFor,
  keyFor(id, mimeOrExt) {
    const ext = MIME_EXT[String(mimeOrExt || '').toLowerCase()] || (mimeOrExt || 'webm');
    return `${id}.${ext}`;
  },
  uploadDescriptor: (...a) => active.uploadDescriptor(...a),
  saveBuffer: (...a) => active.saveBuffer(...a),
  openRead: (...a) => active.openRead(...a),
  signedGetUrl: (...a) => active.signedGetUrl(...a),
  remove: (...a) => active.remove(...a),
};
