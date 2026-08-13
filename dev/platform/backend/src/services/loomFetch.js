// Best-effort fetch of a Loom video from its public share URL, for one-time
// migration into the in-OMI recorder. Loom has no official list/download API,
// so we try two methods, most-reliable first:
//   1. yt-dlp — a maintained Loom extractor (the platform already uses yt-dlp on
//      the worker). Handles Loom's endpoint quirks far better than a hand-rolled
//      call. Used when the yt-dlp binary is on PATH.
//   2. Loom's (undocumented) transcoded-url endpoint — a fallback that only
//      works when the video has downloads enabled.
// Either way, a per-link failure surfaces the real reason so the caller can fall
// back to a manual file upload. See docs/omi/loom-replacement-plan.md.

const axios = require('axios');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { assertPublicHttpUrl } = require('../utils/urlSafety');

// Loom share/embed URL → the session id.
function loomId(url) {
  const m = String(url || '').match(/loom\.com\/(?:share|embed)\/([a-zA-Z0-9]+)/);
  return m ? m[1] : null;
}

const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB per video
const BROWSERISH = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Origin': 'https://www.loom.com',
};

async function fetchTitle(id) {
  try {
    const { data } = await axios.get('https://www.loom.com/v1/oembed', {
      params: { url: `https://www.loom.com/share/${id}` },
      timeout: 10000, headers: BROWSERISH,
    });
    return (data && typeof data.title === 'string') ? data.title : null;
  } catch { return null; }
}

// ── Method 1: yt-dlp ─────────────────────────────────────────────────────────
// Downloads to a temp file (yt-dlp picks the container) and returns the bytes.
// Rejects with ytdlpMissing=true if the binary isn't installed, so the caller
// can try method 2.
function ytdlpDownload(shareUrl) {
  const stem = path.join(os.tmpdir(), `loom-${crypto.randomBytes(8).toString('hex')}`);
  return new Promise((resolve, reject) => {
    const yt = spawn('yt-dlp', ['--no-playlist', '--no-part', '--quiet', '--no-warnings',
      '-f', 'best[ext=mp4]/best', '-o', `${stem}.%(ext)s`, shareUrl], { stdio: 'ignore' });
    yt.on('error', err => { if (err.code === 'ENOENT') err.ytdlpMissing = true; reject(err); });
    yt.on('close', async code => {
      try {
        if (code !== 0) return reject(new Error(`yt-dlp exited ${code}`));
        const dir = os.tmpdir(), stemBase = path.basename(stem);
        const file = (await fs.promises.readdir(dir)).find(f => f.startsWith(stemBase));
        if (!file) return reject(new Error('yt-dlp produced no file'));
        const full = path.join(dir, file);
        const buffer = await fs.promises.readFile(full);
        fs.promises.unlink(full).catch(() => {});
        if (!buffer.length) return reject(new Error('yt-dlp produced an empty file'));
        const ext = path.extname(file).slice(1).toLowerCase();
        resolve({ buffer, mime: ext === 'webm' ? 'video/webm' : 'video/mp4' });
      } catch (e) { reject(e); }
    });
  });
}

// ── Method 2: transcoded-url endpoint ────────────────────────────────────────
async function resolveMp4Url(id) {
  let status = 0, snippet = '';
  try {
    const res = await axios.post(
      `https://www.loom.com/api/campaigns/sessions/${id}/transcoded-url`,
      {}, { timeout: 15000, validateStatus: () => true,
        headers: { ...BROWSERISH, 'Content-Type': 'application/json', 'Referer': `https://www.loom.com/share/${id}` } });
    status = res.status;
    const url = res.data && (res.data.url || res.data.nativeDownloadUrl);
    if (status >= 200 && status < 300 && url) return url;
    snippet = typeof res.data === 'string' ? res.data.slice(0, 120) : JSON.stringify(res.data || {}).slice(0, 120);
  } catch (e) {
    throw new Error(`Loom download request failed (${e.code || e.message}).`);
  }
  throw new Error(`Loom returned no download link (HTTP ${status}${snippet ? ': ' + snippet : ''}) — the video may be private, password-protected, or have downloads disabled.`);
}

async function httpDownload(id) {
  const mp4Url = await resolveMp4Url(id);
  await assertPublicHttpUrl(mp4Url); // treat Loom's URL as untrusted
  const resp = await axios.get(mp4Url, {
    responseType: 'arraybuffer', timeout: 120000, maxContentLength: MAX_BYTES, maxBodyLength: MAX_BYTES,
  });
  const buffer = Buffer.from(resp.data);
  if (!buffer.length) throw new Error('Downloaded an empty file from Loom.');
  const mime = (resp.headers['content-type'] || 'video/mp4').split(';')[0].trim();
  return { buffer, mime: mime.startsWith('video/') ? mime : 'video/mp4' };
}

// Returns { buffer, mime, title, loomId }. Throws a user-readable message on any
// failure so the caller can report it per link.
async function fetchLoomVideo(shareUrl) {
  const id = loomId(shareUrl);
  if (!id) throw new Error('Not a Loom share URL.');

  const title = await fetchTitle(id);

  // Prefer yt-dlp; fall back to the HTTP endpoint if it isn't installed.
  try {
    const { buffer, mime } = await ytdlpDownload(shareUrl);
    return { buffer, mime, title, loomId: id };
  } catch (e) {
    if (!e.ytdlpMissing) {
      // yt-dlp is present but couldn't get this one — try the HTTP method too,
      // and if that also fails, surface the HTTP reason (more actionable).
      try {
        const { buffer, mime } = await httpDownload(id);
        return { buffer, mime, title, loomId: id };
      } catch (e2) {
        throw new Error(`${e2.message}`);
      }
    }
  }
  // yt-dlp not installed — HTTP endpoint only.
  const { buffer, mime } = await httpDownload(id);
  return { buffer, mime, title, loomId: id };
}

module.exports = { fetchLoomVideo, loomId };
