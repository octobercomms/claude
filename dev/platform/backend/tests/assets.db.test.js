/**
 * The client asset library, against a real Postgres.
 *
 * Every claim this service makes is a SQL claim: that the backfill joins reach
 * the right client, that re-running the migration adds nothing, that a second
 * render replaces what the library knows rather than doubling it. None of that
 * is checkable without a database, which is why this is a .db test and not in
 * the CI list.
 *
 *   DB_HOST=/tmp DB_PORT=55434 DB_NAME=omi DB_USER=postgres node tests/assets.db.test.js
 */
const fs = require('fs');
const path = require('path');
const pool = require('../src/db');
const assets = require('../src/services/assets');

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log('  ok  ', label);
  else { console.log('  FAIL', label); failures += 1; }
};

const FALCON = '11111111-1111-4111-8111-111111111111';
const INDIEWALLS = '22222222-2222-4222-8222-222222222222';

/**
 * The fixture lives here rather than in a shell someone has to remember.
 *
 * Two clients, each with their own social post, is the part that matters: with
 * a single post a broken join produces the right answer by luck, which is how a
 * cross join reaches production looking tested.
 */
async function fixture() {
  await pool.query(`
    INSERT INTO clients (id, name, slug) VALUES ($1,'Falcon','falcon-assets-test'), ($2,'Indiewalls','indiewalls-assets-test')
      ON CONFLICT (id) DO NOTHING`, [FALCON, INDIEWALLS]);
  await pool.query(`
    INSERT INTO users (id, username, password_hash)
      VALUES ('33333333-3333-4333-8333-333333333333','daniel','not-a-real-hash')
      ON CONFLICT (id) DO NOTHING`);
  await pool.query('TRUNCATE client_assets, social_post_media, social_posts, social_batches, '
    + 'ad_creative_images, ad_creatives, ad_creative_batches, recordings, video_projects '
    + 'RESTART IDENTITY CASCADE');

  await pool.query(`INSERT INTO video_projects (client_id, name, output_url, style_preset, score)
    VALUES ($1,'Autumn reel','/api/video/1/out.mp4','auto',88),
           ($2,'Gavi cut','/api/video/2/out.mp4','karaoke',91)`, [FALCON, INDIEWALLS]);
  await pool.query(`INSERT INTO video_projects (client_id, name, output_url)
    VALUES ($1,'Still rendering', NULL)`, [FALCON]);

  await pool.query(`INSERT INTO recordings
      (client_id, title, storage_key, duration_s, size_bytes, status, public_token, created_by) VALUES
      ($1,'Kickoff call','rec/abc.webm',620,91000000,'ready','tok1','33333333-3333-4333-8333-333333333333'),
      (NULL,'Internal note','rec/def.webm',120,2000000,'ready','tok2',NULL),
      ($1,'Half uploaded','rec/ghi.webm',NULL,NULL,'uploading','tok3',NULL)`, [FALCON]);

  // One post per client. Both carry media, so a join that ignores post_id
  // attaches one client's reel to the other and the check below sees it.
  const b = '44444444-4444-4444-8444-444444444444';
  const pIndie = '55555555-5555-4555-8555-555555555555';
  const pFalcon = '5a5a5a5a-5555-4555-8555-5a5a5a5a5a5a';
  // social_batches.client_id is NOT NULL. The batch's own client is beside
  // the point here: the posts carry their own, and what this checks is that a
  // join respects post_id rather than reaching across clients.
  await pool.query('INSERT INTO social_batches (id, client_id) VALUES ($1, $2)', [b, FALCON]);
  await pool.query(`INSERT INTO social_posts (id, batch_id, client_id)
    VALUES ($1,$3,$4), ($2,$3,$5)`, [pIndie, pFalcon, b, INDIEWALLS, FALCON]);
  await pool.query(`INSERT INTO social_post_media (post_id, kind, provider, url, duration_sec) VALUES
      ($1,'video','arcads','https://cdn/indie-reel.mp4',28),
      ($1,'audio','elevenlabs','https://cdn/indie-vo.mp3',31),
      ($1,'video','remotion','',12),
      ($2,'video','arcads','https://cdn/falcon-reel.mp4',19)`, [pIndie, pFalcon]);

  // Two creatives, one per client, for the same reason as the two posts above.
  const bFalcon = '66666666-6666-4666-8666-666666666666';
  const bIndie = '6a6a6a6a-6666-4666-8666-6a6a6a6a6a6a';
  const cFalcon = '77777777-7777-4777-8777-777777777777';
  const cIndie = '7a7a7a7a-7777-4777-8777-7a7a7a7a7a7a';
  await pool.query(`INSERT INTO ad_creative_batches (id, client_id)
    VALUES ($1,$3), ($2,$4)`, [bFalcon, bIndie, FALCON, INDIEWALLS]);
  await pool.query(`INSERT INTO ad_creatives (id, batch_id, client_id)
    VALUES ($1,$3,$5), ($2,$4,$6)`, [cFalcon, cIndie, bFalcon, bIndie, FALCON, INDIEWALLS]);
  await pool.query(`INSERT INTO ad_creative_images (creative_id, provider, aspect_ratio, url, prompt)
    VALUES ($1,'ideogram','9:16','https://cdn/falcon-ad.png','enamel mug on linen'),
           ($2,'replicate','1:1','https://cdn/indie-ad.png','gallery wall')`, [cFalcon, cIndie]);
}

