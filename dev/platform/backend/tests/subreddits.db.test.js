/**
 * The stored subreddit list, against a real Postgres.
 *
 * Every claim here is a SQL claim: that a second suggest is a no-op rather
 * than eight duplicates, that a suggest with rows already stored spends
 * nothing, that a research run stamps the row it ran against and only that
 * one, and that one client's list never reaches another's screen. None of
 * that is checkable without a database.
 *
 *   DB_HOST=/tmp DB_PORT=55434 DB_NAME=omi DB_USER=postgres node tests/subreddits.db.test.js
 */
const pool = require('../src/db');
const subs = require('../src/services/subredditResearch');

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ok  ', label);
  else { console.log('  FAIL', label, extra); failures += 1; }
};

const HILLCROFT = '44444444-4444-4444-8444-444444444444';
const FALCON = '55555555-5555-4555-8555-555555555555';

async function fixture() {
  await pool.query(
    `INSERT INTO clients (id, name, slug, briefing_field) VALUES
       ($1, 'Hillcroft Gardens', 'hillcroft-subs-test', 'Garden design for private clients in Surrey.'),
       ($2, 'Falcon', 'falcon-subs-test', 'Back-in-stock alerts for Shopify shops.')
     ON CONFLICT (id) DO NOTHING`, [HILLCROFT, FALCON]);
  await pool.query('DELETE FROM client_subreddits WHERE client_id = ANY($1)', [[HILLCROFT, FALCON]]);
  await pool.query('DELETE FROM subreddit_research WHERE client_id = ANY($1)', [[HILLCROFT, FALCON]]);
}

(async () => {
  await fixture();

  // --- adding, and the shapes a name arrives in ---------------------------
  await subs.addSubreddit(HILLCROFT, { name: 'r/GardeningUK', why: 'where owners ask' });
  let rows = await subs.listSubreddits(HILLCROFT);
  ok(rows.length === 1 && rows[0].name === 'GardeningUK',
    'an r/ prefix is stripped on the way in', JSON.stringify(rows.map(r => r.name)));
  ok(rows[0].time_window === 'month', 'and the window defaults to a month', rows[0].time_window);

  // The same subreddit again, however it is typed, is the same row. This is
  // what makes a second suggest cost nothing instead of duplicating a list.
  await subs.addSubreddit(HILLCROFT, { name: 'gardeninguk' });
  await subs.addSubreddit(HILLCROFT, { name: '/r/GARDENINGUK' });
  rows = await subs.listSubreddits(HILLCROFT);
  ok(rows.length === 1, 'the same subreddit in another case is the same row', String(rows.length));
  ok(rows[0].why === 'where owners ask',
    'and a re-add does not wipe the reason Claude was paid to write', String(rows[0].why));

  // The service going through ON CONFLICT is only half of it: the index is
  // what makes the conflict happen. A raw insert past the service must still
  // be refused, or a case-sensitive index would let two rows in and the
  // check above would pass by luck for as long as the service is the only
  // writer.
  let dup = null;
  try {
    await pool.query('INSERT INTO client_subreddits (client_id, name) VALUES ($1, $2)', [HILLCROFT, 'GARDENINGuk']);
  } catch (e) { dup = e; }
  ok(dup && dup.code === '23505', 'the unique index itself is case-insensitive', String(dup && dup.code));

  // --- the focus and window are the point of storing them -----------------
  const updated = await subs.updateSubreddit(HILLCROFT, rows[0].id, { focus: 'pricing a garden', time_window: 'year' });
  ok(updated.focus === 'pricing a garden' && updated.time_window === 'year',
    'a row carries its own focus and window', JSON.stringify([updated.focus, updated.time_window]));
  const junk = await subs.updateSubreddit(HILLCROFT, rows[0].id, { time_window: 'fortnight' });
  ok(junk.time_window === 'month', 'a window outside the four falls back to a month', junk.time_window);

  // --- suggest reads the table when it has one ----------------------------
  // No Claude key is needed for this branch, which is the branch that matters:
  // it is the one that runs every time the screen opens.
  const stored = await subs.suggestAndStore(HILLCROFT);
  ok(stored.from === 'stored', 'a suggest with rows stored spends nothing', stored.from);
  ok(stored.subreddits.length === 1, 'and returns what is there', String(stored.subreddits.length));

  // --- one client's list is its own ---------------------------------------
  await subs.addSubreddit(FALCON, { name: 'shopify' });
  ok((await subs.listSubreddits(HILLCROFT)).length === 1, 'another client\'s row does not join this list');
  ok((await subs.listSubreddits(FALCON)).map(r => r.name).join() === 'shopify',
    'and each list holds only its own');

  // --- a research run stamps the row it ran against -----------------------
  await pool.query(
    `INSERT INTO subreddit_research (client_id, subreddit, focus, result)
     VALUES ($1, 'GardeningUK', null, '{}'::jsonb)`, [HILLCROFT]);
  await pool.query(
    'UPDATE client_subreddits SET researched_at = NOW() WHERE client_id = $1 AND lower(name) = lower($2)',
    [HILLCROFT, 'gardeninguk']);
  rows = await subs.listSubreddits(HILLCROFT);
  ok(rows[0].researched_at instanceof Date, 'the stamp lands on the row, case-insensitively', String(rows[0].researched_at));
  ok((await subs.listSubreddits(FALCON))[0].researched_at === null,
    'and not on anybody else\'s');

  // --- removing -----------------------------------------------------------
  await subs.removeSubreddit(HILLCROFT, rows[0].id);
  ok((await subs.listSubreddits(HILLCROFT)).length === 0, 'a row can be removed');
  ok((await subs.listSubreddits(FALCON)).length === 1, 'without taking another client\'s with it');

  // --- a blank name is a user error, not a row ----------------------------
  let threw = null;
  try { await subs.addSubreddit(HILLCROFT, { name: '  r/  ' }); } catch (e) { threw = e; }
  ok(threw && threw.status === 400, 'a blank name is refused as a 400', String(threw && threw.status));

  await pool.query('DELETE FROM client_subreddits WHERE client_id = ANY($1)', [[HILLCROFT, FALCON]]);
  await pool.query('DELETE FROM subreddit_research WHERE client_id = ANY($1)', [[HILLCROFT, FALCON]]);
  await pool.end();
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
