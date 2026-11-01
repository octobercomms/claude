// A deploy landing under an open tab must not leave a blank error screen.
//
// Reproduced the way it actually happens: let the app load, then make the
// chunk for a page the person has not visited 404, and click through to it.
// That is a deploy — old index.html in the tab, new filenames on the server.
import pw from './pw.mjs';
const browser = await pw.chromium.launch({ args: ['--no-sandbox'] });
const B = 'http://127.0.0.1:4599';
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };

// ── 1 · The stale chunk: one reload, then the page works ────────────────────
//
// Navigated by clicking the nav link, not by page.goto. A full navigation
// fetches a fresh index.html and so can never hit this bug; the deploy case
// is an in-app route change from a tab that is already open, which is why the
// first version of this drive passed while refusing nothing.
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let loads = 0;
  page.on('load', () => { loads += 1; });

  // The chunk is 404 for the open tab and fine after the reload, which is
  // exactly what a deploy looks like from the browser's side: serve the SPA's
  // index.html for the missing file, the nastier variant, because the browser
  // then reports a MIME type error rather than a network one.
  let blocked = 0;
  let blocking = true;
  await page.route('**/assets/ClientSEOPage-*.js', (route) => {
    if (!blocking) return route.continue();
    blocked += 1;
    blocking = false;   // the reload gets the real file, as it would
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' });
  });

  await page.goto(`${B}/clients/c1/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  ok(await page.evaluate(() => !!document.querySelector('.app-main')), 'the app loads');
  const loadsBefore = loads;

  // In-app, through the router.
  await page.evaluate(() => {
    document.querySelector('a[href="/clients/c1/seo"]').click();
  });
  await page.waitForTimeout(4000);

  ok(blocked >= 1, 'the stale chunk was asked for and refused', `refusals: ${blocked}`);
  ok(loads > loadsBefore, 'and the tab reloaded itself rather than giving up', `loads: ${loadsBefore} -> ${loads}`);
  ok(page.url().endsWith('/clients/c1/seo'), 'landing where the person was going, not back at the start', page.url());

  const text = await page.evaluate(() => (document.querySelector('.app-main') || document.body).innerText);
  ok(!/Something went wrong/i.test(text), 'no error screen', text.slice(0, 70).replace(/\n/g, ' '));
  ok(await page.evaluate(() => !!document.querySelector('.app-main')), 'and the page the person asked for is on screen');

  await page.close();
}

// ── 2 · A chunk that is genuinely gone reloads once, not for ever ───────────
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  let loads = 0;
  page.on('load', () => { loads += 1; });
  // Never let it through. A bad build, not a deploy.
  await page.route('**/assets/ClientSEOPage-*.js', (route) =>
    route.fulfill({ status: 404, contentType: 'text/plain', body: 'gone' }));

  await page.goto(`${B}/clients/c1/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const before = loads;

  await page.evaluate(() => { document.querySelector('a[href="/clients/c1/seo"]').click(); });
  await page.waitForTimeout(7000);

  ok(loads - before === 1, 'it reloads exactly once and then stops', `loads: ${before} -> ${loads}`);
  const text = await page.evaluate(() => document.body.innerText);
  ok(/Something went wrong/i.test(text),
     'and surfaces the real failure instead of refreshing for ever',
     text.slice(0, 60).replace(/\n/g, ' '));
  await page.close();
}

// ── 3 · The marker does not leak between chunks ─────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(`${B}/clients/c1/dashboard`, { waitUntil: 'networkidle' });
  const keys = await page.evaluate(() => {
    try {
      sessionStorage.setItem('omi:chunk-reload:ClientSEOPage', '1');
      return Object.keys(sessionStorage).filter(k => k.startsWith('omi:chunk-reload:'));
    } catch { return ['no-storage']; }
  });
  ok(keys.length === 1 && /ClientSEOPage$/.test(keys[0]),
     'the reload marker is keyed per chunk, so one bad page cannot gate the others', keys.join(','));
  await page.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
