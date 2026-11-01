import pw from './pw.mjs';

// PR 3, driven.
//
// Everything here is a move: a job that was on one screen is now on another.
// A diff shows the code arriving and leaving; it cannot show whether the new
// page renders it, whether the pointer left behind actually lands, or whether
// the screen it left is now missing a primary action. Four of my Delivered
// marks were wrong because I checked a commit instead of a screen.
const b = await pw.chromium.launch();
const errs = [];
let fails = 0;
const say = (ok, what, extra = '') => {
  if (!ok) fails += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? '  — ' + extra : ''}`);
};

const open = async (path, routes = []) => {
  const p = await b.newPage();
  p.on('pageerror', (e) => {
    if (/stub: no route/.test(e.message)) return;
    errs.push(`${path}: ${e.message}`);
  });
  for (const [glob, body, status = 200] of routes) {
    await p.route(glob, (r) => r.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body),
    }));
  }
  await p.goto('http://127.0.0.1:4599' + path, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1100);
  return p;
};
const text = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ');

// ── 1. The maintenance tab exists and carries all five jobs ──────────────
{
  const p = await open('/database-tools?tab=maintenance', [
    ['**/api/outreach/tags', ['architecture', 'design', 'Architecture', 'furniture']],
  ]);
  const t = await text(p);
  say(/Maintenance/i.test(t), 'Database tools has a Maintenance tab');
  // Opening on ?tab=maintenance is what every pointer left behind relies on,
  // so this is the pointer's landing as much as the tab's existence.
  for (const job of [
    'Find websites \\+ feeds',
    'Mine feeds for new bylines',
    'Enable semantic matching',
    'Email me this week',
    'Tidy tags with Claude',
  ]) {
    say(new RegExp(job, 'i').test(t), `${job.replace('\\', '')} is on it`);
  }
  say(/Runs nightly/i.test(t), 'and the jobs say when they run on their own');
  say(/Sent every Monday/i.test(t), 'including the one that is a schedule, not a sweep');
  // The tag count is read live, so this also proves the tool fetches rather
  // than borrowing a list it no longer has.
  say(/4 tags in the workspace/i.test(t), 'tag cleanup counts the catalogue itself',
    t.match(/.{0,30}tags in the workspace.{0,20}/i)?.[0] || 'no count rendered');
  await p.close();
}

// ── 2. A job reports what it did, where it now lives ─────────────────────
//
// This is the cost of the move: mining used to sit above the review queue it
// filled. It now has to say what it queued and where that queue is.
{
  const p = await open('/database-tools?tab=maintenance', [
    ['**/api/outreach/tags', []],
    ['**/api/pr/feeds/mine', { queued: 7, outlets: 3, flagged: 2 }],
  ]);
  const btn = p.getByRole('button', { name: /mine feeds now/i }).first();
  if (await btn.count()) {
    await btn.click();
    await p.waitForTimeout(900);
    const t = await text(p);
    say(/7 new journalists from 3 feeds/i.test(t), 'mining reports what it queued',
      t.match(/.{0,20}new journalists from.{0,40}/i)?.[0] || '');
    say(/2 flagged gone-quiet/i.test(t), 'and what it flagged');
    say(/under Find new journalists/i.test(t), 'and names where the queue is');
    const link = p.getByRole('link', { name: /review queue/i }).first();
    say(await link.count() > 0, 'with a link straight to it');
  } else {
    say(false, 'the mine button is on the page');
  }
  await p.close();
}

// ── 3. The screens the jobs left ─────────────────────────────────────────
{
  const p = await open('/database/publications');
  const t = await text(p);
  say(!/Find websites \+ feeds<\/strong> runs over every publication/i.test(t),
    'the paragraph about the moved button went with it');
  say(/Run a batch now/i.test(t), 'and a pointer replaced it');
  const add = p.getByRole('button', { name: /\+ Add publication/i }).first();
  say(await add.count() > 0, 'Publications leads with Add publication');
  // It is the primary, so it has to read as one rather than hide in the
  // kebab beside the exports.
  if (await add.count()) {
    const cls = await add.getAttribute('class');
    say(/btn-primary/.test(cls || ''), 'as the primary action', cls || '');
  }
  await p.close();
}

{
  const p = await open('/database/tags');
  const t = await text(p);
  say(/Tidy with Claude/i.test(t), 'Tags still names tag cleanup');
  // As a link now, not a button, because pressing it here would start a
  // Claude call whose result renders on another page.
  const asLink = p.getByRole('link', { name: /Tidy with Claude/i }).first();
  const asBtn = p.getByRole('button', { name: /Tidy with Claude/i }).first();
  say(await asLink.count() > 0 && await asBtn.count() === 0,
    'and points at it rather than running it from here',
    `link=${await asLink.count()}, button=${await asBtn.count()}`);
  await p.close();
}

// ── 4. The add form, and the duplicate it is there to stop ───────────────
{
  const p = await open('/database/publications');
  await p.getByRole('button', { name: /\+ Add publication/i }).first().click();
  await p.waitForTimeout(500);
  let t = await text(p);
  say(/Add a publication/i.test(t), 'the form opens');
  say(/Only the name is needed now/i.test(t), 'and says only the name is needed');

  const submit = p.getByRole('button', { name: /^Add publication$/i }).last();
  say(await submit.isDisabled(), 'the submit is disabled with no name');
  await p.getByRole('textbox', { name: 'Name' }).fill('Dezeen');
  await p.waitForTimeout(250);
  say(!(await submit.isDisabled()), 'and enabled once there is one');

  // The 409 path: the row comes back with the error, and the form offers it.
  await p.route('**/api/pr/outlets', (r) => (r.request().method() === 'POST'
    ? r.fulfill({ status: 409, contentType: 'application/json',
      body: JSON.stringify({ error: 'That publication is already in the database.',
        existing: { id: 'already-here', name: 'Dezeen', domain: 'dezeen.com' } }) })
    : r.continue()));
  await submit.click();
  await p.waitForTimeout(800);
  t = await text(p);
  say(/Dezeen is already in the database \(dezeen.com\)/i.test(t),
    'a clash names the publication it clashed with',
    t.match(/.{0,20}already in the database.{0,30}/i)?.[0] || '');
  const openIt = p.getByRole('button', { name: /^Open it$/i }).first();
  say(await openIt.count() > 0, 'and offers to open it rather than only refusing');
  await p.close();
}

console.log(errs.length ? 'PAGE ERRORS: ' + errs.join(' | ') : 'no page errors');
console.log(fails === 0 && errs.length === 0 ? '--- PR 3 DRIVES PASS ---' : `--- ${fails} FAILED ---`);
await b.close();
