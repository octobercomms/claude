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
//   localFile(key)                   { path, release } — a real local path for
//       ffmpeg and friends, without reading the object into memory. On disk
//       that is the stored file itself (read-only, release is a no-op); on r2
//       it is a streamed-down temp copy. Always call release() in a finally.
//   head(key)                        { size } or null — an existence check that never throws
//   signedGetUrl(key, ttlSec)        a URL to redirect playback to, or null → stream locally
//   remove(key)                      delete the object
//   keyFor(id, ext)                  canonical storage key for a recording

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');

const DRIVER = (process.env.MEDIA_STORE || 'disk').toLowerCase();

const MIME_EXT = {
  'video/webm': 'webm',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

// A MIME type may carry parameters — MediaRecorder reports
// 'video/mp4;codecs=avc1.42E01E,mp4a.40.2' — so strip them before the lookup.
// The recorder already sends the bare type, but an exact-match lookup made that
// a requirement nothing stated: a parameterised value fell through to 'webm'
// here, and in keyFor it fell through to the raw string and would have built a
// storage key of '<id>.video/mp4;codecs=avc1...'.
function baseType(mime) {
  return String(mime || '').split(';')[0].trim().toLowerCase();
}

function extFor(mime) {
  return MIME_EXT[baseType(mime)] || 'webm';
}

// The reverse: a servable content type for a key whose row we may not have.
const EXT_MIME = {
  webm: 'video/webm', mp4: 'video/mp4', mov: 'video/quicktime',
  gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', webp: 'image/webp',
};
// null, not a generic fallback, for an extension we do not know. A caller that
// has a better answer (the mime stored against the row) has to be able to use
// it, and an 'application/octet-stream' here is truthy enough to swallow that
// fallback and make a browser refuse to play a video it would have handled.
function contentTypeFor(key) {
  const ext = String(key || '').split('.').pop().toLowerCase();
  return EXT_MIME[ext] || null;
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
  // The stored file already is a local file, so hand back its own path and
  // leave it alone. Read-only: callers pass this to ffmpeg's -i or copy from
  // it, never write to or unlink it.
  async localFile(key) {
    const p = diskPath(key);
    await fs.promises.stat(p);            // throws ENOENT like openRead does
    return { path: p, release: async () => {} };
  },
  // { size } if the object is there, null if it is not. Never throws for a
  // missing key, so callers can use it as an existence check.
  async head(key) {
    try { const st = await fs.promises.stat(diskPath(key)); return { size: st.size }; }
    catch { return null; }
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
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
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
  //
  // putFile leaves the source where it is; saveFile is putFile plus the unlink
  // that every upload path wants. They are separate because the disk-to-R2
  // migration copies *from the live disk store*, where deleting the source
  // would destroy the only copy before the switch is thrown.
  async putFile(key, srcPath, mime) {
    const st = await fs.promises.stat(srcPath);
    await s3().send(new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: fs.createReadStream(srcPath),
      ContentLength: st.size,
      ContentType: mime || contentTypeFor(key) || 'application/octet-stream',
    }));
    return { size: st.size };
  },
  async saveFile(key, srcPath, mime) {
    const out = await r2.putFile(key, srcPath, mime);
    await fs.promises.unlink(srcPath).catch(() => {});
    return out;
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
  // Stream the object down to a temp file rather than through memory, so a
  // 700MB recording costs one disk write instead of 700MB of heap. release()
  // removes the whole temp directory.
  async localFile(key) {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'omi-media-'));
    const p = path.join(dir, path.basename(String(key)) || 'object');
    const release = async () => {
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    };
    try {
      const out = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
      await pipeline(out.Body, fs.createWriteStream(p));
    } catch (err) {
      await release();                    // never leave a temp dir behind on failure
      throw err;
    }
    return { path: p, release };
  },
  // { size } if the object is there, null if it is not. Never throws for a
  // missing key, so callers can use it as an existence check.
  async head(key) {
    try {
      const out = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
      return { size: Number(out.ContentLength) };
    } catch { return null; }
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
  // Named drivers, for the one job that has to talk to both at once: copying
  // every object from disk into R2 before the switch is thrown
  // (scripts/media-to-r2.js). Everything else goes through `active`.
  drivers: { disk, r2 },
  r2Configured,
  contentTypeFor,
  baseType,
  extFor,
  keyFor(id, mimeOrExt) {
    // Takes either a MIME type or a bare extension, so fall through to the
    // argument itself only when it looks like an extension.
    const ext = MIME_EXT[baseType(mimeOrExt)]
      || (/^[a-z0-9]{1,5}$/i.test(String(mimeOrExt || '')) ? String(mimeOrExt) : 'webm');
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
  localFile: (...a) => active.localFile(...a),
  head: (...a) => active.head(...a),
  remove: (...a) => active.remove(...a),
};
