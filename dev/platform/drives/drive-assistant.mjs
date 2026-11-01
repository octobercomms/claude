import pw from './pw.mjs';

// Database → the media-desk assistant, as a panel rather than a row.
//
// "maybe we could move the assistant into there also?" — into the drawer.
// It went into a panel instead, on the client analyst's precedent: it is a
// chat that proposes changes to the records, so a destination you navigate to
// means leaving the list you want it to act on.
//
// What no source check can see: that the list is still visible and still
// scrolls behind it, and that the click which dismisses it does not also
// press the thing under the cursor. That last one is the bug the analyst
// shipped and had to fix, and the reason this copies its listener exactly.
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
  await p.waitForTimeout(1100);
  return p;
};
const text = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ');
const bubble = (p) => p.locator('button[aria-label="Media-desk assistant"]');
const panel = (p) => p.locator('aside[aria-label="Media-desk assistant"]');
const isOpen = async (p) => (await panel(p).getAttribute('class') || '').includes('open');

// ── It is not a row any more ─────────────────────────────────────────────
{
  const p = await open('/database/journalists');
  const t = await text(p);
  const row = p.getByRole('button', { name: 'Assistant', exact: true });
  say(await row.count() === 0, 'Assistant is no longer a row in the Database panel');
  say(/Health[\s\S]{0,80}Tasks/i.test(t.slice(0, 500)), 'and the rows above it are untouched');
  say(await bubble(p).count() === 1, 'the bubble is in the top bar instead');
  await p.close();
}

// ── Database only ────────────────────────────────────────────────────────
for (const [path, want] of [['/database/journalists', 1], ['/settings/costs', 0], ['/clients', 0]]) {
  const p = await open(path);
  say(await bubble(p).count() === want, `${path}: ${want ? 'has' : 'has no'} assistant bubble`);
  await p.close();
}

// ── Opening, and what stays visible ──────────────────────────────────────
{
  const p = await open('/database/journalists');
  say(!(await isOpen(p)), 'it starts closed');
  await bubble(p).click();
  await p.waitForTimeout(600);
  say(await isOpen(p), 'the bubble opens it');

  // A panel, not a modal: the records are still on screen beside it. Asserted
  // by hit-testing a point to the left of the panel — the panel starts at
  // x=691 in a 1280 window — because "is it visible" on a text match answers
  // a different question and answered it wrongly here.
  const atPage = await p.evaluate(() => {
    const el = document.elementFromPoint(500, 300);
    return { cls: el?.className || '', inPanel: !!el?.closest('.analyst-panel') };
  });
  say(!atPage.inPanel, 'and the page beside it is not covered', atPage.cls.slice(0, 40));

  // And still scrolls, which a backdrop would prevent. The scroll container
  // is the document, not .app-main, whose scrollTop is always 0 — reading
  // that is what made the first version of this check read 0 -> 0 and look
  // like a scroll lock.
  const canScroll = await p.evaluate(() =>
    document.documentElement.scrollHeight > document.documentElement.clientHeight);
  say(canScroll, 'the page behind is long enough for the scroll check to mean anything');
  const before = await p.evaluate(() => window.scrollY);
  await p.mouse.move(400, 500);
  await p.mouse.wheel(0, 500);
  await p.waitForTimeout(500);
  const after = await p.evaluate(() => window.scrollY);
  say(after > before, 'and the page behind still scrolls', `${before} -> ${after}`);
  say(await isOpen(p), 'and scrolling it did not close the panel');
  // No scroll lock, which is the other half of "panel, not modal".
  const locked = await p.evaluate(() => getComputedStyle(document.body).overflow === 'hidden');
  say(!locked, 'and nothing locked the body scroll');
  await p.close();
}

// ── The dismiss, and the bug it must not have ────────────────────────────
{
  const p = await open('/database/journalists');
  await bubble(p).click();
  await p.waitForTimeout(500);

  // Aim at a real control well clear of the panel: a nav row in the Database
  // panel, whose side effect is a URL change you cannot miss. The panel spans
  // the right 589px of a 1280 window, so a row at x~250 is genuinely behind
  // nothing.
  const url = p.url();
  const row = p.getByRole('button', { name: 'Tags', exact: true }).first();
  const there = await row.count() > 0;
  say(there, 'there is a control on the page behind to aim at');
  if (there) {
    const box = await row.boundingBox();
    say(box.x + box.width < 691, 'and it is clear of the panel', `right edge ${Math.round(box.x + box.width)}`);
    await row.click();
    await p.waitForTimeout(700);
    say(!(await isOpen(p)), 'clicking the page dismisses the panel');
    // The bug the analyst shipped: cancelling mousedown does not stop the
    // click, so the dismissing click also pressed what was under it.
    say(p.url() === url, 'and the dismissing click did not also press the row under it', p.url());
  }
  await p.close();
}

// ── Escape, the close button, and the deep link ──────────────────────────
{
  const p = await open('/database/journalists');
  await bubble(p).click();
  await p.waitForTimeout(500);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);
  say(!(await isOpen(p)), 'Escape closes it');

  await bubble(p).click();
  await p.waitForTimeout(500);
  await p.locator('button[aria-label="Close assistant"]').click();
  await p.waitForTimeout(500);
  say(!(await isOpen(p)), 'and so does the × ');

  // Reopening works after each exit.
  await bubble(p).click();
  await p.waitForTimeout(500);
  say(await isOpen(p), 'the bubble reopens it');

  // And while it is open the bubble is underneath the panel, which is what
  // makes the exits above the only ones and why no exclusion is needed in the
  // dismiss handler. Asserted by hit-testing rather than by reading the CSS.
  const bb = await bubble(p).boundingBox();
  const atBubble = await p.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className || '',
    { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 });
  say(/analyst-panel/.test(atBubble), 'and the panel covers the bubble while open', atBubble);
  await p.close();
}
{
  const p = await open('/database/journalists?assistant=1');
  say(await isOpen(p), '?assistant=1 opens it on arrival');
  const t = await text(p);
  say(/proposes changes for you to approve/i.test(t), 'and the assistant itself renders inside');
  await p.close();
}

console.log(errs.length ? 'PAGE ERRORS:\n  ' + errs.join('\n  ') : 'no page errors');
console.log(fails ? `--- ${fails} FAILED ---` : '--- ASSISTANT PANEL DRIVE PASSES ---');
await b.close();
process.exit(fails ? 1 : 0);
