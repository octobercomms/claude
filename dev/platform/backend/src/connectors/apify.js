// Apify — pay-per-run scraping platform. We use one specific actor here:
// `clockworks/tiktok-scraper` (or a trending-sounds variant), which
// returns the top sounds currently moving on TikTok for a given region.
//
// The Apify API model: POST run-sync-get-dataset-items to fire the
// actor and block until the dataset is ready, then return the items.
// Avoids the run-then-poll dance for these short-lived scrapes.

const axios = require('axios');
const { getSetting } = require('../utils/settings');

const BASE_URL = 'https://api.apify.com/v2';
const TRENDING_SOUNDS_ACTOR = 'clockworks~tiktok-scraper';
const IG_SCRAPER_ACTOR = 'apify~instagram-scraper';
const TIKTOK_SCRAPER_ACTOR = 'clockworks~tiktok-scraper';
// Reddit scraper — the actor id is a Setting (REDDIT_ACTOR) so it can be swapped
// without a deploy if Apify renames/retires it; this is the current default.
const REDDIT_ACTOR_DEFAULT = 'trudax~reddit-scraper-lite';

async function getToken() {
  const t = await getSetting('APIFY_API_TOKEN');
  if (!t) throw new Error('APIFY_API_TOKEN not set in Settings');
  return t;
}

// Run an actor synchronously and return its dataset items. Apify's
// run-sync-get-dataset-items endpoint blocks the HTTP request for up
// to 5 minutes by default, which covers our scraper runs cleanly.
async function runActorSync(actorId, input, { timeoutSec = 240 } = {}) {
  const token = await getToken();
  const { data } = await axios.post(
    `${BASE_URL}/acts/${actorId}/run-sync-get-dataset-items`,
    input,
    {
      params: { token, timeout: timeoutSec, format: 'json' },
      headers: { 'Content-Type': 'application/json' },
      timeout: (timeoutSec + 10) * 1000,
    }
  );
  return data;
}

// Top trending TikTok sounds in a region. The actor returns a mix of
// video metadata, search-results, and music objects depending on the
// input — we filter for items that look like music/sound entries and
// normalise the shape.
async function fetchTrendingSounds({ region = 'GB', limit = 25 } = {}) {
  const input = {
    searchQueries: ['trending sounds'],
    resultsPerPage: limit,
    countryCode: region.toLowerCase(),
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
  };
  const items = await runActorSync(TRENDING_SOUNDS_ACTOR, input);
  const sounds = [];
  const seen = new Set();
  for (const item of (Array.isArray(items) ? items : [])) {
    const music = item.musicMeta || item.music || item;
    const id = music?.musicId || music?.id;
    const title = music?.musicName || music?.title;
    const author = music?.musicAuthor || music?.authorName;
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    sounds.push({
      id, title, author,
      use_count: item.playCount || music?.useCount || null,
      cover_url: music?.coverThumb || music?.coverMedium || null,
      tiktok_url: music?.playUrl || (id ? `https://www.tiktok.com/music/${encodeURIComponent(title.replace(/\s+/g, '-'))}-${id}` : null),
    });
    if (sounds.length >= limit) break;
  }
  return sounds;
}

// Pull the latest posts (reels + feed) for a public Instagram handle.
// resultsLimit caps how many we ask the scraper to return — the
// competitor tracker cron uses 5. Returns a normalised shape with
// view_count / likes_count / hook + the raw shortcode for permalink.
async function fetchInstagramUserPosts(handle, { limit = 5 } = {}) {
  const cleaned = String(handle).replace(/^@/, '').trim();
  if (!cleaned) return [];
  const input = {
    directUrls: [`https://www.instagram.com/${encodeURIComponent(cleaned)}/`],
    resultsType: 'posts',
    resultsLimit: limit,
    addParentData: false,
  };
  const items = await runActorSync(IG_SCRAPER_ACTOR, input, { timeoutSec: 300 });
  return (Array.isArray(items) ? items : [])
    .filter(it => it && (it.shortCode || it.id))
    .slice(0, limit)
    .map(it => ({
      external_id: String(it.id || it.shortCode),
      post_url: it.url || (it.shortCode ? `https://www.instagram.com/p/${it.shortCode}/` : null),
      thumbnail_url: it.displayUrl || it.thumbnailUrl || null,
      caption: it.caption || '',
      hook: firstLine(it.caption),
      view_count: Number(it.videoViewCount || it.videoPlayCount || 0) || null,
      likes_count: Number(it.likesCount || 0) || null,
      comments_count: Number(it.commentsCount || 0) || null,
      posted_at: it.timestamp ? new Date(it.timestamp) : null,
    }));
}

