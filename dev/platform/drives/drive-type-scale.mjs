// Settings → Appearance → Text size.
//
// Everything this screen has to get right is a measurement, and none of it is
// visible to lint, to a build, or to a unit test:
//
//   · typing in a field has to move the page behind the card
//   · and must NOT move the card, because the card is how a broken scale gets
//     undone — a 10px caption set from here would otherwise make the fields
//     that set it unreadable
//   · a preset has to be one click, with no save
//   · and the clamp has to hold against a number typed straight into the field
//
// The pinned card is the one worth the browser on its own. `.type-editor`
// re-declares the five size tokens, and nothing in CSS or JS says that rule is
// load-bearing. Delete it and every test still passes; the only thing that
// shows it is gone is measuring the card while the scale around it is wrecked.
//
//   node drive-type-scale.mjs      (with stub-server.js running on 4599)

import { load } from './pw.mjs';

const { chromium } = await load();
const B = 'http://127.0.0.1:4599';

let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));

// Resolved font-size of a real element, in px, as the browser renders it.
const fontSizeOf = sel => page.locator(sel).first().evaluate(
  el => parseFloat(getComputedStyle(el).fontSize));
const rootToken = t => page.evaluate(
  tok => getComputedStyle(document.documentElement).getPropertyValue(tok).trim(), t);

const fieldFor = async (label) => {
  const row = page.locator('div').filter({ hasText: new RegExp(`^${label}`) });
  return row.locator('input[type="number"]').first();
};

await page.goto(`${B}/settings/text-size`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

// ── it is reachable, and it is where it says it is ───────────────────────────

ok(await page.locator('h3', { hasText: 'Your text size' }).count() === 1,
   'the screen exists at /settings/text-size',
   'a panel with no row in the nav is a page with no door');
ok(await page.locator('h3', { hasText: 'House default' }).count() === 1,
   'and an admin sees the house default too');

// ── every token has a field ──────────────────────────────────────────────────

const numbers = await page.locator('.type-editor input[type="number"]').count();
const selects = await page.locator('.type-editor select').count();
ok(numbers === 5, 'five size fields', `${numbers}`);
ok(selects === 10, 'ten weight fields', `${selects}`);

// Daniel asked for every size and weight listed with a field. A field that is
// missing is the whole feature quietly not applying to that part of the app.
const weightOptions = await page.locator('.type-editor select').first().locator('option').allInnerTexts();
ok(weightOptions.join(',') === '400,500,600,700',
   'weights offer only the four the font ships',
   `offers ${weightOptions.join(', ')} — 800 renders as 700, so the field would visibly do nothing`);

// ── the roles are named, because they are not one-to-one with the sizes ─────

const bodyRow = await page.locator('.type-editor').innerText();
ok(/card headings \(h3\)/i.test(bodyRow),
   'the Body row says it also moves card headings',
   'h3 shares --fs-body, so raising Body moves headings and the editor looks broken');
ok(/h1, h2/i.test(bodyRow), 'and the Section row names the two headings that share it');

// ── typing moves the page and not the card ──────────────────────────────────

// `.sp-row` and not `.section-panel`: the panel is a container with no
// font-size of its own, so it inherits 16px and never moves however the scale
// is set. Measuring it passed the "card does not move" check for the wrong
// reason and failed this one — assert against an element that provably carries
// the token.
// `.sp-row` and not `.section-panel`: the panel is a container with no
// font-size of its own, so it inherits 16px and never moves however the scale
// is set. Assert against an element that provably carries the token — and
// against the SAME token the field changes. A first version typed Caption and
// measured a --fs-body element, which can only ever fail.
const beforeNav = await fontSizeOf('.sp-row');
const beforeCard = await fontSizeOf('.type-editor .h3');

const body = await fieldFor('Body');
await body.fill('19');
await page.waitForTimeout(300);

ok(await rootToken('--fs-body') === '19px',
   'typing applies straight to the page',
   'the page behind the card is the only preview that cannot lie');
ok(await fontSizeOf('.sp-row') === 19,
   'and the interface behind it really reflows',
   `nav row was ${beforeNav}px and is now ${await fontSizeOf('.sp-row')}px`);

ok(await fontSizeOf('.type-editor .h3') === beforeCard,
   'the editor card does not move',
   'it is the control that undoes a broken scale, so it has to stay readable');

// The case the pin exists for: a scale small enough that nothing can be read.
const caption = await fieldFor('Caption');
await caption.fill('10');
await body.fill('11');
await page.waitForTimeout(300);

const wreckedNav = await fontSizeOf('.sp-row');
const wreckedCardLabel = await fontSizeOf('.type-editor .caption');
ok(wreckedNav <= 11, 'a minimum scale really does shrink the page', `${wreckedNav}px`);
ok(wreckedCardLabel >= 12,
   'while the card that has to undo it stays legible',
   `card label at ${wreckedCardLabel}px with the nav at ${wreckedNav}px — if this tracks the page, the `
   + 'only way back from a bad scale is a database edit');

// ── nothing is stored until Save ─────────────────────────────────────────────

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
ok(await rootToken('--fs-caption') === '' || await rootToken('--fs-caption') === '12px',
   'a reload discards the preview',
   'F5 is the undo, so typing must not persist');

// ── the clamp holds against a typed number ───────────────────────────────────

const bodyAgain = await fieldFor('Body');
await bodyAgain.fill('400');
await page.waitForTimeout(200);
await page.locator('button:has-text("Save house default")').click();
await page.waitForTimeout(700);

const savedBody = await rootToken('--fs-body');
ok(savedBody === '20px',
   'a number past the ceiling is held at the ceiling',
   `stored ${savedBody} — the server clamps, so the screen must show what was actually saved`);

// ── a preset is one click ────────────────────────────────────────────────────

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.locator('button:has-text("Comfortable")').click();
await page.waitForTimeout(700);

ok(await rootToken('--fs-body') === '15px',
   'a preset applies on one click, with no save',
   'four named options and a save button is a second click for nothing');
ok(/Your own setting/.test(await page.locator('.type-editor').innerText()),
   'and the screen says this is yours rather than the house default');

await page.locator('button:has-text("Use the house default")').click();
await page.waitForTimeout(700);
ok(/Following the house default/.test(await page.locator('.type-editor').innerText()),
   'and it can be handed back',
   'writing the house values into the override instead of clearing it stops the user tracking later changes');

ok(errors.length === 0, 'no page errors', errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
