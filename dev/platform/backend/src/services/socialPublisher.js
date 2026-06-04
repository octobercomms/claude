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

// Decide how to publish a plan based on what's in the Drive folder + the
// plan's declared platforms. Three modes:
//   - 'carousel'  → 2+ images, no video, and plan.platforms hints at it
//                   ('carousel', 'instagram_feed'). Publishes multi-image
//                   posts to each platform that supports them.
//   - 'video'     → first video file, single post (reels on IG).
//   - 'image'     → first image file, single post.
// Returns { mode, files: [...], mediaKind }.
function pickMediaPlan(driveFiles, plan) {
  if (!driveFiles?.length) return { mode: 'none', files: [], mediaKind: null };
  const images = driveFiles.filter(f => (f.mimeType || '').startsWith('image/'));
  const videos = driveFiles.filter(f => (f.mimeType || '').startsWith('video/'));
  const declared = Array.isArray(plan?.platforms) ? plan.platforms.map(String) : [];
  const carouselDeclared = declared.includes('carousel') || declared.includes('instagram_feed');
  // Carousel needs 2+ images AND a hint that the plan was scoped that way.
  // We never auto-promote a reel storyboard to a carousel — that would
  // change the creative intent.
  if (carouselDeclared && images.length >= 2 && videos.length === 0) {
    return { mode: 'carousel', files: images.slice(0, 10), mediaKind: 'image' };
  }
  if (videos.length) return { mode: 'video', files: [videos[0]], mediaKind: 'video' };
  if (images.length) return { mode: 'image', files: [images[0]], mediaKind: 'image' };
  return { mode: 'none', files: [], mediaKind: null };
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

// Look up the preferred Instagram Business id the AM picked on the
// instagram_insights connector card. When set, the Meta publisher will
// route through the Page that owns that IG account instead of falling
// back to the first Page-with-IG. Lets multi-Page clients pick.
async function getPreferredIgId(clientId) {
  const { rows } = await pool.query(
    `SELECT config FROM connectors
      WHERE client_id = $1 AND connector_type = 'instagram_insights'
      LIMIT 1`,
    [clientId]
  );
  return rows[0]?.config?.value || null;
}

// Pick up every plan whose scheduled_at is due, hasn't been published yet
// (no completed publication rows), and has at least one target platform.
// Skips paused clients so the AM can hit the kill switch without
// touching individual plans.
async function findDuePlans() {
  const { rows } = await pool.query(
    `SELECT p.id, p.client_id, p.title, p.plan, p.scheduled_at,
            p.drive_folder_url, p.target_platforms
       FROM social_post_plans p
       JOIN clients c ON c.id = p.client_id
      WHERE p.scheduled_at IS NOT NULL
        AND p.scheduled_at <= NOW()
        AND p.target_platforms IS NOT NULL
        AND array_length(p.target_platforms, 1) > 0
        AND c.active = true
        AND c.social_autopilot_paused = false
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
  // pickMediaPlan inspects the plan + folder and chooses one of:
  // - carousel (2+ images, plan declares carousel intent)
  // - video (first video)
  // - image (first image)
  // - none (folder empty)
  const mediaPlan = pickMediaPlan(driveFiles, plan.plan);

  // Drive-empty grace period: if the AM set a folder but no media is in
  // it yet, defer the publish (status='pending_drive') and let the cron
  // pick it up again later instead of burning attempts on a doomed
  // upload. Give a 24h window from scheduled_at; after that, the row is
  // marked failed and we stop retrying. Same logic for every target
  // platform — if media is mandatory and missing, defer them all
  // together so the AM sees one coherent state rather than per-platform
  // half-failures.
  if (plan.drive_folder_url && mediaPlan.mode === 'none') {
    const ageMs = Date.now() - new Date(plan.scheduled_at).getTime();
    const giveUp = ageMs > 24 * 60 * 60 * 1000;
    for (const platform of plan.target_platforms) {
      await markDeferred({ plan, platform, giveUp });
    }
    return;
  }

  // Generate per-platform captions from the locked plan.
  let captions = {};
  try {
    captions = await socialCaptions.captionsForPlan(plan.plan, plan.target_platforms);
  } catch (err) {
    console.error(`[autopilot] caption generation failed for plan ${plan.id}: ${err.message}`);
  }

  // Per platform: claim a publication row, attempt publish, record result.
  for (const platform of plan.target_platforms) {
    await publishToPlatform({ plan, platform, caption: captions[platform] || '', mediaPlan });
  }
}

async function markDeferred({ plan, platform, giveUp }) {
  const status = giveUp ? 'failed' : 'pending_drive';
  const msg = giveUp
    ? 'Gave up after 24h — Drive folder still empty at publish time.'
    : 'Waiting on Drive folder — drop the final media in and the autopilot will pick it up on the next cron tick.';
  await pool.query(
    `INSERT INTO social_post_publications
       (plan_id, client_id, platform, scheduled_at, status, error_message, attempts)
     VALUES ($1, $2, $3, $4, $5, $6, 0)
     ON CONFLICT (plan_id, platform) DO UPDATE
       SET status = EXCLUDED.status,
           error_message = EXCLUDED.error_message,
           updated_at = NOW()`,
    [plan.id, plan.client_id, platform, plan.scheduled_at, status, msg]
  );
}

async function publishToPlatform({ plan, platform, caption, mediaPlan }) {
  // Claim or upsert the row. ON CONFLICT lets us retry transient failures
  // without creating duplicate rows.
  const mediaRefs = mediaPlan.files.map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType }));
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
      JSON.stringify(mediaRefs),
    ]
  );
  const pubId = upsert[0].id;
  const attempts = upsert[0].attempts;

  try {
    let result;
    if (platform === 'instagram' || platform === 'facebook') {
      const creds = await getMetaCreds(plan.client_id);
      const preferredIg = await getPreferredIgId(plan.client_id);
      const targets = await meta.pickPublishingTargets(creds, preferredIg);
      if (mediaPlan.mode === 'carousel') {
        const imageUrls = mediaPlan.files.map(f => signMediaUrl({ planId: plan.id, fileId: f.id }));
        if (platform === 'instagram') {
          result = await meta.publishCarouselToInstagram({
            igBusinessId: targets.igBusinessId,
            pageAccessToken: targets.pageAccessToken,
            caption, imageUrls,
          });
        } else {
          result = await meta.publishMultiPhotoToFacebook({
            pageId: targets.pageId,
            pageAccessToken: targets.pageAccessToken,
            caption, imageUrls,
          });
        }
      } else {
        const primaryFile = mediaPlan.files[0] || null;
        const mediaUrl = primaryFile ? signMediaUrl({ planId: plan.id, fileId: primaryFile.id }) : null;
        if (platform === 'instagram') {
          result = await meta.publishToInstagram({
            igBusinessId: targets.igBusinessId,
            pageAccessToken: targets.pageAccessToken,
            caption, mediaUrl, mediaKind: mediaPlan.mediaKind,
          });
        } else {
          result = await meta.publishToFacebookPage({
            pageId: targets.pageId,
            pageAccessToken: targets.pageAccessToken,
            caption, mediaUrl, mediaKind: mediaPlan.mediaKind,
          });
        }
      }
    } else if (platform === 'linkedin') {
      const creds = await getLinkedInCreds(plan.client_id);
      if (mediaPlan.mode === 'carousel') {
        // LinkedIn doesn't take URLs — open one stream per image and
        // hand them to the carousel publisher.
        const images = [];
        for (const f of mediaPlan.files) {
          const upstream = await socialDrive.downloadFile(plan.client_id, f.id);
          images.push({
            stream: upstream.data,
            contentType: upstream.headers['content-type'] || f.mimeType,
            contentLength: upstream.headers['content-length'] || f.size,
          });
        }
        result = await linkedin.publishCarouselToLinkedIn({ credentials: creds, caption, images });
      } else {
        const primaryFile = mediaPlan.files[0] || null;
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
          mediaStream, mediaContentType, mediaContentLength,
          mediaKind: mediaPlan.mediaKind,
        });
      }
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
    // Mirror this publication into social_posts so the daily engagement
    // refresh, Winners panel, and framework breakdown all see autopilot
    // output. Without this the autopilot writes are invisible to the
    // performance loop and every batch generation is blind to what
    // worked. Best-effort — never block the publication success on
    // engagement bookkeeping.
    try {
      await linkPublishedPost({ plan, platform, caption, result, mediaPlan });
    } catch (err) {
      console.error(`[autopilot] linkPublishedPost ${platform} for plan ${plan.id} failed:`, err.message);
    }
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

// Sentinel brief value we use to identify the per-client autopilot
// batch. Listed batches in the Social tab filter this out so the AM
// only sees real brainstorm batches in the history.
const AUTOPILOT_BATCH_BRIEF = '__autopilot__';

// One sentinel social_batches row per client hosts autopilot-published
// posts. Created on first publish, reused thereafter.
async function getOrCreateAutopilotBatch(clientId) {
  const { rows } = await pool.query(
    `SELECT id FROM social_batches WHERE client_id = $1 AND brief = $2 LIMIT 1`,
    [clientId, AUTOPILOT_BATCH_BRIEF]
  );
  if (rows.length) return rows[0].id;
  const { rows: inserted } = await pool.query(
    `INSERT INTO social_batches (client_id, brief, exemplars, trends)
     VALUES ($1, $2, '{}'::jsonb, '{}'::jsonb)
     RETURNING id`,
    [clientId, AUTOPILOT_BATCH_BRIEF]
  );
  return inserted[0].id;
}

// Parse a posted URL / id into the (external_id, external_platform)
// fields social_posts expects, so engagement refresh can fetch insights.
function deriveExternalRef(platform, result) {
  if (!result) return { external_id: null, external_platform: platform };
  if (platform === 'instagram') {
    // result.id is the IG media id directly — perfect for the Graph API.
    return { external_id: result.id || null, external_platform: 'instagram' };
  }
  if (platform === 'facebook') {
    // FB post_id is "{page-id}_{post-id}"; we keep the whole string.
    return { external_id: result.id || null, external_platform: 'facebook' };
  }
  if (platform === 'linkedin') {
    return { external_id: result.id || null, external_platform: 'linkedin' };
  }
  return { external_id: null, external_platform: platform };
}

// Map a planner-domain plan to the social_posts "kind" enum the
// engagement loop reads. Anything that uses a video file is treated as
// a reel; multi-image is carousel; otherwise a plain post.
function pickPostKind(plan, mediaPlan) {
  if (mediaPlan?.mode === 'carousel') return 'carousel';
  if (mediaPlan?.mediaKind === 'video') return 'reel';
  // Honour an explicit kind on the plan if the planner set one.
  const declared = (plan?.plan?.platforms || []).map(String);
  if (declared.includes('instagram_story')) return 'story';
  return 'post';
}

async function linkPublishedPost({ plan, platform, caption, result, mediaPlan }) {
  const { external_id, external_platform } = deriveExternalRef(platform, result);
  const batchId = await getOrCreateAutopilotBatch(plan.client_id);
  const kind = pickPostKind(plan, mediaPlan);
  const hook = plan?.plan?.hook?.text || null;
  const framework = plan?.plan?.framework || null;
  const hashtags = Array.isArray(plan?.plan?.hashtags) ? plan.plan.hashtags : [];
  // ON CONFLICT not available (no unique key on external_id) — instead
  // we dedupe by (plan_id, platform) which is the natural autopilot key.
  // Re-runs of publishPlan after a retry will UPDATE the existing row
  // rather than create duplicates.
  await pool.query(
    `INSERT INTO social_posts
       (batch_id, client_id, plan_id, position, kind, platform, hook, caption, hashtags,
        status, published_url, external_id, external_platform, published_at, framework)
     SELECT $1, $2, $3, 0, $4, $5, $6, $7, $8, 'published', $9, $10, $11, NOW(), $12
      WHERE NOT EXISTS (
        SELECT 1 FROM social_posts WHERE plan_id = $3 AND platform = $5
      )`,
    [batchId, plan.client_id, plan.id, kind, platform, hook, caption || null,
     hashtags, result?.posted_url || null, external_id, external_platform, framework]
  );
  // If an earlier attempt already inserted the row, refresh the live
  // bits — caption may have been regenerated, posted_url may now be
  // resolved, external_id may have arrived on a retry.
  await pool.query(
    `UPDATE social_posts
        SET caption = $4, hashtags = $5, status = 'published',
            published_url = COALESCE($6, published_url),
            external_id = COALESCE($7, external_id),
            external_platform = $8,
            published_at = COALESCE(published_at, NOW()),
            framework = COALESCE($9, framework)
      WHERE plan_id = $1 AND platform = $2 AND client_id = $3`,
    [plan.id, platform, plan.client_id, caption || null, hashtags,
     result?.posted_url || null, external_id, external_platform, framework]
  );
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
  pickPrimaryMedia, pickMediaPlan,
};
