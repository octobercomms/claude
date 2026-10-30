/**
 * Press attribution, against a real Postgres.
 *
 * This panel is read by an account lead and quoted to a client, and the figure
 * it used to lead on was wrong in three independent ways: it counted every
 * referring domain the whole site gained in a 21-day window, with no test that
 * the domain had anything to do with the release; two releases three weeks
 * apart both claimed the same domains; and `first_seen` is DataForSEO's
 * discovery date, so a newly-indexed site dumps years of history into one
 * window. One campaign was reading 939 referring domains.
 *
 * The defensible number, pitched_rds, was already computed per release and was
 * never in the leaderboard query at all — so a UI leading on it would have
 * shown 0 for every campaign, which is a quieter kind of wrong than 939.
 *
 * Every claim here is a SQL claim about joins, matching and grouping, so there
 * is no version of this that works without a database.
 *
 *   DB_HOST=/tmp DB_PORT=55434 DB_NAME=omi DB_USER=postgres node tests/press-attribution.db.test.js
 */
const pool = require('../src/db');
const { leaderboard, hostFrom, WINDOW_DAYS } = require('../src/services/pressAttribution');

let failures = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log('  ok  ', label);
  else { console.log('  FAIL', label, extra === undefined ? '' : `— ${JSON.stringify(extra)}`); failures += 1; }
};

const CLIENT = '44444444-4444-4444-8444-444444444444';
const OTHER  = '55555555-5555-4555-8555-555555555555';
const CAMP_A = '66666666-6666-4666-8666-666666666666';
const CAMP_B = '77777777-7777-4777-8777-777777777777';
const REL_A  = '88888888-8888-4888-8888-888888888888';
const REL_B  = '99999999-9999-4999-8999-999999999999';

const LAUNCH_A = '2026-03-01T09:00:00Z';
// Inside A's 21-day window on purpose: the old query credited every domain in
// the window to BOTH releases, and nothing in the schema stops that.
const LAUNCH_B = '2026-03-10T09:00:00Z';

async function fixture() {
  await pool.query('DELETE FROM outreach_sends WHERE campaign_id = ANY($1::uuid[])', [[CAMP_A, CAMP_B]]);
  await pool.query('DELETE FROM outreach_press_releases WHERE client_id = ANY($1::uuid[])', [[CLIENT, OTHER]]);
  await pool.query('DELETE FROM outreach_campaigns WHERE id = ANY($1::uuid[])', [[CAMP_A, CAMP_B]]);
  await pool.query('DELETE FROM outreach_contacts WHERE client_id = ANY($1::uuid[])', [[CLIENT, OTHER]]);
  await pool.query('DELETE FROM dfs_referring_domains WHERE client_id = ANY($1::uuid[])', [[CLIENT, OTHER]]);
  await pool.query('DELETE FROM clients WHERE id = ANY($1::uuid[])', [[CLIENT, OTHER]]);

  // clients.slug is NOT NULL. Two clients, because a leaderboard that cross
  // joins produces the right answer with one and nonsense with two.
  await pool.query(
    `INSERT INTO clients (id, name, slug, domain) VALUES
       ($1,'Attribution Co','attribution-co','attrib.test'),
       ($2,'Other Co','other-co','other.test')`, [CLIENT, OTHER]);

  await pool.query(
    `INSERT INTO outreach_campaigns (id, client_id, name) VALUES
       ($1,$3,'March push'), ($2,$3,'Mid-March push')`, [CAMP_A, CAMP_B, CLIENT]);

  // Four pitched outlets on campaign A. One is matched by email domain, one by
  // website, one by a www. website, one never links back.
  const contacts = [
    ['a1', 'jane@guardian.co.uk', null],
    ['a2', null, 'https://dezeen.com/about'],
    ['a3', null, 'http://www.wallpaper.com/'],
    ['a4', 'nobody@silent.test', null],
  ];
  const ids = {};
  for (const [key, email, website] of contacts) {
    const { rows } = await pool.query(
      `INSERT INTO outreach_contacts (client_id, name, email, website) VALUES ($1,$2,$3,$4) RETURNING id`,
      [CLIENT, key, email, website]);
    ids[key] = rows[0].id;
  }
  // Campaign B pitched one outlet, and a different one.
  const { rows: bRows } = await pool.query(
    `INSERT INTO outreach_contacts (client_id, name, email) VALUES ($1,'b1','ed@archdaily.com') RETURNING id`, [CLIENT]);
  ids.b1 = bRows[0].id;

  for (const key of ['a1', 'a2', 'a3', 'a4']) {
    await pool.query(
      `INSERT INTO outreach_sends (campaign_id, contact_id, status, sent_at) VALUES ($1,$2,'sent',$3)`,
      [CAMP_A, ids[key], LAUNCH_A]);
  }
  await pool.query(
    `INSERT INTO outreach_sends (campaign_id, contact_id, status, sent_at) VALUES ($1,$2,'sent',$3)`,
    [CAMP_B, ids.b1, LAUNCH_B]);

  await pool.query(
    `INSERT INTO outreach_press_releases (id, client_id, campaign_id, title) VALUES
       ($1,$3,$4,'Release A'), ($2,$3,$5,'Release B')`,
    [REL_A, REL_B, CLIENT, CAMP_A, CAMP_B]);

  // One snapshot. Six domains first seen inside A's window:
  //   3 match outlets A pitched (one of them on a subdomain)
  //   1 matches the outlet B pitched
  //   2 match nobody — the directory-and-scraper noise that used to be
  //     reported as press coverage
  const cap = '2026-04-10T00:00:00Z';
  const rds = [
    ['guardian.co.uk',        '2026-03-04T00:00:00Z', true],
    ['dezeen.com',            '2026-03-06T00:00:00Z', true],
    ['news.wallpaper.com',    '2026-03-08T00:00:00Z', false],
    ['archdaily.com',         '2026-03-12T00:00:00Z', true],
    ['some-directory.test',   '2026-03-05T00:00:00Z', true],
    ['scraper.test',          '2026-03-07T00:00:00Z', false],
    // Outside every window: must not be counted by anyone.
    ['late.test',             '2026-06-01T00:00:00Z', true],
  ];
  for (const [domain, firstSeen, dofollow] of rds) {
    await pool.query(
      `INSERT INTO dfs_referring_domains (client_id, captured_at, domain, first_seen, dofollow)
       VALUES ($1,$2,$3,$4,$5)`, [CLIENT, cap, domain, firstSeen, dofollow]);
  }
  // The same domain twice in one capture. There is no unique index on
  // (client_id, captured_at, domain), so a capture written twice really does
  // produce this, and a COUNT(*) reads it as a second piece of coverage.
  await pool.query(
    `INSERT INTO dfs_referring_domains (client_id, captured_at, domain, first_seen, dofollow)
     VALUES ($1,$2,'dezeen.com',$3,true)`, [CLIENT, cap, '2026-03-06T00:00:00Z']);

  // The other client gains a domain with the same name, to catch a join that
  // forgets to scope by client.
  await pool.query(
    `INSERT INTO dfs_referring_domains (client_id, captured_at, domain, first_seen, dofollow)
     VALUES ($1,$2,'guardian.co.uk',$3,true)`, [OTHER, cap, '2026-03-04T00:00:00Z']);
}

