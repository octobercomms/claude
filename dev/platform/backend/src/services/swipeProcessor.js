// In-platform processor for the Swipe file (reel → ideas). The dedicated video
// worker can also drain this queue, but on a single-box install (no worker
// running) the platform processes swipe items itself: yt-dlp pulls the audio,
// OpenAI Whisper transcribes it, then swipeFile.saveTranscript builds the Claude
// idea card + emails it. Lightweight (audio only, one Whisper + one Claude call).
//
// Gated on an OpenAI key (settings store or env) and yt-dlp being installed.
// Claims are atomic (SKIP LOCKED) so the worker and the platform never collide.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const swipeFile = require('./swipeFile');
const { recordApiCost } = require('./costLog');
const { getSetting } = require('../utils/settings');

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const WHISPER_USD_PER_MIN = 0.006; // OpenAI whisper-1 pricing
let _running = false;

function run(bin, args) {
  return new Promise((resolve, reject) => {
    let p;
    try { p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return reject(e); }
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve(out) : reject(new Error(`${bin} exited ${code}: ${(err || out).slice(-300)}`)));
  });
}

// Instagram (and some other sites) require a logged-in session to download.
// If the AM has pasted their Instagram session cookie in Settings, write a
// minimal Netscape cookies.txt yt-dlp can use; returns the --cookies args (or []).
function cookieArgs(dir, sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return [];
  const file = path.join(dir, 'cookies.txt');
  // Netscape format: domain  includeSub  path  secure  expiry  name  value
  fs.writeFileSync(file, `# Netscape HTTP Cookie File\n.instagram.com\tTRUE\t/\tTRUE\t2147483647\tsessionid\t${sid}\n`);
  return ['--cookies', file];
}

// Best-effort title + duration (seconds) in one metadata call.
async function fetchMeta(url, extra = []) {
  try {
    const out = await run(YTDLP, [...extra, '--no-playlist', '--skip-download', '--print', '%(duration)s|%(title)s', url]);
    const line = out.split('\n').find(l => l.trim()) || '';
    const sep = line.indexOf('|');
    const durRaw = sep >= 0 ? line.slice(0, sep) : '';
    const title = sep >= 0 ? line.slice(sep + 1).trim().slice(0, 200) : null;
    const duration = Number(durRaw);
    return { title: title || null, duration: Number.isFinite(duration) ? duration : null };
  } catch { return { title: null, duration: null }; }
}

async function transcribe(audioPath, apiKey) {
  const buf = fs.readFileSync(audioPath);
  const form = new FormData();
  form.append('file', new Blob([buf]), 'audio.mp3');
  form.append('model', process.env.WHISPER_MODEL || 'whisper-1');
  form.append('response_format', 'json');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.text || '').trim();
}

async function processOne(item, apiKey) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `swipe-${item.id}-`));
  try {
    const sid = (await getSetting('IG_SESSIONID')) || process.env.IG_SESSIONID;
    const cookies = cookieArgs(dir, sid);
    const { title, duration } = await fetchMeta(item.url, cookies);
    const audioPath = path.join(dir, 'audio.mp3');
    await run(YTDLP, [...cookies, '-q', '--no-playlist', '--no-warnings', '-x', '--audio-format', 'mp3', '-o', path.join(dir, 'audio.%(ext)s'), item.url]);
    if (!fs.existsSync(audioPath)) throw new Error('Could not fetch this video (private, age-gated, or login required).');
    const transcript = await transcribe(audioPath, apiKey);
    if (!transcript) throw new Error('No speech could be transcribed from this video.');
    if (duration) {
      recordApiCost({ provider: 'openai', feature: 'swipe_transcription', costUsd: (duration / 60) * WHISPER_USD_PER_MIN, clientId: item.client_id || null, meta: { model: 'whisper-1', duration_s: Math.round(duration) } });
    }
    await swipeFile.saveTranscript(item.id, { transcript, title });
    console.log(`[swipe] ✓ item ${item.id} transcribed (${transcript.length} chars)`);
  } catch (err) {
    console.error(`[swipe] ✗ item ${item.id}: ${err.message}`);
    await swipeFile.failItem(item.id, err.message).catch(() => {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Drain the queued swipe items. Safe to call concurrently — a re-entrant call
// returns immediately, and claims are atomic across the worker too.
async function processQueue() {
  if (_running) return;
  const apiKey = (await getSetting('OPENAI_API_KEY')) || process.env.OPENAI_API_KEY;
  if (!apiKey) return; // no key → leave items queued; the AM sees "Queued" until one is set
  _running = true;
  try {
    for (let i = 0; i < 20; i++) { // cap per drain so we don't loop forever
      const item = await swipeFile.claimNext('platform-inline');
      if (!item) break;
      await processOne(item, apiKey);
    }
  } catch (e) {
    console.error('[swipe] queue error:', e.message);
  } finally {
    _running = false;
  }
}

// Fire-and-forget kick (used right after an item is created, for responsiveness).
function kick() { processQueue().catch(() => {}); }

module.exports = { processQueue, kick };
