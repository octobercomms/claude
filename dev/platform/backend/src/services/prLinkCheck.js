/**
 * Coverage URL liveness checker. Publications restructure URLs, magazines
 * purge archives, paywalls move pieces — the editorial log silently rots.
 * This runs HEAD against each story URL and classifies the result so the AM
 * can spot dead links and hunt for the new one.
 *
 * Classification is conservative on purpose. We only flag 'broken' when we're
 * pretty sure (404 / 410 / DNS / connection refused). Anti-bot 403s, rate
 * limits and 5xx fall under 'uncertain' so a Cloudflare blip doesn't paint
 * the AM's coverage table red.
 */
const axios = require('axios');
const db = require('../db');

// Pretend to be a real browser. Bare axios UA gets bounced by a lot of news
// publication CDNs (we don't need stealth; we just need to not look like a
// scraper to the lazy bot filters).
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
};
const TIMEOUT_MS = 8000;

function classify(statusCode) {
  if (statusCode >= 200 && statusCode < 300) return 'ok';
  if (statusCode === 404 || statusCode === 410) return 'broken';
  // 401/403/406/429/5xx are publication-side hostility or transient. The page
  // might be fine for a real reader — flag uncertain so the AM can eyeball it.
  if (statusCode === 401 || statusCode === 403 || statusCode === 406) return 'uncertain';
  if (statusCode === 429) return 'uncertain';
  if (statusCode >= 500 && statusCode < 600) return 'uncertain';
  if (statusCode >= 300 && statusCode < 400) return 'uncertain'; // shouldn't happen, axios follows redirects
  return 'uncertain';
}

/** Probe one URL. Returns {status, statusCode, finalUrl}. */
async function probe(url) {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return { status: 'broken', statusCode: 0, finalUrl: null };
  }
  // HEAD first — cheap. Fall back to GET if the origin rejects HEAD (some
  // CDNs return 405 / 403 on HEAD but happily serve GET).
  const opts = {
    timeout: TIMEOUT_MS,
    maxRedirects: 5,
    headers: HEADERS,
    validateStatus: () => true, // we classify, don't throw
  };
  try {
    const r = await axios.head(url, opts);
    if (r.status === 405 || r.status === 403 || r.status === 501) {
      // Re-try with GET — many CDNs (Cloudflare-fronted news sites) refuse
      // HEAD but serve a normal GET. Avoid downloading the whole article body.
      try {
        const g = await axios.get(url, { ...opts, responseType: 'stream' });
        // Abort the body stream immediately — we only care about the status
        // and the redirect chain.
        try { g.data.destroy(); } catch { /* ignore */ }
        return {
          status: classify(g.status),
          statusCode: g.status,
          finalUrl: (g.request && (g.request.res && g.request.res.responseUrl)) || null,
        };
      } catch (e) {
        return classifyError(e);
      }
    }
    return {
      status: classify(r.status),
      statusCode: r.status,
      finalUrl: (r.request && (r.request.res && r.request.res.responseUrl)) || null,
    };
  } catch (e) {
    return classifyError(e);
  }
}

function classifyError(e) {
  const code = e && e.code;
  // DNS failure and connection-refused are high-confidence "this URL is dead".
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { status: 'broken', statusCode: 0, finalUrl: null };
  if (code === 'ECONNREFUSED') return { status: 'broken', statusCode: 0, finalUrl: null };
  // Timeouts and TLS errors are transient or publication-misconfig — flag
  // uncertain so we don't cry wolf on a slow article page.
  return { status: 'uncertain', statusCode: 0, finalUrl: null };
}

/**
 * Probe every entry with a story_url for a client (or all clients if null).
 * Writes link_status / link_status_code / link_checked_at / link_final_url back
 * to the DB. Returns counts.
 *
 * Concurrency: small — we don't want to hammer one publication if they happen
 * to host 20 of a client's pieces.
 */
async function checkAllForClient(clientId) {
  const where = clientId ? 'WHERE l.client_id = $1 AND l.story_url IS NOT NULL AND l.story_url <> \'\'' : 'WHERE l.story_url IS NOT NULL AND l.story_url <> \'\'';
  const params = clientId ? [clientId] : [];
  const { rows } = await db.query(`SELECT l.id, l.story_url FROM pr_editorial_log l ${where} ORDER BY l.id`, params);
  const summary = { checked: 0, ok: 0, broken: 0, uncertain: 0 };

  const CONCURRENCY = 4;
  const queue = rows.slice();
  async function worker() {
    while (queue.length) {
      const row = queue.shift();
      try {
        const r = await probe(row.story_url);
        summary.checked++;
        summary[r.status]++;
        await db.query(
          `UPDATE pr_editorial_log
             SET link_status = $1, link_status_code = $2, link_checked_at = NOW(), link_final_url = $3
           WHERE id = $4`,
          [r.status, r.statusCode || null, r.finalUrl, row.id]
        );
      } catch { /* per-row failures don't abort the batch */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  return summary;
}

module.exports = { probe, classify, checkAllForClient };
