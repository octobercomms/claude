/**
 * Caption a video for a social post, using the real caption pipeline.
 *
 * This is the join that was missing. Shared's Produce step called HeyGen and
 * ElevenLabs directly and wrote to social_post_media, which carries no client
 * and knows nothing about the caption library, the brand kit or the renderer.
 * So the 31 templates were invisible from the one screen where reels are
 * actually scheduled and published.
 *
 * Here a post points at a video it already has, or anything in the client's
 * asset library, and gets it back captioned in a chosen template with that
 * client's typeface and accent. Same compiler as Produce, same fonts, same
 * output every time.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const pool = require('../db');
const captions = require('./captions');
const assets = require('./assets');
const { getSetting } = require('../utils/settings');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads');

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(bin)}: ${String(stderr || err.message).slice(-400)}`));
      else resolve(String(stdout || ''));
    });
  });
}

/**
 * Turn a stored location into a path ffmpeg can read.
 *
 * Assets carry either a url or a storage key, and a url is usually one of our
 * own `/api/brand/file/<client>/<name>` paths pointing at a file already on
 * this disk. Reading it directly beats fetching it from ourselves over HTTP.
 */
function localPath(clientId, { url, storage_key: key }) {
  if (url) {
    const m = String(url).match(/^\/api\/brand\/file\/([^/]+)\/(.+)$/);
    if (m) {
      const p = path.join(UPLOAD_ROOT, m[1], path.basename(m[2]));
      if (p.startsWith(UPLOAD_ROOT + path.sep) && fs.existsSync(p)) return p;
    }
    // An edit rendered in Produce. These are served from the edit pipeline's
    // own directory rather than the brand uploads, and since edits are indexed
    // in the library they appear beside everything else: a tool that could not
    // open the row the library offered it would be the library lying about
    // what exists.
    const edited = require('./editJobs').diskPathForUrl(url);
    if (edited && fs.existsSync(edited)) return edited;

    // An external url (a provider's CDN) is handed to ffmpeg as-is; it reads
    // https directly and we would only be adding a download step.
    if (/^https?:\/\//.test(url)) return url;
  }
  if (key) {
    const p = path.join(UPLOAD_ROOT, clientId, path.basename(key));
    if (p.startsWith(UPLOAD_ROOT + path.sep) && fs.existsSync(p)) return p;
  }
  return null;
}

/** The client's caption kit, from the brand assets they already have. */
async function kitFor(clientId) {
  const { rows } = await pool.query(
    `SELECT kind, name, metadata FROM brand_assets
      WHERE client_id = $1 AND kind IN ('font', 'palette')`, [clientId]);
  return captions.kitFromAssets(rows);
}

/**
 * Caption one video and record the result against the post and in the library.
 *
 * `words` may be supplied by the caller (a script already timed, or a previous
 * transcription) to avoid paying Whisper twice for the same audio.
 */
async function captionForPost({ post, source, templateId, formatId = 'vertical',
  words = null, applyKit = true, createdBy = null }) {
  captions.preset(templateId);                 // refuse an unknown template early

  const clientId = post.client_id;
  const input = localPath(clientId, source);
  if (!input) throw new Error('That video could not be found on disk.');

  const dir = path.join(UPLOAD_ROOT, clientId);
  fs.mkdirSync(dir, { recursive: true });
  const name = `captioned-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.mp4`;
  const outPath = path.join(dir, name);

  // Transcribe only when the caller has no timings. Every word-timed template
  // needs the word rather than the phrase, so segment-level SRT is no use here.
  let timed = Array.isArray(words) && words.length ? words : null;
  if (!timed) {
    const key = (await getSetting('OPENAI_API_KEY')) || process.env.OPENAI_API_KEY;
    if (!key) throw new Error('No OpenAI key, so this video cannot be transcribed. Add one under Settings → AI.');
    const audio = `${outPath}.mp3`;
    try {
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', input,
        '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audio]);
      const { whisperWords } = require('./editProcessor');
      timed = await whisperWords(audio, key);
    } finally { fs.existsSync(audio) && fs.unlinkSync(audio); }
  }

  const kit = applyKit ? await kitFor(clientId) : null;
  await captions.burn({ words: timed, templateId, kit, formatId, source: input, outPath });

  const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', outPath]);
  const [w, h, dur] = probe.trim().split('\n');
  const url = `/api/brand/file/${clientId}/${name}`;

  const { rows } = await pool.query(
    `INSERT INTO social_post_media (post_id, kind, provider, url, duration_sec, metadata)
     VALUES ($1, 'video', 'captions', $2, $3, $4) RETURNING *`,
    [post.id, url, Math.round(Number(dur) || 0),
      JSON.stringify({ template: templateId, format: formatId, words: timed.length, kit })]);
  const media = rows[0];

  const asset = await assets.record({
    client_id: clientId, source: 'caption_render', source_id: media.id,
    title: `Captioned · ${captions.preset(templateId).name}`,
    url, mime: 'video/mp4',
    width: Number(w) || null, height: Number(h) || null,
    duration_s: Number(dur) || null,
    bytes: fs.statSync(outPath).size,
    created_by: createdBy,
    metadata: { template: templateId, format: formatId, post_id: post.id, words: timed.length },
  });

  // Judge the reel here, where the words, the template and the duration are
  // all in hand, and record what the checks said. This is the only moment at
  // which a judgement can be taken: the panel in the editor runs on every
  // keystroke against an unfinished edit, and a reel is not a real thing until
  // it renders. Without a row written now, no amount of engagement data can
  // ever test the rules. Like assets.record, this never throws at us.
  const reelOutcomes = require('./reelOutcomes');
  await reelOutcomes.record({
    clientId, assetId: asset?.id || null, postId: post.id, words: timed,
    template: templateId, durationS: Number(dur) || null,
    // What the post puts on screen counts as said, for the check that asks
    // whether a reel carries a term this client is trying to be found for.
    onScreenText: post.hook || null,
  });

  // Handed back so a second template on the same video costs nothing: the
  // audio is the same, so the transcription is too.
  return { media, words: timed };
}

module.exports = { captionForPost, kitFor, localPath };
