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

// ── 2 + 3. Outreach is a group inside Convert, with a line per screen ────
//
// Corrected after the first version of this drive. It opened each screen by
// typing its URL and then matched the row labels in the page, under the name
// "is reachable from the nav" — which proves the panel renders once you are
// already standing on it, and says nothing about anything taking you there.
// Email shipped with no entry in the nav rail and this drive stayed green.
// So the reachability check now starts from a page you can reach and clicks.
for (const [slug, want] of [
  ['campaigns', /A sequence that goes out on its own/i],
  ['prospects', /The people this client is pitching/i],
  ['tasks', /What needs a person rather than a sequence/i],
  ['sending', /Whether the mail can actually leave/i],
  ['find-leads', /companies worth approaching/i],
]) {
  const p = await open(`/clients/c1/convert/${slug}`);
  const t = await text(p);
  say(want.test(t), `Convert › ${slug} says what it produces`);
  if (slug === 'prospects') {
    say(/Prospects/.test(t), 'and the row is called Prospects, not Leads');
  }
  await p.close();
}
{
  // The rail is the only door to a section, so the walk starts there: open
  // Convert from the client page by clicking, then click each Outreach row
  // and check a screen actually arrives.
  const p = await open('/clients/c1/dashboard/measure');
  await p.locator('a[href$="/clients/c1/convert"]').first().click();
  await p.waitForTimeout(900);
  const panel = await text(p);
  say(/OUTREACH/i.test(panel), 'the Convert panel carries an Outreach group');

  for (const [label, slug, want] of [
    ['Campaigns', 'campaigns', /A sequence that goes out on its own/i],
    ['Prospects', 'prospects', /The people this client is pitching/i],
    ['Tasks', 'tasks', /What needs a person rather than a sequence/i],
    ['Sending', 'sending', /Whether the mail can actually leave/i],
    ['Find leads', 'find-leads', /companies worth approaching/i],
  ]) {
    // Panel rows are buttons, not links — they call the section's setter
    // rather than carrying an href, which is why the rail is the only thing
    // routeDoors can see and why the rail guard had to be written separately.
    const row = p.getByRole('button', { name: label, exact: true }).first();
    const there = await row.count() > 0;
    say(there, `${label} is a row you can click in the Convert panel`);
    if (!there) continue;
    await row.click();
    await p.waitForTimeout(900);
    const t = await text(p);
    say(want.test(t), `and clicking ${label} opens its screen`);
    say(p.url().endsWith(`/clients/c1/convert/${slug}`), `and ${label} lands on its own URL`, p.url());
  }
  await p.close();
}
{
  // One door per screen. The page used to draw a step rail over the same five
  // screens under a second set of names — Find, Write, Send, Chase, Selective
  // against the rows' Prospects, Campaigns, Sending, Tasks, Find leads — with
  // both visible at once. Daniel's call on 1 November was to delete it.
  for (const slug of ['campaigns', 'prospects', 'tasks', 'sending', 'find-leads']) {
    const p = await open(`/clients/c1/convert/${slug}`);
    const t = await text(p);
    const rail = /\bFind · next\b|\bWrite\b[\s\S]{0,40}The email sequence|AI-SOURCED|AI finds them, you approve each/i.test(t);
    say(!rail, `${slug}: no second rail over the same five screens`);
    // And the screen itself still arrives, which is what a careless deletion
    // of the surrounding ternary would break.
    const main = await p.locator('.suite-convert').first().innerText().catch(() => '');
    say(main.replace(/\s+/g, '').length > 60, `${slug}: and the screen still renders`,
      `${main.replace(/\s+/g, '').length} chars`);
    await p.close();
  }
}
{
  // No seventh item in the rail. The whole correction.
  const p = await open('/clients/c1/convert/optimise');
  const railHrefs = await p.locator('a[href^="/clients/c1/"]').evaluateAll(
    (as) => as.map(a => a.getAttribute('href')));
  say(!railHrefs.some(h => /\/clients\/c1\/email(\/|$)/.test(h)),
    'nothing in the app links to a top-level Email section',
    railHrefs.filter(h => /email/.test(h)).join(', '));
  await p.close();
}

{
  // Convert keeps its own two rows above the Outreach group.
  const p = await open('/clients/c1/convert/optimise');
  const t = await text(p);
  say(/Optimise/i.test(t) && /Forms/i.test(t), 'Convert still has Optimise and Forms');
  say(!/\bEMAIL\b/.test(t.slice(0, 600)),
    'and the group above them is headed Outreach, not Email');
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

// ── 6. Database's tools are rows, and the kebab is gone ──────────────────
//
// This section asserted the opposite until 1 November: that /database-tools
// existed, that each list carried a kebab, and that the kebab sat inside the
// page header. All three were true when written and all three were made false
// a few hours later by the Cleanup work, which moved those seven screens into
// the Database panel and removed the kebab outright. Nothing caught the drift,
// because a drive is not in CI and I did not re-run this one after that
// change. Re-running every drive a change could touch is the only thing that
// would have.
{
  const p = await open('/database/journalists');
  const t = await text(p);
  say(/CLEANUP/i.test(t), 'Database carries a Cleanup group in its panel');
  say(!/Cleanup Centre/i.test(t), 'and nothing is called Cleanup Centre');
  // The old page is not a route any more. Its screens are rows, so a link to
  // it would be the dead-link class this file exists to catch.
  const links = await p.locator('a[href*="database-tools"]').count();
  say(links === 0, 'and nothing links to the old Database tools page', `${links} links`);
  await p.close();
}
for (const [slug, label, primary] of [
  ['journalists', 'journalist', '+ Add journalist'],
  ['publications', 'publication', '+ Add publication'],
]) {
  const p = await open(`/database/${slug}`);
  const kebab = p.getByRole('button', { name: new RegExp(`More ${label} tools`, 'i') });
  say(await kebab.count() === 0, `${slug}: no kebab on the list`);
  const t = await text(p);
  say(t.includes(primary), `${slug}: its primary action is still there`);
  say(/Export CSV/i.test(t), `${slug}: and Export CSV is a button beside it`);
  await p.close();
}

console.log(errs.length ? 'PAGE ERRORS: ' + errs.join(' | ') : 'no page errors');
console.log(fails === 0 && errs.length === 0 ? '--- PR 2 DRIVES PASS ---' : `--- ${fails} FAILED ---`);
await b.close();
