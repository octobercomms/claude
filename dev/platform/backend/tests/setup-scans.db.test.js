/**
 * The nine setup scans, against a real Postgres.
 *
 * The claims worth checking are about money and order, and both are SQL
 * claims. That a scan which has already run is not paid for twice. That a
 * scan missing its inputs is skipped and said so rather than failing
 * mid-spend. That Competitors runs before the two scans that read the list it
 * fills, so ticking all three in one press works. And that one client's
 * results never answer for another's.
 *
 * No scan is actually run here: every one of them would call Claude or a paid
 * API. The branches exercised are the ones that decide whether to.
 *
 *   DB_HOST=/tmp DB_PORT=55434 DB_NAME=omi DB_USER=postgres node tests/setup-scans.db.test.js
 */
const pool = require('../src/db');
const setupScans = require('../src/services/setupScans');

const byKeyOf = (c, k) => c.scans.find(s => s.key === k);
const byKey = byKeyOf;
const clientCompetitors = require('../src/services/clientCompetitors');
const subs = require('../src/services/subredditResearch');

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ok  ', label);
  else { console.log('  FAIL', label, extra); failures += 1; }
};

const WITH = '66666666-6666-4666-8666-666666666666';   // has a domain
const WITHOUT = '77777777-7777-4777-8777-777777777777'; // has none

async function fixture() {
  await pool.query(
    `INSERT INTO clients (id, name, slug, domain, briefing_field) VALUES
       ($1, 'Hillcroft Gardens', 'hillcroft-scans-test', 'hillcroftgardens.co.uk', 'Garden design in Surrey.'),
       ($2, 'No Site', 'nosite-scans-test', NULL, 'A client whose website is not on file.')
     ON CONFLICT (id) DO NOTHING`, [WITH, WITHOUT]);
  await pool.query('DELETE FROM client_subreddits WHERE client_id = ANY($1)', [[WITH, WITHOUT]]);
  await pool.query('DELETE FROM local_seo_runs WHERE client_id = ANY($1)', [[WITH, WITHOUT]]);
  await pool.query('DELETE FROM client_competitors WHERE client_id = ANY($1)', [[WITH, WITHOUT]]);
}

