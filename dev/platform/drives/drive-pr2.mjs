import pw from './pw.mjs';

// PR 2, the nav session. Six changes, all of them routes or nav rows.
//
// This is the run that matters most. A rename that leaves a path behind is
// the dead-link class this repo shipped six of in one commit, and the unit
// guards already caught two of mine before this file ran. What they cannot
// see is whether the page actually loads at the new address, whether the row
// lights up, and whether the old address lands somewhere sane rather than on
// a blank screen.
const b = await pw.chromium.launch();
const errs = [];
let fails = 0;
const say = (ok, what, extra = '') => {
  if (!ok) fails += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? '  — ' + extra : ''}`);
};

const open = async (path) => {
  const p = await b.newPage();
  // The stub answers 404 with {"error":"stub: no route"} for anything it has
  // no fixture for, and the api layer throws that. It means the stub is thin,
  // not that the app is broken, so it is not counted.
  p.on('pageerror', (e) => {
    if (/stub: no route/.test(e.message)) return;
    errs.push(`${path}: ${e.message}`);
  });
  await p.goto('http://127.0.0.1:4599' + path, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1100);
  return p;
};
const text = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ');

// ── 1. Shared: the group heading ─────────────────────────────────────────
{
  const p = await open('/clients/c1/social/create');
  const t = await text(p);
  // Headings render uppercase, so compare case-insensitively. This has caught
  // three drives in this project.
  say(/\bMAKE\b/i.test(t), 'the Shared group reads Make');
  say(!/\bCREATE\b[\s\S]{0,40}\bCREATE\b/i.test(t.slice(0, 2000)),
    'and no longer sits a Create group above a Create row');
  await p.close();
}

// ── 2 + 3. Email is its own section, with a line per screen ──────────────
for (const [slug, want] of [
  ['campaigns', /A sequence that goes out on its own/i],
  ['prospects', /The people this client is pitching/i],
  ['tasks', /What needs a person rather than a sequence/i],
  ['sending', /Whether the mail can actually leave/i],
  ['selective-outreach', /companies worth approaching/i],
]) {
  const p = await open(`/clients/c1/email/${slug}`);
  const t = await text(p);
  say(want.test(t), `Email › ${slug} says what it produces`);
  if (slug === 'prospects') {
    say(/Prospects/.test(t), 'and the row is called Prospects, not Leads');
  }
  await p.close();
}
{
  // Five rows in the nav, not a tab strip behind one row.
  const p = await open('/clients/c1/email/campaigns');
  const t = await text(p);
  for (const row of ['Campaigns', 'Prospects', 'Tasks', 'Sending', 'Selective outreach']) {
    say(new RegExp(row, 'i').test(t), `${row} is reachable from the nav`);
  }
  await p.close();
}
{
  // Convert keeps two rows and no longer carries Email.
  const p = await open('/clients/c1/convert/optimise');
  const t = await text(p);
  say(/Optimise/i.test(t) && /Forms/i.test(t), 'Convert still has Optimise and Forms');
  say(!/\bEmail\b/.test(t.slice(0, 1200)), 'and Email has left its panel');
  await p.close();
}

// ── 4. Improve folds into Learn ──────────────────────────────────────────
{
  const p = await open('/clients/c1/social/learn');
  const t = await text(p);
  say(/What worked/i.test(t), 'Learn still shows what worked');
  say(/What to change next/i.test(t), 'and now carries Improve underneath it');
  await p.close();
}
{
  // The old address must land somewhere, not on a blank page.
  const p = await open('/clients/c1/social/improve');
  const t = await text(p);
  say(t.length > 400, 'an old /improve link still renders a page', `${t.length} chars`);
  say(!/Improve/.test(t.slice(0, 900)) || /What to change next/i.test(t),
    'and it is not an orphaned Improve screen');
  await p.close();
}

// ── 5. Settings: Models under Costs ──────────────────────────────────────
{
  const p = await open('/settings/models');
  const t = await text(p);
  say(t.length > 400, 'the Models screen still loads at its slug');
  const costsAt = t.search(/\bCOSTS\b/i);
  const modelsAt = t.search(/\bModels\b/);
  const connAt = t.search(/\bCONNECTIONS\b/i);
  say(costsAt > -1 && modelsAt > costsAt && (connAt === -1 || modelsAt < connAt),
    'and Models is listed under Costs, above Connections',
    `costs@${costsAt} models@${modelsAt} connections@${connAt}`);
  await p.close();
}

// ── 6. Database tools, and the kebab in the page header ──────────────────
{
  const p = await open('/database-tools');
  const t = await text(p);
  say(/Database tools/i.test(t), 'the page is called Database tools');
  say(!/Cleanup Centre/i.test(t), 'and no longer Cleanup Centre');
  await p.close();
}
for (const [slug, label] of [['journalists', 'journalist'], ['publications', 'publication']]) {
  const p = await open(`/database/${slug}`);
  const kebab = p.getByRole('button', { name: new RegExp(`More ${label} tools`, 'i') }).first();
  const head = p.locator('header.hero').first();
  if (await kebab.count() && await head.count()) {
    const k = await kebab.boundingBox();
    const h = await head.boundingBox();
    say(k.y >= h.y && k.y <= h.y + h.height,
      `${slug}: the tools kebab is inside the page header`,
      `kebab y=${Math.round(k.y)}, header ${Math.round(h.y)}..${Math.round(h.y + h.height)}`);
    await kebab.click();
    await p.waitForTimeout(500);
    const t = await text(p);
    say(/Database tools/i.test(t), `${slug}: the drawer still links to Database tools`);
  } else {
    say(false, `${slug}: kebab and header both present`,
      `kebab=${await kebab.count()}, header=${await head.count()}`);
  }
  await p.close();
}

console.log(errs.length ? 'PAGE ERRORS: ' + errs.join(' | ') : 'no page errors');
console.log(fails === 0 && errs.length === 0 ? '--- PR 2 DRIVES PASS ---' : `--- ${fails} FAILED ---`);
await b.close();
