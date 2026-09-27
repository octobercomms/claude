/**
 * Media database health — what is actually in the press database, read from
 * the data rather than estimated.
 *
 * Why this exists: planning the enrichment programme (countries, desks,
 * freelancer research) against guessed volumes produces guessed costs. Every
 * figure quoted before this screen came from a cost model, not a count. This
 * reads the real numbers so the schedule and the budget come from the
 * database.
 *
 * Read-only and free: plain aggregates over tables we already have. No AI, no
 * external calls, nothing to meter.
 *
 * Every section degrades independently. A missing table or a slow query
 * returns null for that section rather than failing the screen, because a
 * partial picture still answers most of the questions.
 */
const pool = require('../db');

/** Run a query, returning null instead of throwing so one bad section can't take the page down. */
async function safely(label, fn) {
  try { return await fn(); }
  catch (err) {
    console.warn(`[mediaHealth] ${label} failed:`, err.message);
    return null;
  }
}

// Media contacts we would ever consider sending to. Merged-away duplicates are
// excluded everywhere: they are tombstones pointing at a surviving row, and
// counting them would inflate every number on the screen.
const LIVE_MEDIA = `
  c.kind = 'media' AND c.merged_into IS NULL`;

/** Scale: how many contacts, at how many outlets, and how many are unattached. */
async function scale() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)::int                                                       AS contacts,
      COUNT(*) FILTER (WHERE c.email IS NOT NULL AND c.email <> '')::int  AS with_email,
      COUNT(DISTINCT c.outlet_id)::int                                    AS linked_outlets,
      COUNT(*) FILTER (WHERE c.outlet_id IS NULL)::int                    AS no_outlet,
      -- company is free text, so this counts the distinct names we would have
      -- to resolve if we wanted every contact attached to a real outlet row.
      COUNT(DISTINCT NULLIF(TRIM(LOWER(c.company)), ''))::int             AS distinct_companies
    FROM outreach_contacts c WHERE ${LIVE_MEDIA}`);
  const { rows: outlets } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE rss_status = 'found')::int AS with_feed,
            COUNT(*) FILTER (WHERE url IS NOT NULL AND url <> '')::int AS with_url
       FROM pr_outlets WHERE merged_into IS NULL`);
  return { ...rows[0], outlets: outlets[0] };
}

/**
 * Feed coverage — the number that decides whether this programme is cheap.
 *
 * A contact whose byline we already see in an RSS feed is one we can keep
 * current for nothing: activity, beat, market and format all fall out of real
 * article titles. A contact with no feed needs paid search. The ratio between
 * these two is the whole cost of the plan.
 */
async function feedCoverage() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)::int AS contacts,
      COUNT(*) FILTER (
        WHERE EXISTS (SELECT 1 FROM pr_outlets o
                       WHERE o.id = c.outlet_id AND o.rss_status = 'found'))::int AS at_outlet_with_feed,
      COUNT(*) FILTER (
        WHERE EXISTS (SELECT 1 FROM pr_outlet_articles a WHERE a.contact_id = c.id))::int AS byline_seen,
      COUNT(*) FILTER (
        WHERE EXISTS (SELECT 1 FROM pr_outlet_articles a
                       WHERE a.contact_id = c.id
                         AND a.published_at > NOW() - INTERVAL '180 days'))::int AS byline_recent
    FROM outreach_contacts c WHERE ${LIVE_MEDIA}`);
  const { rows: arts } = await pool.query(
    `SELECT COUNT(*)::int AS articles,
            COUNT(*) FILTER (WHERE contact_id IS NOT NULL)::int AS attributed,
            MAX(published_at) AS newest
       FROM pr_outlet_articles`);
  return { ...rows[0], articles: arts[0] };
}

/**
 * What the sends already told us. This is the richest signal in the database
 * and nothing currently reads it: every open, reply and piece of coverage is
 * evidence of who is live, gathered for free over years of sending.
 *
 * Opens are soft — Apple Mail Privacy Protection fires them without a human
 * reading anything — so they are reported separately from replies and
 * coverage, which are ground truth.
 */
async function engagement() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(DISTINCT s.contact_id)::int                                          AS ever_sent,
      COUNT(DISTINCT s.contact_id) FILTER (WHERE s.opened_at IS NOT NULL)::int   AS ever_opened,
      COUNT(DISTINCT s.contact_id) FILTER (WHERE s.replied_at IS NOT NULL)::int  AS ever_replied,
      COUNT(DISTINCT s.contact_id) FILTER (
        WHERE s.sent_at > NOW() - INTERVAL '365 days')::int                      AS sent_last_year,
      COUNT(DISTINCT s.contact_id) FILTER (
        WHERE s.opened_at > NOW() - INTERVAL '365 days')::int                    AS opened_last_year
    FROM outreach_sends s
    JOIN outreach_contacts c ON c.id = s.contact_id
   WHERE ${LIVE_MEDIA} AND s.status = 'sent'`);
  // Coverage is the hardest evidence there is: they wrote about a client.
  const { rows: cov } = await pool.query(
    `SELECT COUNT(*)::int AS entries,
            COUNT(DISTINCT outlet_id)::int AS outlets,
            COUNT(*) FILTER (WHERE country <> '')::int AS with_country
       FROM pr_editorial_log`);
  // Never sent to, so no engagement signal exists either way.
  const { rows: never } = await pool.query(`
    SELECT COUNT(*)::int AS n FROM outreach_contacts c
     WHERE ${LIVE_MEDIA}
       AND NOT EXISTS (SELECT 1 FROM outreach_sends s WHERE s.contact_id = c.id AND s.status = 'sent')`);
  return { ...rows[0], never_sent: never[0].n, coverage: cov[0] };
}

