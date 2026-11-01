import pw from './pw.mjs';

// Settings → Models and Settings → AI, after the split.
//
// "this page needs splitting in two. keep models page with the list from
// Reports & strategy down to Outreach & leads and the save routing button.
// and then split after that and move the AI content all below that to
// Connections as a page called AI."
//
// The move of Models from Connections to Costs shipped on 1 November and the
// split did not, so the screen carried the routing list AND the AI provider
// credentials underneath it — the two-jobs-one-page complaint the move was
// supposed to answer. What a source check cannot see is what is actually
// drawn on each screen, which is the whole of this item.
const b = await pw.chromium.launch();
let fails = 0;
const say = (ok, what, extra = '') => {
  if (!ok) fails += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? '  — ' + extra : ''}`);
};
const errs = [];
const open = async (path) => {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  p.on('pageerror', (e) => { if (!/stub: no route/.test(e.message)) errs.push(`${path}: ${e.message}`); });
  await p.goto('http://127.0.0.1:4599' + path, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  return p;
};
const text = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ');

// ── Models: the routing list, and nothing else ───────────────────────────
{
  const p = await open('/settings/models');
  const t = await text(p);

  // The two ends Daniel named, and the button under them.
  say(/Reports & strategy/i.test(t), 'Models opens with Reports & strategy');
  say(/Outreach & leads/i.test(t), 'and runs down to Outreach & leads');
  say(/Save routing/i.test(t), 'and keeps the Save routing button');

  // Every group the real service defines renders, so a group added to
  // aiModels.js and never shown would fail here rather than go unnoticed.
  const groups = ['Reports & strategy', 'Social', 'SEO & visibility', 'Sales pipeline',
    'Tender agent', 'Selective outreach', 'Press outreach', 'Outreach & leads'];
  const missing = groups.filter(g => !new RegExp(g.replace('&', '&'), 'i').test(t));
  say(missing.length === 0, 'every routing group the service defines is on the screen', missing.join(', '));

  // A model picker per feature, not one for the page.
  const selects = await p.locator('select').count();
  say(selects >= groups.length, `each feature has its own model picker`, `${selects} pickers`);

  // The split itself: no credential field on this screen.
  const pw1 = await p.locator('input[type=password]').count();
  say(pw1 === 0, 'and no credential field is left on it', `${pw1} password inputs`);
  say(!/API key|Secret|Token/i.test(t.slice(t.indexOf('Reports & strategy'))),
    'nor a key, secret or token below the list');
  await p.close();
}

// ── AI: the credentials, and nothing else ────────────────────────────────
{
  const p = await open('/settings/ai');
  const t = await text(p);
  const pw2 = await p.locator('input[type=password]').count();
  say(pw2 > 0, 'the AI screen carries the provider credentials', `${pw2} password inputs`);
  say(!/Save routing/i.test(t), 'and not the Save routing button');
  say(!/Reports & strategy/i.test(t), 'nor the routing list');
  await p.close();
}

// ── Both are rows you can click, under the right headings ────────────────
{
  const p = await open('/settings/costs');
  const t = await text(p);
  const head = t.slice(0, 400);
  say(/COSTS[\s\S]{0,40}Usage[\s\S]{0,20}Models/i.test(head), 'Models is a row under Costs', head.slice(0, 120));
  say(/CONNECTIONS[\s\S]{0,30}AI\b/i.test(head), 'and AI is the first row under Connections');

  for (const [label, slug] of [['Models', '/settings/models'], ['AI', '/settings/ai']]) {
    const row = p.getByRole('button', { name: label, exact: true }).first();
    const there = await row.count() > 0;
    say(there, `${label} is a row you can click`);
    if (!there) continue;
    await row.click();
    await p.waitForTimeout(900);
    say(p.url().endsWith(slug), `and ${label} lands on ${slug}`, p.url());
  }
  await p.close();
}

console.log(errs.length ? 'PAGE ERRORS:\n  ' + errs.join('\n  ') : 'no page errors');
console.log(fails ? `--- ${fails} FAILED ---` : '--- MODELS SPLIT DRIVES PASS ---');
await b.close();
process.exit(fails ? 1 : 0);
