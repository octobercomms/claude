import pw from './pw.mjs';

// Produce becomes Make / Batch / Media, and the video editor is called Studio.
//
// Unit guards already pin the slug resolution and the search keyword. What
// they cannot see is whether the panel actually renders the three groups,
// whether the renamed row lights up, and whether the address anyone had open
// before the rename still lands on the editor rather than on the section
// default. The last one is the dangerous case: a retired slug that falls
// through to the default opens a working page showing the wrong screen, and
// nothing fails.
const b = await pw.chromium.launch();
const errs = [];
let fails = 0;
const say = (ok, what, extra = '') => {
  if (!ok) fails += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? '  — ' + extra : ''}`);
};

const open = async (path) => {
  const p = await b.newPage();
  p.on('pageerror', (e) => {
    if (/stub: no route/.test(e.message)) return;
    errs.push(`${path}: ${e.message}`);
  });
  await p.goto('http://127.0.0.1:4599' + path, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1100);
  return p;
};
const text = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ');

// ── 1. The three groups, and the row names ───────────────────────────────
{
  const p = await open('/clients/c1/produce/studio');
  const t = await text(p);
  // Headings render uppercase; compare case-insensitively. Three drives in
  // this project have been lost to that.
  for (const h of ['MAKE', 'BATCH', 'MEDIA']) {
    say(new RegExp(`\\b${h}\\b`, 'i').test(t), `the panel has a ${h} group`);
  }
  say(/\bStudio\b/.test(t), 'the editor row is called Studio');
  say(!/\bVideo\b/.test(t.slice(0, 1200)),
    'and no row still reads Video', t.slice(0, 1200).match(/Video/) ? 'found Video' : '');
  await p.close();
}

// ── 1b. Visualise is in the nav at all ──────────────────────────────────
//
// It was not. The panel, the phone picker and the search box each read
// canVisualise as the per-user `can_use_visualise` grant, while the page reads
// it as `!readOnly || grant`, because the grant is there to let a CLIENT in
// and an agency login was always allowed. The grant is only ever set on client
// accounts, so the row appeared for nobody while the page worked if you typed
// the URL. The stub user is role 'admin' with no grant, which is exactly the
// case that was broken: before the fix this assertion fails.
{
  const p = await open('/clients/c1/produce/studio');
  const t = await text(p);
  say(/\bVisualise\b/.test(t), 'an agency login sees the Visualise row',
    /\bVisualise\b/.test(t) ? '' : 'the row is hidden from a user with no can_use_visualise grant');
  await p.close();
}

// ── 2. The renamed row lights up on its own URL ──────────────────────────
{
  const p = await open('/clients/c1/produce/studio');
  const active = await p.locator('.section-panel a[aria-current="page"], .section-panel .is-active')
    .first().innerText().catch(() => '');
  say(/Studio/i.test(active), 'Studio is the active row on /produce/studio',
    `active row read "${active}"`);
  await p.close();
}

// ── 3. The retired URL still opens the editor ────────────────────────────
//
// Not "the page loads" — a page loads either way. What is checked is that it
// is the SAME screen, by comparing what the two addresses render.
{
  const a = await open('/clients/c1/produce/studio');
  const c = await open('/clients/c1/produce/compose');
  const ta = (await text(a)).slice(0, 600);
  const tc = (await text(c)).slice(0, 600);
  say(ta === tc, '/produce/compose renders the same screen as /produce/studio',
    ta === tc ? '' : `studio: "${ta.slice(0, 120)}" vs compose: "${tc.slice(0, 120)}"`);
  // And neither is the section default by accident: Library is what you get
  // if the slug falls through, since defaultTab is compose — so check the
  // editor's own furniture is present rather than trusting the slug.
  say(/Editor|Composition|composition/i.test(tc) || /Frame size/i.test(await text(c)),
    'and it is the editor, not a fallback screen');
  await a.close();
  await c.close();
}

// ── 4. Transcribe and Audio moved group without losing their URLs ────────
for (const [slug, label] of [['transcribe', 'Transcribe'], ['audio', 'Audio'], ['library', 'Library']]) {
  const p = await open(`/clients/c1/produce/${slug}`);
  const active = await p.locator('.section-panel a[aria-current="page"], .section-panel .is-active')
    .first().innerText().catch(() => '');
  say(new RegExp(label, 'i').test(active), `/produce/${slug} lights up ${label}`,
    `active row read "${active}"`);
  await p.close();
}

// ── 5. An unknown slug corrects the URL rather than lying ────────────────
//
// This file's own header warned about the class and then tested only the
// slugs that work, which is how it shipped. Measured on 9 November, before
// the fix: /produce/nonsense, /produce/review and /produce/video each drew
// the composition editor with "Studio" lit in the panel, as though that was
// what you asked for. `review` is the dangerous one, being nearly the slug
// of a real screen (`batch-review`).
//
// The fallback to the default tab is deliberate and stays; what changed is
// that the address bar is corrected to match, so the URL and the nav agree.
for (const [asked, want, row] of [
  ['nonsense',     'studio',       'Studio'],
  ['review',       'studio',       'Studio'],
  ['video',        'studio',       'Studio'],
  // The retired slug redirects to the canonical one rather than resolving
  // quietly under the old address.
  ['compose',      'studio',       'Studio'],
  // A real slug is left exactly alone — this is the half that would catch a
  // redirect rule too eager to fire.
  ['batch-review', 'batch-review', 'Review'],
]) {
  const p = await open(`/clients/c1/produce/${asked}`);
  const landed = new URL(p.url()).pathname.split('/').pop();
  const active = await p.locator('.section-panel a[aria-current="page"], .section-panel .is-active')
    .first().innerText().catch(() => '(none)');
  say(landed === want && new RegExp(row, 'i').test(active),
    `/produce/${asked} lands on /${want} with ${row} lit`,
    `url read /${landed}, active row "${active}"`);
  await p.close();
}

say(errs.length === 0, 'no page errors', errs.join(' | '));

await b.close();
console.log(`\n${fails === 0 ? 'ALL' : 'SOME'} — ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
