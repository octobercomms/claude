// Three layout notes off the review, driven. Each is a reading of a short
// note, so the screenshots matter as much as the assertions.
import pw from './pw.mjs';
const browser = await pw.chromium.launch({ args: ['--no-sandbox'] });
const B = 'http://127.0.0.1:4599';
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };
const errs = [];

// ── Shared → Create: the option rows fill the width, unpicked ones are grey ─
{
  const page = await browser.newPage({ viewport: { width: 1500, height: 1300 } });
  page.on('pageerror', e => errs.push('create: ' + e.message));
  await page.goto(`${B}/clients/c1/social/create`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const rows = await page.evaluate(() => [...document.querySelectorAll('.app-main .opt-row')].map((r) => {
    const card = r.closest('.card');
    const btns = [...r.querySelectorAll('button')];
    const cs = getComputedStyle(card);
    return {
      n: btns.length,
      rowW: Math.round(r.getBoundingClientRect().width),
      inner: Math.round(card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)),
      widths: btns.map(b => Math.round(b.getBoundingClientRect().width)),
      inactive: btns.filter(b => !b.classList.contains('active'))
        .map(b => ({ bg: getComputedStyle(b).backgroundColor, border: getComputedStyle(b).borderTopColor })),
      active: btns.filter(b => b.classList.contains('active')).length,
    };
  }));
  ok(rows.length === 3, 'all three option rows use it', `rows: ${rows.length}`);
  for (const [i, r] of rows.entries()) {
    ok(Math.abs(r.rowW - r.inner) <= 2, `row ${i + 1} fills the card`, `${r.rowW} of ${r.inner}`);
    const spread = Math.max(...r.widths) - Math.min(...r.widths);
    ok(spread <= 2, `row ${i + 1}: every option the same width`, `widths ${r.widths.join('/')}`);
    ok(r.inactive.every(b => b.bg !== 'rgba(0, 0, 0, 0)'),
       `row ${i + 1}: an unpicked option has a surface, not nothing`, r.inactive[0]?.bg);
    ok(r.inactive.every(b => b.border !== 'rgba(0, 0, 0, 0)'),
       `row ${i + 1}: and a border, so it reads as a button`, r.inactive[0]?.border);
  }
  await page.screenshot({ path: '/tmp/claude-0/-home-user-claude/678f754e-8874-5413-b278-fc834fcb4dab/scratchpad/create-opts.png' });
  await page.close();
}

// ── Earned → Releases: "All releases" is above the box ──────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
  page.on('pageerror', e => errs.push('releases: ' + e.message));
  await page.goto(`${B}/clients/c1/pr/releases`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  await page.evaluate(() => {
    [...document.querySelectorAll('.app-main button.row-trigger')][0]?.click();
  });
  await page.waitForTimeout(1800);

  const r = await page.evaluate(() => {
    const links = [...document.querySelectorAll('.app-main button')]
      .filter(b => /All releases/.test(b.innerText));
    if (!links.length) return { count: 0 };
    const b = links[0];
    const card = document.querySelector('.app-main .card');
    return {
      count: links.length,
      insideCard: !!b.closest('.card'),
      aboveCard: card ? b.getBoundingClientRect().bottom <= card.getBoundingClientRect().top + 1 : null,
    };
  });
  ok(r.count === 1, 'there is exactly one way out, not two', `found ${r.count}`);
  ok(r.insideCard === false, 'and it is not inside the card');
  ok(r.aboveCard === true, 'it sits above the box');

  // It still works.
  await page.evaluate(() => {
    [...document.querySelectorAll('.app-main button')].find(b => /All releases/.test(b.innerText)).click();
  });
  await page.waitForTimeout(1200);
  const back = await page.evaluate(() => document.querySelector('.app-main').innerText);
  ok(/New press release/.test(back), 'and clicking it goes back to the list');
  await page.screenshot({ path: '/tmp/claude-0/-home-user-claude/678f754e-8874-5413-b278-fc834fcb4dab/scratchpad/releases.png' });
  await page.close();
}

// ── Shared → Hook vault: 75/25 ──────────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
  page.on('pageerror', e => errs.push('vault: ' + e.message));
  await page.goto(`${B}/clients/c1/social/hook-vault`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const v = await page.evaluate(() => {
    const grid = document.querySelector('.app-main .hookvault');
    if (!grid) return null;
    const main = grid.querySelector('.hookvault__main');
    const rail = grid.querySelector('.hookvault__rail');
    return {
      main: Math.round(main.getBoundingClientRect().width),
      rail: Math.round(rail.getBoundingClientRect().width),
      railText: rail.innerText.slice(0, 60),
      mainTop: Math.round(main.getBoundingClientRect().top),
      railTop: Math.round(rail.getBoundingClientRect().top),
    };
  });
  ok(!!v, 'the vault is a two-column grid');
  if (v) {
    const share = v.main / (v.main + v.rail);
    ok(share > 0.70 && share < 0.80, 'split roughly 75/25', `${Math.round(share * 100)}/${100 - Math.round(share * 100)}`);
    ok(Math.abs(v.mainTop - v.railTop) < 40, 'and they start level, so the rail is beside it not under it',
       `${v.mainTop} vs ${v.railTop}`);
    ok(/hook is the first line/i.test(v.railText) || v.railText.length > 20,
       'the explanation is in the rail', v.railText.replace(/\n/g, ' '));
  }

  // The search row inside it: 75/25, with the typing taking the three
  // quarters. It was a flex row where .select's width:100% claimed
  // everything and the input collapsed to a 40px square beside a full-width
  // "All frameworks" — the control you came to use was the one that vanished.
  const row = await page.evaluate(() => {
    const r = document.querySelector('.app-main .filter-row');
    if (!r) return null;
    const input = r.querySelector('input');
    const sel = r.querySelector('select');
    return {
      row: Math.round(r.getBoundingClientRect().width),
      input: Math.round(input.getBoundingClientRect().width),
      select: Math.round(sel.getBoundingClientRect().width),
      level: Math.abs(input.getBoundingClientRect().top - sel.getBoundingClientRect().top) < 3,
    };
  });
  ok(!!row, 'the filter row is a grid');
  if (row) {
    const share = row.input / (row.input + row.select);
    ok(share > 0.70 && share < 0.80, 'the search box takes three quarters',
       `${Math.round(share * 100)}/${100 - Math.round(share * 100)}  input ${row.input}px`);
    ok(row.input > 300, 'which is a box you can actually read a query in', `${row.input}px`);
    ok(row.level, 'and the two sit on one line');
  }

  // At phone width it has to stack, or the rail is 90px of prose.
  await page.setViewportSize({ width: 420, height: 1000 });
  await page.waitForTimeout(500);
  const stacked = await page.evaluate(() => {
    const m = document.querySelector('.hookvault__main').getBoundingClientRect();
    const r = document.querySelector('.hookvault__rail').getBoundingClientRect();
    return { stacked: r.top >= m.bottom - 2, scroll: document.documentElement.scrollWidth <= window.innerWidth + 1 };
  });
  ok(stacked.stacked, 'it stacks on a phone');
  ok(stacked.scroll, 'with no sideways scroll');
  await page.setViewportSize({ width: 1500, height: 1200 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/claude-0/-home-user-claude/678f754e-8874-5413-b278-fc834fcb4dab/scratchpad/hookvault.png' });
  await page.close();
}

ok(errs.length === 0, 'no page errors', errs.join(' | '));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
