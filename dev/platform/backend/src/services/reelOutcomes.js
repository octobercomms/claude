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
async function record({ clientId, assetId = null, postId = null, words = [],
  template = null, durationS = null, brand = null }) {
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
    const result = mod.checkReel({
      timings: words,
      edit: { duration_s: durationS, caption_template: template, brand: name },
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

module.exports = { record, learn };
