/**
 * The Authority fill, against a real Postgres.
 *
 * The rule that matters most here is a SQL claim and cannot be checked any
 * other way: **a fetch that fails must never blank a number that is already
 * there.** These figures go into a client's monthly report, so a month that
 * silently loses its DA because Moz was down on the 1st is a gap in a document
 * that goes to a client.
 *
 * The others are also SQL: that running twice in a month overwrites rather
 * than stacking, that a run with nothing to write leaves a hand-typed row
 * alone, and that provenance is recorded so the page can say where a number
 * came from instead of implying it.
 *
 *   DB_HOST=/tmp DB_PORT=55434 DB_NAME=omi DB_USER=postgres node tests/seo-authority.db.test.js
 */
const pool = require('../src/db');
const seoAuthority = require('../src/services/seoAuthority');

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log('  ok  ', label);
  else { console.log('  FAIL', label); failures += 1; }
};

const FALCON = '11111111-1111-4111-8111-111111111111';
const MONTH = '2026-10-01';

async function fixture({ withSnapshot = true } = {}) {
  await pool.query(
    `INSERT INTO clients (id, name, slug, domain)
       VALUES ($1,'Falcon','falcon-test','falconenamelware.com')
       ON CONFLICT (id) DO UPDATE SET domain = EXCLUDED.domain`, [FALCON]);
  await pool.query('TRUNCATE seo_manual_metrics, dfs_backlinks_summary RESTART IDENTITY CASCADE');
  if (withSnapshot) {
    // Two snapshots three days apart. The newer one must win: the sweep runs
    // every three days and the freshest answer is the right one for a
    // month-stamped row, even when an older snapshot also falls in the month.
    await pool.query(
      `INSERT INTO dfs_backlinks_summary (client_id, captured_at, backlinks_total, referring_domains_total)
       VALUES ($1, NOW() - INTERVAL '3 days', 9000, 1300),
              ($1, NOW(), 9100, 1321)`, [FALCON]);
  }
}

async function row(month = MONTH) {
  const { rows } = await pool.query(
    `SELECT moz_da, authority_score, referring_domains,
            moz_da_source, referring_domains_source, sources_filled_at
       FROM seo_manual_metrics WHERE client_id = $1 AND month = $2::date`,
    [FALCON, month]);
  return rows[0] || null;
}

(async () => {
  console.log('seo authority · database');

  // ── Referring domains comes from the snapshot already on disk ──────────
  await fixture();
  await seoAuthority.fillForClient(FALCON, { month: MONTH, withMoz: false });
  let r = await row();
  ok(r && Number(r.referring_domains) === 1321, 'referring domains taken from the newest snapshot');
  ok(r && r.referring_domains_source === 'dataforseo', 'and recorded as DataForSEO, not typed');
  ok(r && r.sources_filled_at != null, 'the fill is stamped with a time');

  // ── Running twice overwrites rather than stacking ──────────────────────
  await seoAuthority.fillForClient(FALCON, { month: MONTH, withMoz: false });
  const { rows: count } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM seo_manual_metrics WHERE client_id = $1 AND month = $2::date',
    [FALCON, MONTH]);
  ok(count[0].n === 1, 'a second run leaves one row, not two');

  // ── A failed fetch never blanks a good number ──────────────────────────
  // The month now holds a DA that a person typed before any of this existed.
  await pool.query(
    `UPDATE seo_manual_metrics SET moz_da = 48, moz_da_source = 'manual'
      WHERE client_id = $1 AND month = $2::date`, [FALCON, MONTH]);
  // Moz is off, so this run fetches referring domains and nothing else.
  await seoAuthority.fillForClient(FALCON, { month: MONTH, withMoz: false });
  r = await row();
  ok(r && Number(r.moz_da) === 48, 'a DA this run could not fetch survives the run');
  ok(r && r.moz_da_source === 'manual', 'and keeps saying it was typed');

  // ── Nothing to write means nothing is written ──────────────────────────
  // No snapshot, no Moz: the row must be left exactly as it was rather than
  // overwritten with a row of nulls.
  await pool.query('TRUNCATE dfs_backlinks_summary RESTART IDENTITY CASCADE');
  const before = await row();
  const out = await seoAuthority.fillForClient(FALCON, { month: MONTH, withMoz: false });
  const after = await row();
  ok(after && Number(after.moz_da) === Number(before.moz_da)
    && Number(after.referring_domains) === Number(before.referring_domains),
  'a run with nothing to fetch leaves the row untouched');
  ok(out.errors && out.errors.referring_domains, 'and says why it fetched nothing');

  // ── A client with no history at all ────────────────────────────────────
  await fixture();
  await pool.query('TRUNCATE seo_manual_metrics RESTART IDENTITY CASCADE');
  await pool.query('TRUNCATE dfs_backlinks_summary RESTART IDENTITY CASCADE');
  const none = await seoAuthority.fillForClient(FALCON, { month: MONTH, withMoz: false });
  ok((await row()) === null, 'no snapshot and no Moz writes no row at all');
  ok(none.referring_domains === null, 'and reports nothing fetched');

  // ── Authority score is never written ───────────────────────────────────
  await fixture();
  await seoAuthority.fillForClient(FALCON, { month: MONTH, withMoz: false });
  r = await row();
  ok(r && r.authority_score === null, 'Semrush authority score is not collected any more');

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  await pool.end();
  process.exit(failures ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
