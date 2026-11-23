// The report review screen, used in a real browser.
//
// Why a browser rather than a source-level guard: this screen is the one place
// an account manager changes what a client is about to read, and most of what
// can go wrong with it is position and state, not shape. Three defects here
// passed `vite build` and the lint and were invisible until something
// rendered the page — a revert control sitting on top of the neighbouring
// metric cell, an explanatory sentence inside a metric cell that doubled the
// cell's height and shoved the grid around, and an edited-state marker drawn
// as the same yellow rule a comment carries, so one mark meant two things
// side by side.
//
// What it pins, in order of how badly it would go unnoticed:
//
//   - a figure edited by hand loses the comparison printed beside it. Keeping
//     it produced "9,000 / up 8.2% / vs 11,534", arithmetic a client can do
//     and nobody internally would
//   - the send confirmation names the recipients. Reports have silently gone
//     nowhere before; that is what skipped_no_recipients exists to record
//   - a comment can be added by clicking a line and typing, which is the
//     whole feature
//   - hiding a section says so, rather than the section just vanishing
//   - nothing throws on the way to first paint
//
//   npm run test:browser
//
// PW_CHROMIUM may point at an existing Chromium; otherwise Playwright uses
// the one it downloaded.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');

if (!fs.existsSync(path.join(dist, 'report.html'))) {
  console.error('No build to test. Run: npx vite build --config tests/browser/vite.config.js');
  process.exit(1);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'report.html';
  const file = path.join(dist, rel);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  if (ok) { pass += 1; console.log('PASS ', n); }
  else { fail += 1; console.log('FAIL ', n, d ? `\n  ${d}` : ''); }
};

// A report shaped like one templateRenderer produces. Five metric cells on
// purpose: both renderers chunk at four, so the fifth wraps, and the editor
// has to wrap it the same way or an AM edits a layout they will not recognise.
const generated = [
  { id: 'intro', type: 'narrative', title: 'Overview', text: 'October held steady against a quiet September.\nPaid traffic fell 14% while organic enquiries rose.' },
  {
    id: 'kpis', type: 'metrics_grid', title: 'Headline performance', insight: 'Cost per enquiry improved 18% on September.',
    cells: [
      { label: 'Sessions', value: '12,481', delta: '8.2%', deltaDirection: 'up', previous: '11,534' },
      { label: 'Enquiries', value: '38', delta: '4.1%', deltaDirection: 'down', previous: '40' },
      { label: 'Cost per enquiry', value: '£61', delta: '18%', deltaDirection: 'up', previous: '£74' },
      { label: 'Spend', value: '£2,318', delta: '2%', deltaDirection: 'down', previous: '£2,365' },
      { label: 'Impressions', value: '184k', delta: '11%', deltaDirection: 'up', previous: '166k' },
    ],
  },
  {
    id: 'keywords', type: 'tables', title: 'Keyword movement',
    tables: [{ headers: ['Term', 'Position', 'Change'], rows: [['oak dining table', '4', '+2'], ['handmade kitchen', '11', '−1']] }],
  },
  { id: 'spend', type: 'bar_chart', title: 'Spend by channel', chart: { bars: [{ label: 'Meta', value: 1240 }, { label: 'Google Ads', value: 860 }] } },
];

const doc = {
  report_id: 'rrrrrrrr-1111-4111-8111-111111111111',
  client_name: 'Northgate Studio', report_type: 'monthly', status: 'generated',
  period: { start: '2026-10-01', end: '2026-10-31' },
  sections: generated, generated, edited: false, edited_at: null, edited_by: null, changes: [],
  recipients: ['anna@northgate.studio', 'tom@northgate.studio'],
};

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const problems = [];
page.on('pageerror', e => problems.push(String(e)));
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });

let saved = null;   // the body the editor would PUT