(async () => {
  await fixture();

  // --- the catalogue is nine, in the order the runner uses ----------------
  const cat = await setupScans.catalogue(WITH);
  ok(cat.scans.length === 9, 'nine scans', String(cat.scans.length));
  ok(cat.scans[0].key === 'competitors',
    'Competitors is first, because two of the others read its list', cat.scans[0].key);
  ok(cat.scans.every(s => s.what && s.feature),
    'each says what it produces and which feature pays for it');
  // Three, not four: the X-ray needs a domain and competitors, which the
  // client record can supply, so it is not one of the ones that asks.
  ok(cat.scans.filter(s => s.wants_service_city).length === 3,
    'three need a service and a city', String(cat.scans.filter(s => s.wants_service_city).length));
  ok(byKeyOf(cat, 'business_xray').needs.join() === 'domain,competitors',
    'and the X-ray asks for neither', JSON.stringify(byKeyOf(cat, 'business_xray').needs));

  // --- what a scan is waiting on, said before the button is pressed -------
  ok(byKey(cat, 'local_gap').missing.includes('competitors'),
    'the gap scan reports the competitor list it is missing');
  ok(byKey(cat, 'schema').missing.length === 0,
    'the schema audit is ready, because this client has a domain', JSON.stringify(byKey(cat, 'schema').missing));
  const noSite = await setupScans.catalogue(WITHOUT);
  ok(byKey(noSite, 'schema').missing.includes('domain'),
    'and reports the domain it is missing on a client without one');
  ok(byKey(noSite, 'schema').missing_labels.join().includes('website'),
    'in words rather than a key', JSON.stringify(byKey(noSite, 'schema').missing_labels));

  // --- a scan with no inputs is skipped, not failed and not charged -------
  let out = await setupScans.run(WITH, { scans: ['keyword_sniper'] });
  ok(out.skipped === 1 && out.created === 0,
    'a local scan with no service or city is skipped', JSON.stringify(out.results));
  ok(/service and a city/.test(out.results[0].reason || ''),
    'and says what it wanted', out.results[0].reason);

  out = await setupScans.run(WITH, { scans: ['local_gap'] });
  ok(out.skipped === 1, 'so is the gap scan with no competitors stored');
  ok(/tick Competitors too/.test(out.results[0].reason || ''),
    'and it says how to fix that in the same press', out.results[0].reason);

  // --- an existing result is never paid for twice -------------------------
  // The find branch is what stands between a second press and a second bill,
  // so it is checked against real rows rather than a mock.
  await clientCompetitors.add(WITH, { name: 'Marcus Barnett', domain: 'marcusbarnett.com', source: 'manual' });
  await subs.addSubreddit(WITH, { name: 'GardeningUK' });
  await pool.query(
    `INSERT INTO local_seo_runs (client_id, tool, title, input_json, output_json)
     VALUES ($1, 'schema_audit', 'x', '{}'::jsonb, '{}'::jsonb)`, [WITH]);

  out = await setupScans.run(WITH, { scans: ['competitors', 'subreddits', 'schema'] });
  ok(out.existed === 3 && out.created === 0 && out.failed === 0,
    'three scans that have already run cost nothing', JSON.stringify(out.results));

  // Order is load-bearing and the tick order must not decide it: Competitors
  // fills the list that the gap scan and the X-ray read, so ticking them the
  // other way round still has to run Competitors first. Checked on the three
  // already-stored scans, which costs nothing to run.
  out = await setupScans.run(WITH, { scans: ['schema', 'subreddits', 'competitors'] });
  ok(out.results.map(r => r.key).join() === 'competitors,subreddits,schema',
    'the catalogue order decides the run order, not the order they were ticked',
    JSON.stringify(out.results.map(r => r.key)));

  const again = await setupScans.catalogue(WITH);
  ok(byKey(again, 'competitors').present && byKey(again, 'subreddits').present && byKey(again, 'schema').present,
    'and the catalogue says so before you tick them');
  ok(byKey(again, 'local_gap').missing.length === 0,
    'with a competitor stored, the gap scan is ready', JSON.stringify(byKey(again, 'local_gap').missing));

  // --- one client's results do not answer for another's -------------------
  const other = await setupScans.catalogue(WITHOUT);
  ok(!byKey(other, 'competitors').present && !byKey(other, 'subreddits').present,
    'the other client has nothing run');
  out = await setupScans.run(WITHOUT, { scans: ['schema'] });
  ok(out.skipped === 1, 'and its schema audit is skipped for want of a domain, not reported as already run',
    JSON.stringify(out.results));

  // --- the ticks are validated -------------------------------------------
  let threw = null;
  try { await setupScans.run(WITH, { scans: [] }); } catch (e) { threw = e; }
  ok(threw && threw.status === 400, 'running nothing is a 400', String(threw && threw.status));
  out = await setupScans.run(WITH, { scans: ['competitors', 'not_a_scan'] });
  ok(out.results.length === 1 && out.results[0].key === 'competitors',
    'an unknown key is dropped rather than run', JSON.stringify(out.results.map(r => r.key)));
  // And a press of nothing but unknown keys is the same as a press of
  // nothing: a 400, rather than a silent success that ran no scans.
  threw = null;
  try { await setupScans.run(WITH, { scans: ['not_a_scan', 'also_not'] }); } catch (e) { threw = e; }
  ok(threw && threw.status === 400,
    'and a press of only unknown keys is a 400, not an empty success', String(threw && threw.status));

  await pool.query('DELETE FROM client_subreddits WHERE client_id = ANY($1)', [[WITH, WITHOUT]]);
  await pool.query('DELETE FROM local_seo_runs WHERE client_id = ANY($1)', [[WITH, WITHOUT]]);
  await pool.query('DELETE FROM client_competitors WHERE client_id = ANY($1)', [[WITH, WITHOUT]]);
  await pool.end();
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
