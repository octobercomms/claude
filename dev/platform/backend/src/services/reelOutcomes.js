/**
 * Record what the reel checks said, and later report what they were worth.
 *
 * The arithmetic is in shared/reelOutcomes.mjs, which is pure and tested. This
 * is the half that needs the database: writing a judgement at production time,
 * and reading it back beside the engagement the publisher brought home.
 *
 * Nothing here changes a reel or a post. It writes one row per reel produced
 * and reads two tables.
 */
const pool = require('../db');
const { pathToFileURL } = require('url');
const path = require('path');
const socialBaseline = require('./socialBaseline');

const SHARED = path.join(__dirname, '..', '..', '..', 'shared');

let _mods = null;
async function mods() {
  if (!_mods) {
    const [checks, outcomes] = await Promise.all([
      import(pathToFileURL(path.join(SHARED, 'reelChecks.mjs')).href),
      import(pathToFileURL(path.join(SHARED, 'reelOutcomes.mjs')).href),
    ]);
    _mods = { checks, outcomes };
  }
  return _mods;
}

/**
 * Judge a reel and record the judgement.
 *
 * Called from the production path, where the words, the template and the
 * duration are all in hand. Like assets.record, it NEVER throws at its caller:
 * a finished reel must not be lost because the row that scores it could not be
 * written. A missing row costs one data point; a thrown error costs the render.
 */
/**
 * The search terms a client is tracking, most-searched first.
 *
 * Capped, because the check asks "does this reel say any of them" and a list
 * of four hundred makes that true by accident. The ones with volume are the
 * ones worth saying.
 */
async function keywordsFor(clientId, limit = 60) {
  const { rows } = await pool.query(
    `SELECT keyword FROM seo_keywords
      WHERE client_id = $1 AND active = true
      ORDER BY search_volume DESC NULLS LAST, keyword
      LIMIT $2`, [clientId, limit]);
  return rows.map((r) => r.keyword);
}

async function record({ clientId, assetId = null, postId = null, words = [],
  template = null, durationS = null, brand = null, onScreenText = null }) {
  try {
    const { checks: mod } = await mods();
    // The "not the account talking about itself" check counts how often the
    // brand is named, and the brand is the client's name: that is what the
    // panel in the editor passes. Resolved here rather than at each call site,
    // so a judgement taken on the server and one shown in the browser are
    // answering the same question.
    let name = brand;
    if (!name) {
      const { rows } = await pool.query('SELECT name FROM clients WHERE id = $1', [clientId]);
      name = rows[0]?.name || null;
    }
    // The same terms the panel checks against, read here rather than passed
    // in, so a judgement taken on the server and one shown in the browser
    // cannot disagree about what this client is trying to be found for.
    const terms = await keywordsFor(clientId);
    const result = mod.checkReel({
      timings: words,
      edit: { duration_s: durationS, caption_template: template, brand: name,
        keywords: terms, on_screen_text: onScreenText },
    });
    const slim = result.checks.map((c) => ({ key: c.key, pass: c.pass }));
    const { rows } = await pool.query(
      `INSERT INTO reel_check_results
         (client_id, asset_id, post_id, checks, passed, unknown, total,
          rules_fingerprint, duration_s, words, template)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (asset_id) WHERE asset_id IS NOT NULL
       DO UPDATE SET checks = EXCLUDED.checks, passed = EXCLUDED.passed,
                     unknown = EXCLUDED.unknown, total = EXCLUDED.total,
                     rules_fingerprint = EXCLUDED.rules_fingerprint,
                     duration_s = EXCLUDED.duration_s, words = EXCLUDED.words,
                     template = EXCLUDED.template, post_id = EXCLUDED.post_id
       RETURNING *`,
      [clientId, assetId, postId, JSON.stringify(slim), result.passed,
        result.unknown, result.total, mod.RULES_FINGERPRINT,
        result.duration_s || null, Array.isArray(words) ? words.length : null, template]
    );
    return rows[0] || null;
  } catch (err) {
    console.error('[reel-checks] could not record a judgement:', err.message);
    return null;
  }
}

/**
 * What the checks have been worth for one client.
 *
 * The dependent variable is socialBaseline's reach multiple, not raw reach: an
 * account's posts grew over the period and raw reach would credit whichever
 * check happens to be commoner in recent reels. The multiple is already
 * leave-one-out against comparable posts, which is the comparison that survives
 * one viral reel.
 */
async function learn(clientId, { days = 365, measure = 'reach_multiple' } = {}) {
  const { checks: mod, outcomes } = await mods();

  const { rows: snapshots } = await pool.query(
    `SELECT post_id, checks, rules_fingerprint
       FROM reel_check_results
      WHERE client_id = $1
        AND created_at >= NOW() - ($2::int || ' days')::interval`,
    [clientId, days]
  );

  // Every published post of this client's, not only the reels: the baseline a
  // reel is measured against is drawn from comparable posts, and narrowing the
  // pool to reels that happen to carry a judgement would change what the
  // multiple means.
  const { rows: posts } = await pool.query(
    `WITH latest AS (
       SELECT DISTINCT ON (e.post_id)
         e.post_id, e.reach, e.impressions, e.views, e.likes, e.comments,
         e.shares, e.saves
         FROM social_post_engagement e
         JOIN social_posts p ON p.id = e.post_id
        WHERE p.client_id = $1
        ORDER BY e.post_id, e.fetched_at DESC
     )
     SELECT p.id, p.platform, p.kind, l.reach, l.impressions, l.views,
            l.likes, l.comments, l.shares, l.saves
       FROM latest l JOIN social_posts p ON p.id = l.post_id`,
    [clientId]
  );

  const scored = socialBaseline.score(posts);
  const learned = outcomes.learn({
    snapshots, posts: scored, fingerprint: mod.RULES_FINGERPRINT, measure });

  return {
    ...learned,
    judged: snapshots.length,
    published_posts: posts.length,
    rules_fingerprint: mod.RULES_FINGERPRINT,
    baseline: socialBaseline.explain(),
  };
}

/**
 * The recorded judgements for a client's posts, keyed by post.
 *
 * Read rather than recomputed. The judgement that counts was taken at render
 * time, when the words, the template and the duration were all in hand; the
 * browser has none of those for a finished reel, and re-judging there would
 * produce a second, worse answer that disagrees with the one the learning
 * curve is built on.
 *
 * Newest per post, because a second template on the same video writes another
 * row and the latest is the reel that exists.
 */
async function forClient(clientId, { limit = 200 } = {}) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (post_id)
            post_id, checks, passed, unknown, total, template, duration_s, created_at
       FROM reel_check_results
      WHERE client_id = $1 AND post_id IS NOT NULL
      ORDER BY post_id, created_at DESC
      LIMIT $2`,
    [clientId, limit]
  );
  const out = {};
  for (const r of rows) out[r.post_id] = r;
  return out;
}

module.exports = { record, learn, keywordsFor, forClient };
