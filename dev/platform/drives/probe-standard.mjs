import pw from './pw.mjs';
const b = await pw.chromium.launch();
const p = await b.newPage();
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto('http://127.0.0.1:4599/clients/c1/pr/releases', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);

// CSS uppercases plenty of chrome here, so every comparison is case-folded.
const txt = async (sel) => (await p.locator(sel).allInnerTexts()).map(t => t.trim());
const header = await txt('.page-shell-actions, [class*="tabActions"], header');
console.log('--- buttons on screen ---');
const btns = await p.locator('button').allInnerTexts();
const std = btns.filter(t => /writing standard/i.test(t));
console.log('writing-standard buttons:', std.length, JSON.stringify(std));

// Where is it? Compare its box against the Share button's.
const sBtn = p.getByRole('button', { name: /writing standard/i }).first();
const shBtn = p.getByRole('button', { name: /^share$/i }).first();
if (await sBtn.count() === 0) { console.log('NOT FOUND'); }
else {
  const a = await sBtn.boundingBox();
  const c = await shBtn.boundingBox();
  console.log('standard box', a);
  console.log('share    box', c);
  console.log('same row:', Math.abs(a.y - c.y) < 8, '| standard left of Share:', a.x < c.x);
  // Open it and confirm the drawer still carries its content.
  await sBtn.click();
  await p.waitForTimeout(600);
  const body = (await p.locator('body').innerText());
  for (const s of ['The rule', 'Who does what', 'The six moves', 'Writing it', 'does not write']) {
    console.log(s.padEnd(22), body.toLowerCase().includes(s.toLowerCase()));
  }
}
// And on another Earned screen it should not be there.
await p.goto('http://127.0.0.1:4599/clients/c1/pr/coverage', { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
const b2 = await p.locator('button').allInnerTexts();
console.log('on Coverage, writing-standard buttons:', b2.filter(t => /writing standard/i.test(t)).length);
console.log('on Coverage, Share present:', b2.some(t => /^share$/i.test(t.trim())));
await b.close();
