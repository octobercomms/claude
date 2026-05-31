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

async function testCredentials() {
  try {
    const token = await getToken();
    const { data } = await axios.get(`${BASE_URL}/users/me`, { params: { token } });
    return { ok: true, message: `Connected as ${data.data?.username || 'apify user'}.` };
  } catch (err) {
    return { ok: false, message: err.response?.data?.error?.message || err.message };
  }
}

module.exports = { runActorSync, fetchTrendingSounds, testCredentials };
