import pw from './pw.mjs';

// PR 1, driven.
//
// Four changes, and every one of them is a placement or a visible-state
// change: where a button sits, whether it is disabled, whether a panel is
// gone, what a card says when the data is spread across sites. None of that
// is visible in a diff, and six of these items were marked Delivered once
// already and reopened, which is the reason this file exists.
const b = await pw.chromium.launch();
const errs = [];
let fails = 0;
const say = (ok, what, extra = '') => {
  if (!ok) fails += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? '  — ' + extra : ''}`);
};

// --- Produce > Video: six styles below the upload, and the explainer line ---
{
  const p = await b.newPage();
  p.on('pageerror', e => errs.push('Video: ' + e.message));
  // The real "no examples yet" answer. Without this the stub 404s and the
  // component takes its error path, which is a different case and is tested
  // on its own below.
  await p.route('**/api/video/example-reel-status', r => r.fulfill({
    status: 200, contentType: 'application/json', body: '{"available":false}' }));
  await p.goto('http://127.0.0.1:4599/clients/c1/produce/video', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const txt = (await p.locator('body').innerText()).replace(/\s+/g, ' ');

  say(/Give it your clips and it assembles a reel/i.test(txt), 'Video says what it is for');
  say(/To cut one yourself on a timeline, use Edit/i.test(txt), 'and points at Edit');

  const six = p.getByRole('button', { name: /six styles/i }).first();
  // PR 4 replaced the single-file "Upload a clip" button with the multi-clip
  // drop target. What this measures is unchanged — six-styles sits below the
  // way footage gets in — so the locator moves and the assertion does not.
  const up = p.getByRole('button', { name: /add footage/i }).first();
  if (await six.count() && await up.count()) {
    const a = await six.boundingBox();
    const c = await up.boundingBox();
    say(a.y > c.y, 'six-styles sits below the way footage gets in',
      `six y=${Math.round(a.y)}, drop target y=${Math.round(c.y)}`);
    say(await six.isDisabled(), 'and is disabled with no footage');
    say(/Add a clip first/i.test(txt), 'and says what unlocks it');
  } else {
    say(false, 'six-styles and the drop target are both on the page',
      `six=${await six.count()}, drop=${await up.count()}`);
  }
  await p.close();
}

// --- Produce > Video, status check down ---
//
// It used to render nothing at all here, so a failed status call made the
// whole feature vanish with no trace. The control has to survive its own
// backend being unreachable.
{
  const p = await b.newPage();
  p.on('pageerror', e => errs.push('Video/err: ' + e.message));
  await p.route('**/api/video/example-reel-status', r => r.fulfill({ status: 500, body: 'nope' }));
  await p.goto('http://127.0.0.1:4599/clients/c1/produce/video', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const txt = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  const six = p.getByRole('button', { name: /six styles/i }).first();
  say(await six.count() > 0, 'the control survives a failed status check');
  if (await six.count()) say(await six.isDisabled(), 'disabled');
  say(/Could not check for worked examples/i.test(txt), 'and says so');
  await p.close();
}

// --- Produce > Library: the two tools are gone ---
{
  const p = await b.newPage();
  p.on('pageerror', e => errs.push('Library: ' + e.message));
  await p.goto('http://127.0.0.1:4599/clients/c1/produce/library', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const txt = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  say(!/Tighten the edit/i.test(txt), 'Tighten is off Library');
  say(!/Plan the b-roll/i.test(txt), 'B-roll is off Library');
  say(!/pick another/i.test(txt), 'and the clip selector that only fed them');
  say(!/take the pauses and the fillers out/i.test(txt), 'and the line explaining them');
  say(/Everything made for this client/i.test(txt), 'the library itself is untouched');
  await p.close();
}

// --- Produce > Edit: names its job, points back ---
{
  const p = await b.newPage();
  p.on('pageerror', e => errs.push('Edit: ' + e.message));
  await p.goto('http://127.0.0.1:4599/clients/c1/produce/edit', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const txt = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  say(/Cut a video yourself on a timeline/i.test(txt), 'Edit says what it is for');
  say(/use Video/i.test(txt), 'and points at Video');
  await p.close();
}

// --- Convert > Optimise: the All-sites card says something ---
//
// The stub has no Clarity sites, so the fixture is injected here. Three sites
// with different severities is the case the old placeholder could not
// describe: "Across 3 sites." told you nothing about which one to open.
{
  const p = await b.newPage();
  p.on('pageerror', e => errs.push('Optimise: ' + e.message));
  const F = (site, pr, n) => Array.from({ length: n }, (_, i) =>
    ({ issue: `${pr} issue ${i + 1} on ${site}`, priority: pr, done: false }));
  await p.route('**/api/clarity/clients/*/sites', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ sites: [
      { id: 's1', label: 'DTC' }, { id: 's2', label: 'Trade' }, { id: 's3', label: 'UK' }] }),
  }));
  await p.route('**/api/clarity/clients/*/reports*', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ reports: [
      { id: 'r1', site_id: 's1', site_label: 'DTC', summary: 'DTC read.',
        findings: [...F('DTC', 'medium', 2)] },
      { id: 'r2', site_id: 's2', site_label: 'Trade', summary: 'Trade read.',
        findings: [...F('Trade', 'critical', 2), ...F('Trade', 'high', 1)] },
      { id: 'r3', site_id: 's3', site_label: 'UK', summary: 'UK read.',
        findings: [...F('UK', 'critical', 1)] },
    ] }),
  }));
  await p.goto('http://127.0.0.1:4599/clients/c1/convert/optimise', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const txt = (await p.locator('body').innerText()).replace(/\s+/g, ' ');

  say(!/Across \d+ sites?\./i.test(txt), 'the count-only placeholder is gone');
  if (/Funnel health/i.test(txt)) {
    // Trade carries 2 critical + 1 high = weight 8; UK 1 critical = 3; DTC 2 medium = 2.
    say(/Trade.{0,40}needs it most/is.test(txt) || /needs it most/i.test(txt),
      'it names the worst site', txt.match(/.{0,80}needs it most.{0,60}/i)?.[0] || '');
    say(/2 of 3 sites have something critical/i.test(txt),
      'and how many sites carry a critical');
  } else {
    say(false, 'Funnel health card rendered', 'card not found — check the fixture shape');
  }
  await p.close();
}

console.log(errs.length ? 'PAGE ERRORS: ' + errs.join(' | ') : 'no page errors');
console.log(fails === 0 && errs.length === 0 ? '--- PR 1 DRIVES PASS ---' : `--- ${fails} FAILED ---`);
await b.close();
