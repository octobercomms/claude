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
    return { mode: 'app', path: `/recordings/${encodeURIComponent(key)}/blob` };
  },
  async saveBuffer(key, buf) {
    ensureDiskDir();
    await fs.promises.writeFile(diskPath(key), buf);
    return { size: buf.length };
  },
  // Move a file already on disk into the store, without reading it into memory.
  // multer streams the upload into tmpDir(), which is deliberately inside the
  // store directory so this is a same-filesystem rename: instant, atomic, and
  // no second copy of a 700MB recording. The copy+unlink fallback covers the
  // case where someone has mounted the store elsewhere.
  async saveFile(key, srcPath) {
    ensureDiskDir();
    const dest = diskPath(key);
    try {
      await fs.promises.rename(srcPath, dest);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      await fs.promises.copyFile(srcPath, dest);
      await fs.promises.unlink(srcPath).catch(() => {});
    }
    const st = await fs.promises.stat(dest);
    return { size: st.size };
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
  async getBuffer(key) {
    return fs.promises.readFile(diskPath(key));
  },
  async remove(key) {
    try { await fs.promises.unlink(diskPath(key)); } catch { /* already gone */ }
  },
};

// ── r2 driver ────────────────────────────────────────────────────────────────
// Cloudflare R2 via the S3-compatible API. The browser still posts the blob to
// our own endpoint (uploadDescriptor stays 'app' mode) and we stream it to R2
// server-side — a presigned direct-to-R2 PUT is a later optimisation that needs
// bucket CORS. Playback redirects to a short-lived presigned GET so the bytes
// come straight from R2. See docs/omi/loom-replacement-plan.md.
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

function r2Configured() {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID &&
            process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);
}

let _s3 = null;
function s3() {
  if (_s3) return _s3;
  _s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    // R2 needs path-style: the wildcard TLS cert (*.r2.cloudflarestorage.com)
    // only covers one label, so virtual-hosted style
    // (<bucket>.<account>.r2.cloudflarestorage.com) fails TLS verification.
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return _s3;
}
const bucket = () => process.env.R2_BUCKET;

const r2 = {
  uploadDescriptor(key /*, mime */) {
    return { mode: 'app', path: `/recordings/${encodeURIComponent(key)}/blob` };
  },
  async saveBuffer(key, buf, mime) {
    await s3().send(new PutObjectCommand({
      Bucket: bucket(), Key: key, Body: buf, ContentType: mime || 'video/webm',
    }));
    return { size: buf.length };
  },
  // Stream the file straight up rather than reading it in. S3 requires a length
  // on a non-multipart PUT, which we have from stat, so this needs no extra
  // dependency and holds one buffer at a time instead of the whole recording.
  // Single-PUT tops out at 5GB, well above what the route accepts.
  async saveFile(key, srcPath, mime) {
    const st = await fs.promises.stat(srcPath);
    await s3().send(new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: fs.createReadStream(srcPath),
      ContentLength: st.size,
      ContentType: mime || 'video/webm',
    }));
    await fs.promises.unlink(srcPath).catch(() => {});
    return { size: st.size };
  },
  // Playback for R2 goes through signedGetUrl → redirect, so openRead isn't hit.
  async openRead() { throw new Error('openRead is not used for the R2 store (playback redirects to a signed URL).'); },
  async signedGetUrl(key, ttlSec = 3600) {
    return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: ttlSec });
  },
  async getBuffer(key) {
    const out = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    return Buffer.from(await out.Body.transformToByteArray());
  },
  async remove(key) {
    try { await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key })); } catch { /* already gone */ }
  },
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
  saveFile: (...a) => active.saveFile(...a),
  // Where multer should spool an incoming upload. Inside the disk store so the
  // handover is a rename rather than a copy; created on demand.
  tmpDir() {
    const dir = path.join(DISK_DIR, 'tmp');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
    return dir;
  },
  openRead: (...a) => active.openRead(...a),
  signedGetUrl: (...a) => active.signedGetUrl(...a),
  getBuffer: (...a) => active.getBuffer(...a),
  remove: (...a) => active.remove(...a),
};