async function main() {
  await fixture();

  console.log('The migration is idempotent, because run.js replays it');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '212_client_assets.sql'), 'utf8');
  await pool.query(sql);
  const first = (await pool.query('SELECT COUNT(*)::INT n FROM client_assets')).rows[0].n;
  await pool.query(sql);
  const second = (await pool.query('SELECT COUNT(*)::INT n FROM client_assets')).rows[0].n;
  ok(first === second && first > 0, `${first} rows, unchanged by a second run`);

  console.log('\nThe backfill reaches the right client through every join');
  const falcon = await assets.list(FALCON);
  const indie = await assets.list(INDIEWALLS);
  ok(falcon.every((a) => a.client_id === FALCON), 'no row lands on the wrong client');
  // social_post_media and ad_creative_images carry no client_id of their own.
  // These two are the joins that could silently attach an asset to whoever
  // happens to sort first, which is the kind of wrong nobody notices.
  ok(indie.some((a) => a.url === 'https://cdn/indie-reel.mp4')
    && falcon.some((a) => a.url === 'https://cdn/falcon-reel.mp4'),
    'each social asset reaches its OWN client through the post');
  ok(!indie.some((a) => a.url === 'https://cdn/falcon-reel.mp4'),
    'and not the other one, which is what a cross join would do');
  ok(falcon.some((a) => a.url === 'https://cdn/falcon-ad.png')
    && indie.some((a) => a.url === 'https://cdn/indie-ad.png'),
    'each ad image reaches its own client through the creative');
  ok(!falcon.some((a) => a.url === 'https://cdn/indie-ad.png'),
    'and not the other one');

  console.log('\nUnfinished work is not indexed as if it were an asset');
  const all = await assets.list(FALCON, { limit: 500 });
  ok(!all.some((a) => a.title === 'Still rendering'),
    'an edit with no output is not in the library');
  ok(!all.some((a) => a.title === 'Half uploaded'),
    'a recording still uploading is not either');
  const orphan = await pool.query(
    "SELECT COUNT(*)::INT n FROM client_assets WHERE title = 'Internal note'");
  ok(orphan.rows[0].n === 0, 'and a recording with no client is left out rather than guessed at');

  console.log('\nAudio is indexed as audio, not as video');
  ok(indie.some((a) => a.kind === 'audio' && a.source === 'social_media'),
    'a voiceover keeps its kind');

  console.log('\nRecording the same output twice updates rather than duplicates');
  const a1 = await assets.record({
    client_id: FALCON, source: 'caption_render', source_id: 'proj-9',
    title: 'First pass', url: '/out/v1.mp4', mime: 'video/mp4', duration_s: 28,
    metadata: { template: 'institution' },
  });
  const a2 = await assets.record({
    client_id: FALCON, source: 'caption_render', source_id: 'proj-9',
    title: 'Second pass', url: '/out/v2.mp4', mime: 'video/mp4', duration_s: 31,
    metadata: { words: 94 },
  });
  ok(a1 && a2 && a1.id === a2.id, 'the same production run keeps one row');
  ok(a2.title === 'Second pass' && a2.url === '/out/v2.mp4',
    'and the row describes the newer output, not the older one');
  ok(a2.metadata.template === 'institution' && a2.metadata.words === 94,
    'metadata merges, so a later render does not erase what the first knew');

  console.log('\nA kind is worked out when the caller does not pass one');
  ok(assets.kindOf({ mime: 'video/quicktime' }) === 'video', 'from the mime type');
  ok(assets.kindOf({ url: '/a/b/thing.PNG?v=2' }) === 'image', 'or the extension, case and query ignored');
  ok(assets.kindOf({ storage_key: 'rec/x.webm' }) === 'video', 'or the storage key');
  ok(assets.kindOf({ url: '/a/notes.xyz' }) === 'document', 'and anything else is a document');

  console.log('\nIndexing never takes a production run down with it');
  // The whole point: a render that threw away a finished video because the
  // library was briefly unreachable would be far worse than a missing row.
  ok(await assets.record({ source: 'upload', source_id: 'x', url: '/a' }) === null,
    'a missing client returns null rather than throwing');
  ok(await assets.record({ client_id: FALCON, source: 'nonsense', source_id: 'x', url: '/a' }) === null,
    'an unknown source does too');
  ok(await assets.record({ client_id: FALCON, source: 'upload', source_id: 'y' }) === null,
    'and so does an asset with nowhere to find it');
  ok(await assets.record(null) === null, 'null does not throw');

  console.log('\nArchiving hides an asset without destroying it');
  const made = await assets.record({
    client_id: INDIEWALLS, source: 'upload', source_id: 'up-1',
    title: 'A thing', url: '/u/1.png',
  });
  await assets.archive(made.id);
  ok(!(await assets.list(INDIEWALLS)).some((a) => a.id === made.id), 'it drops out of the list');
  ok((await assets.list(INDIEWALLS, { includeArchived: true })).some((a) => a.id === made.id),
    'but it is still there when asked for');
  ok((await assets.get(made.id)) !== null, 'and a scheduled post holding its id can still resolve it');
  await assets.archive(made.id, false);
  ok((await assets.list(INDIEWALLS)).some((a) => a.id === made.id), 'and it comes back');

  console.log('\nThe filters are the ones a picker needs');
  ok((await assets.list(FALCON, { kind: 'image' })).every((a) => a.kind === 'image'), 'by kind');
  ok((await assets.list(FALCON, { source: 'recording' })).every((a) => a.source === 'recording'), 'by source');
  ok((await assets.list(FALCON, { search: 'kickoff' })).length === 1, 'by title, case-insensitively');
  const c = await assets.counts(FALCON);
  ok(c.total === (await assets.list(FALCON, { limit: 500 })).length, 'and the counts agree with the list');

  console.log('\nA real production run indexes itself, without being asked to');
  // The assertion that matters most. Everything above tests the library; this
  // tests that the library hears about anything. It goes through
  // videoProjects.patchProject, the actual completion path, rather than a
  // hand-written insert that would pass whether or not the wiring exists.
  const videoProjects = require('../src/services/videoProjects');
  const run = await pool.query(
    "INSERT INTO video_projects (client_id, name) VALUES ($1,'Write-through') RETURNING id", [FALCON]);
  const pid = run.rows[0].id;
  await videoProjects.patchProject(pid, { output_url: `/api/video/projects/${pid}/output`, score: 93 });
  const indexed = (await assets.list(FALCON, { limit: 500 }))
    .find((a) => a.source === 'video_project' && a.source_id === String(pid));
  ok(!!indexed, 'finishing an edit puts it in the library');
  ok(indexed?.kind === 'video' && indexed?.metadata?.score === 93,
    'with its kind and what the pipeline knew about it');

  // And a project with no output must not appear, or the library fills with
  // rows pointing at nothing.
  const empty = await pool.query(
    "INSERT INTO video_projects (client_id, name) VALUES ($1,'No output yet') RETURNING id", [FALCON]);
  await videoProjects.patchProject(empty.rows[0].id, { score: 10 });
  ok(!(await assets.list(FALCON, { limit: 500 }))
    .some((a) => a.source === 'video_project' && a.source_id === String(empty.rows[0].id)),
  'but a run with no output does not, at either of the two places that stop it');

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  await pool.end();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.log('  FAIL ', e.stack || e.message);
  try { await pool.end(); } catch { /* already closed */ }
  process.exit(1);
});