try {
  // Playwright matches the LAST registered route first, so the catch-all goes
  // in before the specific ones or it swallows them.
  await page.route('**/api/**', r => r.fulfill({ json: [] }));
  await page.route('**/api/auth/me', r => r.fulfill({ json: { id: 1, username: 'dan@octobercomms.com', role: 'admin' } }));
  await page.route('**/api/reports/*/sections', r => {
    if (r.request().method() === 'PUT') {
      saved = JSON.parse(r.request().postData() || '{}');
      return r.fulfill({ json: { message: 'Edits saved', sections: saved.sections, changes: [] } });
    }
    return r.fulfill({ json: doc });
  });

  await page.goto(`${origin}/report.html`);
  await page.waitForSelector('[aria-label="Section heading"]', { timeout: 15000 });

  const headings = await page.locator('[aria-label="Section heading"]').evaluateAll(els => els.map(e => e.value));
  check('every generated section is on the page', headings.length === 4,
    `rendered ${headings.length}: ${JSON.stringify(headings)}`);
  check('headings carry the generated wording', headings[1] === 'Headline performance', headings[1]);

  // ── a comment, by clicking a line and typing ──────────────────────────────

  const addComment = page.locator('text=Add a comment for the client').first();
  check('a comment can be started by clicking a line', await addComment.count() > 0);
  await addComment.click();
  const comment = 'We paused Meta for the first week of October, which is the dip in paid traffic.';
  await page.locator('[aria-label="Comment for the client"]').first().fill(comment);

  // ── editing a figure drops the comparison beside it ───────────────────────

  await page.locator('[aria-label="Sessions value"]').fill('9,000');
  await page.waitForTimeout(100);
  // A metric's label and value are input values rather than text nodes, so
  // the cell carries data-cell for exactly this.
  const cellText = await page.locator('[data-cell="0"]').innerText();
  check('an edited figure loses the comparison printed beside it',
    !cellText.includes('8.2%') && !cellText.includes('11,534'),
    `the cell still reads: ${cellText.replace(/\n/g, ' | ')}`);
  check('and says what the generated figure was',
    cellText.includes('12,481'), cellText.replace(/\n/g, ' | '));

  // An untouched cell keeps its comparison: dropping it on any edit would
  // throw away a true comparison every time somebody reworded a label.
  const other = await page.locator('[data-cell="1"]').innerText();
  check('an untouched cell keeps its comparison', other.includes('4.1%') && other.includes('vs 40'),
    other.replace(/\n/g, ' | '));

  // ── the five-cell wrap matches the renderers ──────────────────────────────

  const rowTops = await page.locator('[aria-label$="value"]').evaluateAll(
    els => els.map(e => Math.round(e.getBoundingClientRect().top)));
  const distinctRows = new Set(rowTops).size;
  check('five metric cells wrap onto two rows, as both renderers chunk them',
    distinctRows === 2, `cells sit on ${distinctRows} row(s): ${JSON.stringify(rowTops)}`);

  // ── the edited count ──────────────────────────────────────────────────────

  const bar = await page.locator('text=/change(s)? *, *unsaved/').first().textContent();
  check('the bar counts what has changed', /2 changes, unsaved/.test(bar || ''), bar);

  // ── hiding says so ────────────────────────────────────────────────────────

  await page.locator('[title="Leave this section out of the report"]').last().click();
  check('a hidden section says it is out of the report',
    await page.locator('text=Left out of the report').count() > 0);

  // ── saving sends every section back ───────────────────────────────────────

  await page.locator('button:has-text("Save")').first().click();
  await page.waitForTimeout(400);
  check('the save sends every generated section back',
    !!saved && saved.sections.length === generated.length,
    `sent ${saved ? saved.sections.length : 'nothing'} of ${generated.length}`);
  // The server refuses a payload that omits one, because silently dropping a
  // section from a client report is the quiet failure.
  const ids = (saved?.sections || []).map(s => s.id);
  check('including the one that was hidden', ids.includes('spend'), JSON.stringify(ids));
  check('the typed comment is in the payload',
    (saved?.sections || []).some(s => s.note === comment));
  check('the hidden section is flagged, not removed',
    (saved?.sections || []).find(s => s.id === 'spend')?.hidden === true);

  // ── the send confirmation names the recipients ────────────────────────────

  await page.locator('button:has-text("Send to client")').click();
  await page.waitForTimeout(200);
  const confirm = await page.locator('text=anna@northgate.studio').count();
  check('the send confirmation names the recipients', confirm > 0);

  check('nothing threw on the way', problems.length === 0, problems.slice(0, 3).join('\n  '));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
