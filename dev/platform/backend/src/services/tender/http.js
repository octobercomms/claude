// Tender Agent — polite HTTP for portal feeds.
// Guardrails from the brief: descriptive user agent, one request per second per
// host, exponential backoff on failure, and we never touch a login or paywall.
// Every adapter fetches through here so those rules hold everywhere.

const axios = require('axios');

const USER_AGENT = 'OctoberOMI-TenderAgent/1.0 (+https://octobercomms.com; contact octobercomms@gmail.com)';
const MIN_GAP_MS = 1000; // ≥ 1s between requests to the same host

const lastHitAt = new Map(); // host -> timestamp

function hostOf(url) {
  try { return new URL(url).host; } catch { return url; }
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function throttle(host) {
  const now = Date.now();
  const prev = lastHitAt.get(host) || 0;
  const gap = now - prev;
  if (gap < MIN_GAP_MS) await wait(MIN_GAP_MS - gap);
  lastHitAt.set(host, Date.now());
}

// GET with per-host throttle + exponential backoff. `type` is 'text' or 'json'.
async function get(url, { type = 'text', headers = {}, retries = 3, timeout = 20000 } = {}) {
  const host = hostOf(url);
  let attempt = 0;
  let lastErr;
  while (attempt <= retries) {
    await throttle(host);
    try {
      const res = await axios.get(url, {
        timeout,
        responseType: type === 'json' ? 'json' : 'text',
        headers: { 'User-Agent': USER_AGENT, Accept: type === 'json' ? 'application/json' : 'application/xml, text/xml, */*', ...headers },
        // We only ever read public records; don't follow into anything odd.
        maxRedirects: 5,
        validateStatus: s => s >= 200 && s < 300,
      });
      return res.data;
    } catch (err) {
      lastErr = err;
      attempt++;
      if (attempt > retries) break;
      await wait(1000 * Math.pow(2, attempt)); // 2s, 4s, 8s
    }
  }
  throw new Error(`GET ${url} failed after ${retries + 1} attempts: ${lastErr?.message || 'unknown error'}`);
}

module.exports = { get, USER_AGENT, hostOf };