/** Which fields are filled in, which is where the enrichment gaps actually are. */
async function fieldCoverage() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)::int AS contacts,
      COUNT(*) FILTER (WHERE c.email    IS NOT NULL AND c.email   <> '')::int AS email,
      COUNT(*) FILTER (WHERE c.name     IS NOT NULL AND c.name    <> '')::int AS name,
      COUNT(*) FILTER (WHERE c.company  IS NOT NULL AND c.company <> '')::int AS company,
      COUNT(*) FILTER (WHERE c.outlet_id IS NOT NULL)::int                    AS outlet_linked,
      COUNT(*) FILTER (WHERE c.location IS NOT NULL AND c.location <> '')::int AS location,
      COUNT(*) FILTER (WHERE c.contact_type IS NOT NULL AND c.contact_type <> '')::int AS contact_type,
      COUNT(*) FILTER (WHERE COALESCE(array_length(c.tags, 1), 0) > 0)::int   AS tagged,
      COUNT(*) FILTER (WHERE jsonb_array_length(COALESCE(c.topics, '[]'::jsonb)) > 0)::int      AS topics,
      COUNT(*) FILTER (WHERE jsonb_array_length(COALESCE(c.auto_topics, '[]'::jsonb)) > 0)::int AS auto_topics
    FROM outreach_contacts c WHERE ${LIVE_MEDIA}`);
  return rows[0];
}

/** Who is off-limits, and why. Sums do not add up: a contact can be several at once. */
async function suppression() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE c.status = 'do_not_contact')::int AS do_not_contact,
      COUNT(*) FILTER (WHERE c.bounced_at IS NOT NULL)::int    AS bounced,
      COUNT(*) FILTER (WHERE c.archive_suggested)::int         AS archive_suggested
    FROM outreach_contacts c WHERE ${LIVE_MEDIA}`);
  const { rows: perClient } = await pool.query(
    `SELECT COUNT(DISTINCT contact_id) FILTER (WHERE unsubscribed_at IS NOT NULL)::int AS unsubscribed,
            COUNT(DISTINCT contact_id) FILTER (WHERE excluded_at IS NOT NULL)::int     AS excluded
       FROM outreach_contact_clients`);
  return { ...rows[0], ...perClient[0] };
}

/**
 * Turn the counts into the only question that matters: what does enriching
 * this database cost, and how long does it take at a given monthly budget.
 *
 * Unit costs are measured-once estimates, not invoices. They are stated here
 * so the arithmetic is visible and correctable rather than buried: run the
 * first outlet pass, read the real figure out of the cost log, and replace
 * them. Until then this is an estimate that says so.
 */
const UNIT_COSTS = {
  outlet_pass_usd: 0.035,   // masthead/media-kit/contact crawl + ~2 searches, Haiku
  desk_check_usd: 0.015,    // a contact at an already-researched outlet
  freelancer_usd: 0.06,     // live search: no outlet to anchor to, no feed
};

function projection({ scale: sc, feeds }) {
  if (!sc || !feeds) return null;
  const outlets = sc.outlets?.total || 0;
  // A contact we can anchor to an outlet is cheap. One with no outlet link is
  // the expensive kind: a freelancer or an unresolved record needing search.
  const anchored = Math.max(0, sc.contacts - sc.no_outlet);
  const unanchored = sc.no_outlet || 0;
  const cost = {
    outlets_usd: outlets * UNIT_COSTS.outlet_pass_usd,
    anchored_usd: anchored * UNIT_COSTS.desk_check_usd,
    unanchored_usd: unanchored * UNIT_COSTS.freelancer_usd,
  };
  cost.total_usd = cost.outlets_usd + cost.anchored_usd + cost.unanchored_usd;
  const months = (budget) => (budget > 0 ? Math.ceil(cost.total_usd / budget) : null);
  return {
    unit_costs: UNIT_COSTS,
    counts: { outlets, anchored, unanchored },
    cost,
    months_at: { 30: months(30), 50: months(50), 100: months(100) },
    basis: 'estimated',   // becomes 'measured' once a real pass has run
  };
}

async function snapshot() {
  const [sc, feeds, eng, fields, supp] = await Promise.all([
    safely('scale', scale),
    safely('feeds', feedCoverage),
    safely('engagement', engagement),
    safely('fields', fieldCoverage),
    safely('suppression', suppression),
  ]);
  return {
    generated_at: new Date().toISOString(),
    scale: sc, feeds, engagement: eng, fields, suppression: supp,
    projection: projection({ scale: sc, feeds }),
    partial: [sc, feeds, eng, fields, supp].some((x) => x === null),
  };
}

module.exports = { snapshot, UNIT_COSTS };