(async () => {
  console.log('press attribution (real Postgres)');
  await fixture();

  const rows = await leaderboard([CLIENT]);
  const byTitle = Object.fromEntries(rows.map(r => [r.title, r]));
  const A = byTitle['Release A'];
  const B = byTitle['Release B'];

  ok(rows.length === 2, 'both launched releases come back', rows.map(r => r.title));
  ok(!!A && !!B, 'each is identifiable by title');

  // ── the headline ─────────────────────────────────────────────────────
  ok(Number(A.pitched_rds) === 3,
    'A counts only the outlets it pitched that linked back', { got: A?.pitched_rds, expected: 3 });
  ok(Number(B.pitched_rds) === 1,
    'B counts only its own pitched outlet', { got: B?.pitched_rds, expected: 1 });

  // ── what the old headline would have said ────────────────────────────
  ok(Number(A.new_rds) === 6,
    'the window total counts each domain once, duplicate capture rows and all',
    { got: A?.new_rds, expected: 6 });
  ok(Number(A.new_rds) > Number(A.pitched_rds),
    'the window total is larger than the attributable figure — the whole point');

  // ── double counting ──────────────────────────────────────────────────
  // B launched 9 days after A, so archdaily (first seen on the 12th) sits in
  // both windows. The old query credited it to both; pitched matching means
  // only B, which pitched them, can claim it.
  ok(Number(B.new_rds) >= 1, 'B has domains in its own window too', { got: B?.new_rds });
  ok(Number(A.pitched_rds) + Number(B.pitched_rds) === 4,
    'no domain is claimed by two campaigns', { a: A?.pitched_rds, b: B?.pitched_rds });

  // ── matching rules ───────────────────────────────────────────────────
  // A's three are guardian.co.uk (by email), dezeen.com (by website) and
  // news.wallpaper.com (a subdomain of a www. website). If any of those three
  // forms stopped matching, the count would be 2 and this would fail.
  ok(Number(A.pitched_rds) === 3, 'email, website and www-stripped website all match');

  // ── hit rate ─────────────────────────────────────────────────────────
  ok(Number(A.recipients) === 4, 'recipients is the outlets emailed', { got: A?.recipients });
  ok(Math.abs(Number(A.pitched_rate) - 0.75) < 0.001,
    'the hit rate is linked-back over pitched, not over the window total', { got: A?.pitched_rate });

  // ── scoping ──────────────────────────────────────────────────────────
  const otherRows = await leaderboard([OTHER]);
  ok(otherRows.length === 0, 'the other client has no launched campaign of its own', otherRows.length);
  ok(Number(A.pitched_rds) === 3, "and its identical domain did not leak into this client's count");

  // ── ordering ─────────────────────────────────────────────────────────
  // A won 3 links from 4 outlets; B won 1 from 1. B's hit rate is higher
  // (100% against 75%), and the first version of this query ranked on rate, so
  // the one-outlet campaign came top. Rank on links won, break ties on rate.
  ok(rows[0].title === 'Release A',
    'ranked on links won, so a one-outlet campaign at 100% does not top the table', rows.map(r => r.title));
  ok(Number(B.pitched_rate) > Number(A.pitched_rate),
    "and B's rate really is the higher one, so that ordering is a choice and not an accident",
    { a: A?.pitched_rate, b: B?.pitched_rate });

  // ── the helper the SQL mirrors ───────────────────────────────────────
  ok(hostFrom('jane@guardian.co.uk') === 'guardian.co.uk', 'hostFrom takes the email domain');
  ok(hostFrom('http://www.wallpaper.com/') === 'wallpaper.com', 'hostFrom strips scheme, www and path');
  ok(WINDOW_DAYS === 21, 'the window is still 21 days');

  await pool.end();
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
