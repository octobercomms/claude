// Keeping generated creative.
//
// Every image generator returns a URL on its own CDN — Ideogram, Replicate,
// fal, Adobe. Those URLs expire. Replicate's outputs go after an hour,
// Ideogram's after a day or so, and nobody is told when it happens: the
// record in ad_creative_images still holds a perfectly well-formed link that
// now answers 404.
//
// What that cost, before this existed:
//
//   - Launch's export zip wrote the asset into MISSING.txt. A batch approved
//     on Monday could be undownloadable by Friday, and the AM found out at
//     the moment they needed the files.
//   - The client approval page showed a broken image where the ad was.
//   - Resize and the fan-out take an existing image as their source, so an
//     expired link meant re-generating the original, and paying again, to
//     reshape work already done.
//
// So nothing generated is left on someone else's CDN. The bytes are fetched
// once, at generation time, written under the client's own upload folder, and
// the row records the local path. The provider URL is kept alongside it in
// source_url: it is still the better thing to retry from while it lives, and
// it says which provider produced the file.
//
// Uploads already worked this way (routes/adCreatives.js → /upload), as does
// adResize. This brings generated output in line with both.

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads');

// A render is a few hundred KB; a 10-second video clip is tens of MB. The
// ceiling is here so a provider answering with something enormous cannot
// exhaust the box's memory, and matches the upload route's own limit.
const MAX_BYTES = 100 * 1024 * 1024;
// Generous, because this runs inside the generation request and a provider
// CDN serving a fresh render can be slow on the first read.
const TIMEOUT_MS = 120000;

// What the stored file is called, by what the server said it is. The URL's
// own extension is the fallback: a signed CDN link often carries the real
// name under a query string.
const EXT_BY_TYPE = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};

function extFor(url, contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (EXT_BY_TYPE[type]) return EXT_BY_TYPE[type];
  const clean = String(url || '').split('?')[0];
  const ext = path.extname(clean).toLowerCase();
  if (/^\.(png|jpe?g|webp|gif|avif|mp4|mov|webm)$/.test(ext)) return ext;
  return type.startsWith('video/') ? '.mp4' : '.png';
}

// Only an image or a video is stored. A provider answering with JSON or an
// HTML error page is a failure, not an asset: writing it to disk would
// produce a file that serves as a broken image forever, which is harder to
// notice than a link that 404s.
function isMedia(contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  return type.startsWith('image/') || type.startsWith('video/');
}

// Private and link-local addresses are refused.
//
// The URL being fetched comes from a provider's API response, not from a
// user, so this is not the usual SSRF shape. It is still a request this
// server makes to a host named by a third party, and one of those APIs
// returning "http://169.254.169.254/latest/meta-data/" would otherwise have
// the box fetch its own cloud credentials and write them into a client's
// folder as a .png.
const BLOCKED_HOST = /^(localhost|127\.|0\.0\.0\.0|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?f[cde])/i;

function checkUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new Error('not a URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`refusing to fetch a ${parsed.protocol} URL`);
  }
  if (BLOCKED_HOST.test(parsed.hostname)) {
    throw new Error(`refusing to fetch from ${parsed.hostname}`);
  }
  return parsed;
}

// Already ours? Then there is nothing to store and the row is left alone.
function isLocal(url) {
  return /^\/api\/(brand|approvals)\//.test(String(url || ''));
}

function clientDir(clientId) {
  const dir = path.join(UPLOAD_ROOT, String(clientId));
  // The client id comes from the database, not a request, but the join is
  // guarded anyway: one bad id would otherwise write outside the store.
  if (!dir.startsWith(UPLOAD_ROOT + path.sep)) throw new Error('bad client id');
  return dir;
}

/**
 * Fetch a provider URL and keep it under the client's upload folder.
 *
 * Returns { url, source_url, bytes, content_type } where `url` is the local
 * /api/brand/file path. Throws when the fetch fails or returns something that
 * is not an image or a video — the caller decides whether a failure is worth
 * losing the generation over.
 */
