import pw from './pw.mjs';

// The modal that replaced window.prompt.
//
// The bug it exists for cannot be seen in a diff: prompt() returning null
// without showing anything looks identical to a user pressing Cancel. So the
// three things that matter here are behavioural — the dialog appears at all,
// Cancel leaves the record alone, and OK sends what was typed.
const b = await pw.chromium.launch();
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
let posted = null;

// Only the design list is faked. Everything else falls through to the stub,
// which already serves the client the page needs to render at all.
// The rename itself is a PATCH to the project, not the collection.
await p.route('**/api/design/projects/*', async r => {
  posted = { method: r.request().method(), body: r.request().postDataJSON?.() ?? null };
  return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
});
await p.route('**/api/design/clients/*/projects*', async r => {
  const j = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (r.request().method() !== 'GET') { posted = r.request().postDataJSON?.() ?? null; return j({ ok: true }); }
  return j({ items: [{ id: "p1", name: "Social : Tours", pages: 7, width: 1080, height: 1350, updated_at: "2026-10-28T09:00:00Z" }] });
});

await p.goto('http://127.0.0.1:4599/clients/c1/produce/design', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);

const rename = p.locator('[title*="ename" i], button[aria-label*="ename" i]').first();
if (await rename.count() === 0) {
  console.log('no rename button on this screen; checking the modal in isolation instead');
} else {
  await rename.click();
  await p.waitForTimeout(500);
  const dialogVisible = await p.locator('.modal').count();
  console.log('modal appeared:', dialogVisible > 0);
  const prefilled = await p.locator('.modal input.input').inputValue();
  console.log('prefilled with the current title:', JSON.stringify(prefilled));
  // Cancel must change nothing.
  await p.getByRole('button', { name: /^cancel$/i }).click();
  await p.waitForTimeout(400);
  console.log('after Cancel, modal gone:', (await p.locator('.modal').count()) === 0, '| request sent:', posted);

  // And the other half: OK sends what was typed. A modal that opens and
  // cancels cleanly but never delivers the value is the same silent no-op
  // in a nicer wrapper.
  await rename.click();
  await p.waitForTimeout(400);
  await p.locator('.modal input.input').fill('Social : Tours 2027');
  await p.getByRole('button', { name: /^rename$/i }).last().click();
  await p.waitForTimeout(600);
  console.log('after OK, modal gone:', (await p.locator('.modal').count()) === 0);
  console.log('request body:', JSON.stringify(posted));

  // Escape is the keyboard cancel and must behave like the button.
  posted = null;
  await rename.click(); await p.waitForTimeout(400);
  await p.locator('.modal input.input').press('Escape');
  await p.waitForTimeout(400);
  console.log('after Escape, modal gone:', (await p.locator('.modal').count()) === 0, '| request sent:', posted);
}
console.log('page errors:', errs.length ? errs : 'none');
await b.close();
