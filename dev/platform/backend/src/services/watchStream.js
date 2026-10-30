// The decisions the public watch stream makes, separated from the plumbing of
// reading bytes off a store and piping them to a socket.
//
// They are here because they are the parts that were wrong, and all three were
// wrong invisibly: nothing throws, nothing logs, the video still plays, it is
// merely slow or unseekable. A test can reach a pure function; it cannot
// reach a header set three awaits deep inside a route handler.
//
// Used by routes/watchPublic.js.

// Which stored object to serve, best first.
//
// play_key is the remuxed, seekable copy (services/recordingRemux.js). It is
// NULL for a recording made before that existed and for one whose remux
// failed, and then the original capture is served instead — slower to seek,
// but it plays. The original stays in the list as a fallback for a playback
// copy that has gone missing from the store, which is why this is a list and
// not a choice.
function playbackKeys(rec) {
  if (!rec) return [];
  return [rec.play_key, rec.storage_key].filter(Boolean);
}

// Parse a Range request header into { start, end }, or null when there is not
// one. end is null for an open-ended range, which is what a browser sends when
// it starts a video: `bytes=0-`.
function parseRange(header) {
  if (!header) return null;
  const m = /bytes=(\d*)-(\d*)/.exec(header);
  if (!m) return null;
  return {
    start: m[1] ? parseInt(m[1], 10) : 0,
    end: m[2] ? parseInt(m[2], 10) : null,
  };
}

// How long a signed R2 URL stays good for.
//
// It has to outlast a viewing, not a request. The player keeps using the URL it
// was redirected to for every later range request, so a one-hour TTL expired
// part-way through anything long and the seek bar stopped working with no
// visible reason and nothing in the logs.
const SIGNED_TTL_SEC = Number(process.env.MEDIA_SIGNED_TTL_SEC) || 6 * 3600;

// A week. The bytes behind a storage key never change — a re-record is a new
// recording with a new key — so the response is immutable.
const CACHE_MAX_AGE = 7 * 24 * 3600;

// Headers for a streamed response.
//
// `private` rather than `public` is deliberate. The share token is the only
// secret protecting a recording, so the URL is the credential, and a shared
// cache keyed on it would hold copies there is no way to purge. Private keeps
// it in the viewer's own browser, where deleting a recording still takes it
// away from everyone who has not already watched it.
//
// This was `private, max-age=0, no-store`, which forbade caching outright:
// scrubbing backwards, replaying, or reloading the page re-downloaded the
// entire file from the box every time.
function streamHeaders({ key, mime, size, start, end, hasRange, contentTypeFor }) {
  const partial = hasRange && (start !== 0 || end !== size - 1);
  const headers = {
    // Typed from the key being served, not from the recording's original mime.
    // The playback copy of a .mov is an .mp4, and labelling those bytes
    // video/quicktime is how a browser refuses a file it would have played.
    'Content-Type': contentTypeFor(key) || mime || 'video/webm',
    'Accept-Ranges': 'bytes',
    'Cache-Control': `private, max-age=${CACHE_MAX_AGE}, immutable`,
    'Content-Length': partial ? end - start + 1 : size,
  };
  if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  return { status: partial ? 206 : 200, headers };
}

// Headers for the 302 that sends a player at R2 instead. The redirect is
// per-viewer and expires; the bytes behind it are cached by R2's own headers,
// so this response must not be held onto.
function redirectHeaders() {
  return { 'Cache-Control': 'private, max-age=0, no-store' };
}

module.exports = {
  playbackKeys,
  parseRange,
  streamHeaders,
  redirectHeaders,
  SIGNED_TTL_SEC,
  CACHE_MAX_AGE,
};