// `check` exists so the tests can exercise the download against a local
// server without the loopback guard being weakened or made configurable. It
// defaults to the real check, and nothing in the application passes it.
async function store({ clientId, url, stem = 'ad', check = checkUrl }) {
  if (!clientId) throw new Error('clientId required');
  check(url);

  const res = await axios.get(String(url), {
    responseType: 'arraybuffer',
    timeout: TIMEOUT_MS,
    maxContentLength: MAX_BYTES,
    maxRedirects: 5,
    validateStatus: null,
  });
  if (res.status >= 400) throw new Error(`provider returned ${res.status}`);

  const contentType = res.headers?.['content-type'] || '';
  if (!isMedia(contentType)) {
    throw new Error(`expected an image or video, got ${contentType || 'no content type'}`);
  }
  const buf = Buffer.from(res.data);
  if (!buf.length) throw new Error('empty response');
  if (buf.length > MAX_BYTES) throw new Error(`larger than the ${Math.round(MAX_BYTES / 1024 / 1024)}MB cap`);

  const dir = clientDir(clientId);
  fs.mkdirSync(dir, { recursive: true });
  // The stem is readable in a finder window; the random tail stops two
  // renders of the same concept in the same millisecond from colliding.
  const safeStem = String(stem).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'ad';
  const name = `${safeStem}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extFor(url, contentType)}`;
  fs.writeFileSync(path.join(dir, name), buf);

  return {
    url: `/api/brand/file/${clientId}/${name}`,
    source_url: String(url),
    bytes: buf.length,
    content_type: String(contentType).split(';')[0].trim(),
  };
}

/**
 * Store if possible, and if not, keep going.
 *
 * A failed download must never lose a render that was already paid for, so
 * this falls back to the provider URL and says what went wrong. The row is
 * then exactly as it would have been before this existed: usable now,
 * expiring later. Callers put `stored` in the response so the UI can say so.
 */
async function storeOrKeep({ clientId, url, stem, check }) {
  if (!url) return { url, stored: false, reason: 'no url' };
  if (isLocal(url)) return { url, stored: false, reason: 'already local' };
  try {
    const out = await store({ clientId, url, stem, check });
    return { ...out, stored: true };
  } catch (err) {
    console.error(`[generated-media] could not store ${String(url).slice(0, 120)}: ${err.message}`);
    return { url: String(url), source_url: String(url), stored: false, reason: err.message };
  }
}


// ── Reading an asset back ─────────────────────────────────────────────────

// /api/brand/file/<client>/<name> → the file on disk. Null for anything
// else. The traversal guard matters even though these paths are written by
// this server and read from its own database: the whole point of keeping the
// files is that something later reads them back, and a path that escapes the
// client's folder reads another client's work.
function localPathFor(url) {
  const m = String(url || '').match(/^\/api\/brand\/file\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  const base = path.join(UPLOAD_ROOT, m[1]);
  const p = path.join(base, m[2]);
  return p.startsWith(base + path.sep) ? p : null;
}

// Content type from a filename, for a data URI. Only the formats the image
// generators and the upload filter actually produce.
const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
};
function mimeFor(file) {
  return MIME_BY_EXT[path.extname(String(file)).toLowerCase()] || 'image/png';
}

/**
 * The bytes behind an ad_creative_images row.
 *
 * Normally a file read: the asset lives here. A row written before assets
 * were kept, or one whose download failed at generation time, still points at
 * a provider CDN — source_url first, because it is the canonical origin, then
 * url, and either may have expired.
 *
 * When a remote copy is fetched it is also kept, because the row that needed
 * re-fetching is exactly the row that will need it again. `onKept` is how the
 * caller records that against the row; this module does no SQL.
 */
async function readBytes(row, { onKept, check } = {}) {
  const local = localPathFor(row.url);
  if (local) {
    if (!fs.existsSync(local)) throw new Error('the stored file is no longer on disk');
    return fs.promises.readFile(local);
  }
  const remote = row.source_url || row.url;
  if (!/^https?:\/\//i.test(String(remote || ''))) throw new Error('no readable location recorded');
  let got;
  try {
    got = await store({ clientId: row.client_id, url: remote, stem: 'kept', check });
  } catch (err) {
    throw new Error(`the provider link no longer works (${err.message})`);
  }
  if (onKept) await onKept(got);
  return fs.promises.readFile(localPathFor(got.url));
}

module.exports = {
  store, storeOrKeep, isLocal, extFor, isMedia, checkUrl,
  localPathFor, mimeFor, readBytes,
  UPLOAD_ROOT, MAX_BYTES,
};
