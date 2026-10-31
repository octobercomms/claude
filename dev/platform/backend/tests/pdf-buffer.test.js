// A PDF has to leave generatePDFBuffer as a Node Buffer.
//
// puppeteer 24 changed `page.pdf()` to resolve a Uint8Array rather than a
// Buffer. Every caller of generatePDFBuffer hands the result straight to
// `res.send()`, and Express treats only a real Buffer as binary: a bare
// Uint8Array falls through to its object branch and is JSON-stringified. The
// download then arrives as {"0":37,"1":80,...} under an application/pdf
// content-type — a corrupt report, with nothing thrown and nothing logged.
//
// The first check below is the hazard itself, measured rather than asserted
// from memory, so the reason this conversion exists cannot rot into folklore.
//
//   node tests/pdf-buffer.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

let failed = 0;
const pending = [];
function check(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      pending.push(r.then(
        () => console.log(`  ok   ${name}`),
        e => { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }));
    } else console.log(`  ok   ${name}`);
  } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

check('Express really does corrupt a Uint8Array body', async () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
  const app = express();
  app.get('/u8', (req, res) => { res.type('application/pdf'); res.send(bytes); });
  app.get('/buf', (req, res) => { res.type('application/pdf'); res.send(Buffer.from(bytes)); });
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const get = async p => Buffer.from(await (await fetch(`http://127.0.0.1:${port}/${p}`)).arrayBuffer());

    const u8 = await get('u8');
    assert.ok(!u8.subarray(0, 5).toString().startsWith('%PDF'),
      'Express no longer corrupts a Uint8Array — if this is genuinely fixed upstream, '
      + 'this test and the conversion it guards can both go');
    assert.ok(u8.toString().startsWith('{"0":'), `expected JSON, got ${u8.subarray(0, 20).toString()}`);

    const buf = await get('buf');
    assert.strictEqual(buf.subarray(0, 5).toString(), '%PDF-', 'a real Buffer must survive intact');
    assert.strictEqual(buf.length, bytes.length);
  } finally { server.close(); }
});

check('generatePDFBuffer converts before returning', () => {
  // Source check rather than a render: CI has no browser, and the defect is
  // in the handoff, not in puppeteer. Comments are stripped so the paragraph
  // above the conversion cannot stand in for the conversion.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/services/pdfService.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

  const fn = src.slice(src.lastIndexOf('async function generatePDFBuffer'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.ok(/await page\.pdf\(/.test(body), 'generatePDFBuffer no longer calls page.pdf — re-read this test');
  assert.ok(/return Buffer\.from\(/.test(body),
    'generatePDFBuffer returns page.pdf() unconverted; every res.send() caller would serve JSON');
  assert.ok(!/^\s*return buffer;\s*$/m.test(body),
    'the raw buffer is returned somewhere in generatePDFBuffer');
});

check('the real service returns a Buffer when a browser is available', async () => {
  // Runs where puppeteer has a browser (a dev box, the platform box); skips in
  // CI rather than failing, because a skipped render is not a reason to go red.
  let pdfService;
  try { pdfService = require('../src/services/pdfService'); }
  catch { console.log('       (pdfService did not load; skipped)'); return; }
  let out;
  try {
    out = await pdfService.generatePDFBuffer('<h1>October</h1><p>body</p>');
  } catch (e) {
    console.log(`       (no browser: ${e.message.split('\n')[0].slice(0, 60)}; skipped)`);
    return;
  }
  assert.ok(Buffer.isBuffer(out), `generatePDFBuffer returned ${out && out.constructor && out.constructor.name}`);
  assert.strictEqual(out.subarray(0, 5).toString(), '%PDF-', 'not a PDF');
  assert.ok(out.length > 1000, `suspiciously small: ${out.length} bytes`);
});

Promise.all(pending).then(() => {
  if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
  console.log('\nall passed');
});
