// Best-effort fetch of a Loom video from its public share URL, for one-time
// migration into the in-OMI recorder. Loom has no official list/download API,
// so this uses the documented oEmbed endpoint for the title plus Loom's
// (undocumented) transcoded-url endpoint for the MP4. It therefore only works
// for videos whose owner has sharing/downloads enabled, and can break if Loom
// changes those endpoints — callers must handle a thrown error per link and
// fall back to a manual file upload. See docs/omi/loom-replacement-plan.md.

const axios = require('axios');
const { assertPublicHttpUrl } = require('../utils/urlSafety');

// Loom share/embed URL → the session id.
function loomId(url) {
  const m = String(url || '').match(/loom\.com\/(?:share|embed)\/([a-zA-Z0-9]+)/);
  return m ? m[1] : null;
}

const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB per video

async function fetchTitle(id) {
  try {
    const { data } = await axios.get('https://www.loom.com/v1/oembed', {
      params: { url: `https://www.loom.com/share/${id}` },
      timeout: 10000,
    });
    return (data && typeof data.title === 'string') ? data.title : null;
  } catch { return null; }
}

async function resolveMp4Url(id) {
  // Undocumented, but the endpoint Loom's own "Download" button uses. Returns a
  // signed CDN URL when downloads are permitted for the video.
  try {
    const { data } = await axios.post(
      `https://www.loom.com/api/campaigns/sessions/${id}/transcoded-url`,
      {}, { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
    );
    const url = data && (data.url || data.nativeDownloadUrl);
    if (url) return url;
  } catch { /* fall through to the clear error below */ }
  throw new Error('Loom would not return a download link — the video may be private, password-protected, or have downloads disabled.');
}

// Returns { buffer, mime, title, loomId }. Throws a user-readable message on any
// failure so the caller can report it per link.
async function fetchLoomVideo(shareUrl) {
  const id = loomId(shareUrl);
  if (!id) throw new Error('Not a Loom share URL.');

  const title = await fetchTitle(id);
  const mp4Url = await resolveMp4Url(id);

  // The download URL comes from Loom, but treat it as untrusted and run it
  // through the same SSRF guard as any other server-side fetch.
  await assertPublicHttpUrl(mp4Url);

  const resp = await axios.get(mp4Url, {
    responseType: 'arraybuffer',
    timeout: 120000,
    maxContentLength: MAX_BYTES,
    maxBodyLength: MAX_BYTES,
  });
  const buffer = Buffer.from(resp.data);
  if (!buffer.length) throw new Error('Downloaded an empty file from Loom.');
  const mime = (resp.headers['content-type'] || 'video/mp4').split(';')[0].trim();
  return { buffer, mime: mime.startsWith('video/') ? mime : 'video/mp4', title, loomId: id };
}

module.exports = { fetchLoomVideo, loomId };
