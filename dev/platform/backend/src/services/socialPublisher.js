// Social autopilot publisher — the worker that takes a locked + scheduled
// plan and actually pushes posts to Instagram / Facebook / LinkedIn.
//
// Phase 3 covers Meta (IG Business + FB Page). LinkedIn lands in Phase 4
// and currently records a publication row with status='unsupported'.
//
// Driven by the cron in services/scheduler.js, which calls
// publishDuePlans() every few minutes. Each due plan becomes one
// social_post_publications row per platform; success / failure / posted
// URL are recorded there so the UI can show progress without polling.

const crypto = require('crypto');
const pool = require('./../db');
const { decrypt } = require('../utils/encryption');
const meta = require('../connectors/meta');
const linkedin = require('../connectors/linkedin');
const socialDrive = require('./socialDrive');
const socialCaptions = require('./socialCaptions');

const MAX_ATTEMPTS = 3;

// Build a signed, time-limited proxy URL Meta can fetch from. We can't
// hand Meta the raw Drive download URL because the file isn't public —
// instead we expose /api/social/media-proxy/:planId/:fileId?token=...
// which streams the file from Drive after verifying the token. The token
// is HMAC over (planId, fileId, exp) using JWT_SECRET. 24h expiry is
// plenty: Meta typically fetches within seconds, but long enough that a
// stuck container poll doesn't expire the URL mid-publish.
function signMediaUrl({ planId, fileId, ttlSec = 24 * 60 * 60 }) {
  const base = (process.env.PLATFORM_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('PLATFORM_URL is not set — required so Meta can fetch the Drive proxy URL.');
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(`${planId}.${fileId}.${exp}`).digest('hex');
  return `${base}/api/social/media-proxy/${planId}/${encodeURIComponent(fileId)}?exp=${exp}&sig=${sig}`;
}

function verifyMediaToken(planId, fileId, exp, sig) {
  if (!exp || !sig) return false;
  const expNum = parseInt(exp, 10);
  if (!expNum || expNum < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(`${planId}.${fileId}.${expNum}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
  } catch { return false; }
}

// Pick which Drive file to use for each platform. MVP: one file per
// platform (the most-recently-modified video for reels-capable platforms,
// or first image otherwise). Returns { file, mediaKind }.
function pickPrimaryMedia(driveFiles) {
  if (!driveFiles?.length) return { file: null, mediaKind: null };
  // Prefer videos when available (most plans are reels). Drive list is
  // already ordered by modifiedTime desc.
  const video = driveFiles.find(f => (f.mimeType || '').startsWith('video/'));
  if (video) return { file: video, mediaKind: 'video' };
  const image = driveFiles.find(f => (f.mimeType || '').startsWith('image/'));
  if (image) return { file: image, mediaKind: 'image' };
  return { file: null, mediaKind: null };
}

// Look up the Meta connector credentials for a client. Any of meta_ads /
// instagram_insights works — they share the same OAuth token. Refreshes
// nothing (Meta long-lived tokens don't auto-refresh) but checks validity.
async function getMetaCreds(clientId) {
  const { rows } = await pool.query(
    `SELECT credentials FROM connectors
      WHERE client_id = $1
        AND connector_type IN ('meta_ads', 'instagram_insights')
        AND credentials IS NOT NULL AND credentials != '{}'
      ORDER BY connector_type LIMIT 1`,
    [clientId]
  );
  if (!rows.length) throw new Error('No Meta connector on this client — connect Meta Ads or Instagram first.');
  return decrypt(rows[0].credentials);
}

async function getLinkedInCreds(clientId) {
  const { rows } = await pool.query(
    `SELECT credentials FROM connectors
      WHERE client_id = $1
        AND connector_type = 'linkedin_organic'
        AND credentials IS NOT NULL AND credentials != '{}'
      LIMIT 1`,
    [clientId]
  );
  if (!rows.length) throw new Error('No LinkedIn connector on this client — connect LinkedIn first.');
  return decrypt(rows[0].credentials);
}

// Pick up every plan whose scheduled_at is due, hasn't been published yet
// (no completed publication rows), and has at least one target platform.
// Returns the rows ready to publish.
async function findDuePlans() {
  const { rows } = await pool.query(
    `SELECT p.id, p.client_id, p.title, p.plan, p.scheduled_at,
            p.drive_folder_url, p.target_platforms
       FROM social_post_plans p
      WHERE p.scheduled_at IS NOT NULL
        AND p.scheduled_at <= NOW()
        AND p.target_platforms IS NOT NULL
        AND array_length(p.target_platforms, 1) > 0
        AND NOT EXISTS (
          SELECT 1 FROM social_post_publications pub
           WHERE pub.plan_id = p.id
             AND pub.status IN ('posted', 'in_flight')
        )
      ORDER BY p.scheduled_at ASC
      LIMIT 25`
  );
  return rows;
}

// Publish a single plan across all its target platforms. Captions are
// generated fresh per call (cheap, ~3 LLM calls) so the AM's last edit to
// the plan is always reflected. Each platform's outcome is written to its
// own social_post_publications row.
async function publishPlan(plan) {
  // Look up the Drive folder contents — needed for IG (mandatory media)
  // and useful for FB. If the folder isn't set, we error all platforms.
  let driveFiles = [];
  if (plan.drive_folder_url) {
    try {
      driveFiles = await socialDrive.listFolder(plan.client_id, plan.drive_folder_url);
    } catch (err) {
      // Carry on — per-platform errors will mark each row failed.
      console.warn(`[autopilot] Drive listing failed for plan ${plan.id}: ${err.message}`);
    }
  }
  const { file: primaryFile, mediaKind } = pickPrimaryMedia(driveFiles);
  const mediaUrl = primaryFile ? signMediaUrl({ planId: plan.id, fileId: primaryFile.id }) : null;

  // Generate per-platform captions from the locked plan.
  let captions = {};
  try {
    captions = await socialCaptions.captionsForPlan(plan.plan, plan.target_platforms);
  } catch (err) {
    console.error(`[autopilot] caption generation failed for plan ${plan.id}: ${err.message}`);
  }

  // Per platform: claim a publication row, attempt publish, record result.
  for (const platform of plan.target_platforms) {
    await publishToPlatform({ plan, platform, caption: captions[platform] || '', mediaUrl, mediaKind, primaryFile });
  }
}

async function publishToPlatform({ plan, platform, caption, mediaUrl, mediaKind, primaryFile }) {
  // Claim or upsert the row. ON CONFLICT lets us retry transient failures
  // without creating duplicate rows.
  const { rows: upsert } = await pool.query(
    `INSERT INTO social_post_publications (plan_id, client_id, platform, scheduled_at, status, caption, media_refs, attempts)
     VALUES ($1, $2, $3, $4, 'in_flight', $5, $6, 1)
     ON CONFLICT (plan_id, platform) DO UPDATE
       SET status = 'in_flight',
           caption = EXCLUDED.caption,
           media_refs = EXCLUDED.media_refs,
           attempts = social_post_publications.attempts + 1,
           updated_at = NOW()
     RETURNING id, attempts`,
    [
      plan.id, plan.client_id, platform, plan.scheduled_at,
      caption || null,
      JSON.stringify(primaryFile ? [{ id: primaryFile.id, name: primaryFile.name, mimeType: primaryFile.mimeType }] : []),
    ]
  );
  const pubId = upsert[0].id;
  const attempts = upsert[0].attempts;

  try {
    let result;
    if (platform === 'instagram' || platform === 'facebook') {
      const creds = await getMetaCreds(plan.client_id);
      const targets = await meta.pickPublishingTargets(creds);
      if (platform === 'instagram') {
        result = await meta.publishToInstagram({
          igBusinessId: targets.igBusinessId,
          pageAccessToken: targets.pageAccessToken,
          caption, mediaUrl, mediaKind,
        });
      } else {
        result = await meta.publishToFacebookPage({
          pageId: targets.pageId,
          pageAccessToken: targets.pageAccessToken,
          caption, mediaUrl, mediaKind,
        });
      }
    } else if (platform === 'linkedin') {
      const creds = await getLinkedInCreds(plan.client_id);
      // LinkedIn doesn't accept a remote URL — we have to stream the
      // bytes through. Fetch directly from Drive (sidesteps the media
      // proxy entirely since we're not handing the URL to a third party).
      let mediaStream = null, mediaContentType = null, mediaContentLength = null;
      if (primaryFile) {
        const upstream = await socialDrive.downloadFile(plan.client_id, primaryFile.id);
        mediaStream = upstream.data;
        mediaContentType = upstream.headers['content-type'] || primaryFile.mimeType;
        mediaContentLength = upstream.headers['content-length'] || primaryFile.size;
      }
      result = await linkedin.publishToLinkedIn({
        credentials: creds,
        caption,
        mediaStream,
        mediaContentType,
        mediaContentLength,
        mediaKind,
      });
    } else {
      throw new Error(`Unknown platform: ${platform}`);
    }
    await pool.query(
      `UPDATE social_post_publications
          SET status = 'posted', posted_at = NOW(), posted_url = $2,
              error_message = NULL, updated_at = NOW()
        WHERE id = $1`,
      [pubId, result?.posted_url || null]
    );
  } catch (err) {
    const reason = err.response?.data?.error?.message || err.message || 'unknown error';
    // If we've exhausted retries, mark failed; otherwise leave as in_flight
    // so the next cron pass can retry (we'll bump attempts on the retry).
    const terminal = attempts >= MAX_ATTEMPTS;
    await pool.query(
      `UPDATE social_post_publications
          SET status = $2, error_message = $3, updated_at = NOW()
        WHERE id = $1`,
      [pubId, terminal ? 'failed' : 'pending', reason]
    );
    console.error(`[autopilot] publish ${platform} for plan ${plan.id} failed (attempt ${attempts}): ${reason}`);
  }
}

// Entry point called from the scheduler cron. Sequential rather than
// parallel — IG containers can take ~30s while transcoding, so we'd rather
// finish one plan before starting the next than risk burning the API quota.
async function publishDuePlans() {
  const due = await findDuePlans();
  if (!due.length) return { processed: 0 };
  let ok = 0, failed = 0;
  for (const plan of due) {
    try {
      await publishPlan(plan);
      ok++;
    } catch (err) {
      failed++;
      console.error(`[autopilot] publishPlan ${plan.id} threw: ${err.message}`);
    }
  }
  return { processed: due.length, ok, failed };
}

module.exports = {
  publishDuePlans, publishPlan,
  signMediaUrl, verifyMediaToken,
  pickPrimaryMedia,
};
