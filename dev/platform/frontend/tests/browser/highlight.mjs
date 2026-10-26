// The release highlighter, run in a real browser.
//
// Why a browser: the highlighter walks a parsed DOM and splits text nodes as it
// goes, and the order those passes run in decides whether a layer paints at all.
// That is behaviour, not shape, so no source-level assertion reaches it.
//
// It exists because of one bug, caught here before it shipped. The detector's
// segment layer was written painting nothing whenever the other three layers
// were on: its pass ran last, and by then the shorter needles had split every
// text node its paragraph-length needle had to match against. `vite build`
// compiled it, the lint passed it, and on screen it looked like a detector that
// had simply found nothing to flag.
//
//   npm run test:browser

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');

if (!fs.existsSync(path.join(dist, 'highlight.html'))) {
  console.error('No build to test. Run: npx vite build --config tests/browser/vite.config.js');
  process.exit(1);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'highlight.html';
  const file = path.join(dist, rel);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  if (ok) { pass += 1; console.log('PASS ', n); }
  else { fail += 1; console.log('FAIL ', n, d ? `\n  ${d}` : ''); }
};

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(String(e)));

try {
  await page.goto(`${origin}/highlight.html`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });

  const r = await page.evaluate(() => {
    const { highlightLayers, unmark, stripHtml, flatten, locateSegment } = window.releaseHighlight;

    // A paragraph the detector would return whole, carrying a tell and a
    // factless sentence inside it — which is the ordinary case, not a corner.
    const BODY = '<p>The company has paid more than $10 million directly to independent '
      + 'artists. It is a bespoke approach that really matters.</p>'
      + '<p>Getting there took three business models that failed first.</p>';
    const plain = stripHtml(BODY);
    const segment = plain.slice(0, plain.indexOf('really matters.') + 15);

    const lines = locateSegment(flatten(plain), plain, segment);
    const layer = (cls, needles) => ({ cls, needles });
    // In the order the editor paints them.
    const all = [
      layer('oc-machine', lines || []),
      layer('oc-bare', ['It is a bespoke approach that really matters.']),
      layer('oc-tell', ['bespoke']),
    ];
    const count = (html, sel) => new DOMParser()
      .parseFromString(`<div>${html}</div>`, 'text/html').querySelectorAll(sel).length;

    const painted = highlightLayers(BODY, all);
    const reversed = highlightLayers(BODY, [all[1], all[2], all[0]]);

    return {
      located: !!lines && lines.length,
      machine: count(painted, 'mark.oc-machine'),
      bare: count(painted, 'mark.oc-bare'),
      tell: count(painted, 'mark.oc-tell'),
      nested: count(painted, 'mark.oc-machine mark.oc-tell'),
      machineLast: count(reversed, 'mark.oc-machine'),
      restored: unmark(painted) === BODY,
      text: new DOMParser().parseFromString(`<div>${painted}</div>`, 'text/html')
        .querySelector('div').textContent === new DOMParser()
        .parseFromString(`<div>${BODY}</div>`, 'text/html').querySelector('div').textContent,
    };
  });

  check('a detector segment is located in the release it came from', r.located === 1, String(r.located));
  check('and it paints, with the other layers on', r.machine === 1, `${r.machine} marks`);
  check('the shorter layers still paint inside it',
    r.bare === 1 && r.tell === 1 && r.nested === 1, JSON.stringify(r));
  // The regression itself. Painted last, the paragraph-length needle finds no
  // text node left whole enough to match, and the layer silently does nothing.
  check('painting it last would paint nothing, which is the bug this guards',
    r.machineLast === 0, `${r.machineLast} marks when painted last`);
  check('the operator’s own HTML comes back out of unmark', r.restored === true);
  check('and not one character of the release was changed by painting it', r.text === true);
  check('nothing threw', problems.length === 0, problems.join('\n  '));
} catch (e) {
  fail += 1;
  console.log('FAIL  the run itself', `\n  ${e.message}`);
  if (problems.length) console.log(`  page problems:\n  ${problems.join('\n  ')}`);
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
