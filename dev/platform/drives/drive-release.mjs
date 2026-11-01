import pw from './pw.mjs';
const b = await pw.chromium.launch();
const p = await b.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://127.0.0.1:4599/clients/c1/pr/releases', { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
const edit = p.getByRole('button', { name: /^edit$/i }).first();
if (await edit.count() === 0) { console.log('stub has no releases to open'); }
else {
  await edit.click();
  await p.waitForTimeout(1200);
  const btns = await p.locator('button').allInnerTexts();
  console.log('editor open. page errors:', errs.length ? errs : 'none');
  console.log('writing-standard buttons with a release open:', btns.filter(t => /writing standard/i.test(t)).length);
  const sBtn = p.getByRole('button', { name: /writing standard/i }).first();
  const bx = await sBtn.boundingBox();
  const h1 = await p.locator('h2.h1').first().boundingBox();
  console.log('standard y', bx && bx.y, '| release title y', h1 && h1.y, '| above the title:', bx && h1 && bx.y < h1.y);
  console.log('All releases link present:', btns.concat(await p.locator('.btn-link').allInnerTexts()).some(t => /all releases/i.test(t)));
}
await b.close();