// Same shape for TikTok. Returns the top recent videos for a handle.
async function fetchTikTokUserPosts(handle, { limit = 5 } = {}) {
  const cleaned = String(handle).replace(/^@/, '').trim();
  if (!cleaned) return [];
  const input = {
    profiles: [cleaned],
    resultsPerPage: limit,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
  };
  const items = await runActorSync(TIKTOK_SCRAPER_ACTOR, input, { timeoutSec: 300 });
  return (Array.isArray(items) ? items : [])
    .filter(it => it && (it.id || it.videoId))
    .slice(0, limit)
    .map(it => ({
      external_id: String(it.id || it.videoId),
      post_url: it.webVideoUrl || (it.id ? `https://www.tiktok.com/@${cleaned}/video/${it.id}` : null),
      thumbnail_url: it.videoMeta?.coverUrl || it.covers?.default || null,
      caption: it.text || it.desc || '',
      hook: firstLine(it.text || it.desc),
      view_count: Number(it.playCount || it.stats?.playCount || 0) || null,
      likes_count: Number(it.diggCount || it.stats?.diggCount || 0) || null,
      comments_count: Number(it.commentCount || it.stats?.commentCount || 0) || null,
      posted_at: it.createTimeISO ? new Date(it.createTimeISO) : (it.createTime ? new Date(it.createTime * 1000) : null),
    }));
}

function firstLine(text) {
  if (!text) return null;
  const t = String(text).trim();
  const line = t.split(/\n/)[0].trim();
  return line.slice(0, 240) || null;
}

async function testCredentials() {
  try {
    const token = await getToken();
    const { data } = await axios.get(`${BASE_URL}/users/me`, { params: { token } });
    return { ok: true, message: `Connected as ${data.data?.username || 'apify user'}.` };
  } catch (err) {
    return { ok: false, message: err.response?.data?.error?.message || err.message };
  }
}

// Top posts (+ a few top comments each) from a subreddit, for pain-point
// research. Output shapes vary by actor, so we normalise defensively and skip
// non-post items (some actors also emit community/comment objects).
async function fetchSubredditPosts({ subreddit, sort = 'top', time = 'month', limit = 40 } = {}) {
  const sub = String(subreddit || '').trim().replace(/^\/?r\//i, '').replace(/[^a-z0-9_]/gi, '');
  if (!sub) throw new Error('A subreddit name is required.');
  const actor = (await getSetting('REDDIT_ACTOR')) || REDDIT_ACTOR_DEFAULT;
  const url = `https://www.reddit.com/r/${sub}/${sort}/?t=${time}`;
  const input = {
    startUrls: [{ url }],
    type: 'posts',
    sort, time,
    maxItems: limit,
    maxPostCount: limit,
    maxComments: 8,
    skipComments: false,
    proxy: { useApifyProxy: true },
  };
  const items = await runActorSync(actor, input, { timeoutSec: 180 });
  const posts = [];
  for (const it of (Array.isArray(items) ? items : [])) {
    const title = it.title || it.postTitle;
    if (!title) continue;                                   // skip comment/community rows
    const body = it.body || it.text || it.selftext || it.postText || '';
    const comments = Array.isArray(it.comments)
      ? it.comments.map(c => (typeof c === 'string' ? c : (c.body || c.text || ''))).filter(Boolean).slice(0, 8)
      : [];
    posts.push({
      title: String(title).slice(0, 300),
      body: String(body).slice(0, 1500),
      score: it.upVotes ?? it.score ?? it.ups ?? null,
      num_comments: it.numberOfComments ?? it.numComments ?? it.commentsCount ?? null,
      url: it.url || it.link || null,
      comments,
    });
    if (posts.length >= limit) break;
  }
  return posts;
}

module.exports = { runActorSync, fetchTrendingSounds, fetchInstagramUserPosts, fetchTikTokUserPosts, fetchSubredditPosts, testCredentials };
