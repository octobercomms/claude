// The audit page's comments become a thread.
//
// Until now a doc held one `note` and one `reply`, so Daniel's second comment
// overwrote his first and the exchange could never get past two turns. This
// drives the real page against a stubbed store, with one doc in the OLD shape,
// because the migration matters as much as the feature: his existing comments
// must survive as the first two messages rather than vanish.
import pw from './pw.mjs';
import fs from 'fs';
import http from 'http';

const FILE = '/tmp/claude-0/-home-user-claude/678f754e-8874-5413-b278-fc834fcb4dab/scratchpad/audit/review-audit.html';
const html = fs.readFileSync(FILE, 'utf8');
const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(4610);

let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };

const browser = await pw.chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));

// A store that behaves like the real one: a QuerySnapshot with .docs, each
// doc with .id / .exists / .data(), frozen.
await page.addInitScript(() => {
  const DOCS = {
    // The old shape, exactly as it sits in the store today.
    'earned-build-contacts-0': {
      state: null,
      note: 'can we at least add sort and search?',
      reply: 'Fair, and sort plus search is the cheap half of it. Queued in the small-fixes batch.',
      at: '2026-11-01T11:00:00Z',
    },
    // An item marked done with no conversation.
    'earned-build-find-0': { state: 'done', note: '', reply: '' },
  };
  window.__writes = [];
  let cb = null;
  const emit = () => {
    if (!cb) return;
    const docs = Object.entries(DOCS).map(([id, v]) => Object.freeze({
      id, exists: true, data: () => Object.freeze(JSON.parse(JSON.stringify(v))),
    }));
    cb(Object.freeze({ docs, metadata: { fromCache: false, hasPendingWrites: false } }));
  };
  window.claude = {
    use: async () => ({
      collection: () => ({ onSnapshot: (f) => { cb = f; setTimeout(emit, 10); return () => {}; } }),
      doc: (path) => ({
        set: async (obj) => {
          const id = path.split('/').pop();
          DOCS[id] = JSON.parse(JSON.stringify(obj));
          window.__writes.push({ id, obj: JSON.parse(JSON.stringify(obj)) });
          emit();
        },
      }),
    }),
  };
});

await page.goto('http://127.0.0.1:4610/', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

const rowSel = '.item[data-key="earned-build-contacts-0"]';
const msgs = () => page.evaluate((s) => [...document.querySelectorAll(`${s} .msg`)].map(m => ({
  who: m.classList.contains('claude') ? 'claude' : 'you',
  text: m.innerText.replace(/^(you|claude)\n?/i, '').trim(),
})), rowSel);

// ── 1 · the old shape reads as a thread, nothing lost ──────────────────────
let m = await msgs();
ok(m.length === 2, 'an old note-and-reply doc reads as two messages', `got ${m.length}`);
ok(m[0]?.who === 'you' && /sort and search/.test(m[0].text), 'yours first', m[0]?.text?.slice(0, 40));
ok(m[1]?.who === 'claude' && /cheap half/.test(m[1].text), 'then mine', m[1]?.text?.slice(0, 40));

// ── 2 · who the ball is with ───────────────────────────────────────────────
// Lower-cased: the chip is uppercased by CSS, which is the third time today
// a drive has read a text-transform as the text.
const chipText = async () => page.evaluate((s) => {
  const w = document.querySelector(`${s} .waiting`);
  return w && !w.hidden ? w.innerText.trim().toLowerCase() : null;
}, rowSel);
let chip = await chipText();
ok(chip === 'waiting on you', 'my answer leaves it with you', String(chip));

const btnLabel = () => page.evaluate((s) => document.querySelector(`${s} .notebtn`).innerText.trim(), rowSel);
ok(await btnLabel() === 'Reply', 'and the button says Reply once there is a thread', await btnLabel());

// ── 3 · a second comment APPENDS. This is the whole point. ────────────────
await page.evaluate((s) => document.querySelector(`${s} .notebtn`).click(), rowSel);
await page.waitForTimeout(200);
await page.evaluate((s) => {
  const ta = document.querySelector(`${s} .noteWrap textarea`);
  ta.focus();
}, rowSel);
ok(await page.evaluate((s) => document.querySelector(`${s} .noteWrap textarea`).value === '', rowSel),
   'the box opens empty, as a new message rather than an edit');
await page.keyboard.type('yes please, and the same on Earned too');
await page.evaluate((s) => document.querySelector(`${s} [data-act="save"]`).click(), rowSel);
await page.waitForTimeout(500);

m = await msgs();
ok(m.length === 3, 'a second comment adds a third message', `got ${m.length}`);
ok(/sort and search/.test(m[0]?.text || ''), 'and the first one is still there');
ok(/cheap half/.test(m[1]?.text || ''), 'and my answer is still there');
ok(m[2]?.who === 'you' && /same on Earned/.test(m[2].text), 'with yours last', m[2]?.text);

const w = await page.evaluate(() => window.__writes);
ok(w.length === 1, 'one write', String(w.length));
ok(Array.isArray(w[0]?.obj?.thread) && w[0].obj.thread.length === 3,
   'the stored doc holds the whole thread', JSON.stringify(w[0]?.obj?.thread?.map(x => x.who)));
ok(w[0]?.obj?.note === 'yes please, and the same on Earned too',
   'note still carries your last word, so an old tab is not blank', w[0]?.obj?.note?.slice(0, 30));
ok(/cheap half/.test(w[0]?.obj?.reply || ''), 'and reply carries mine');

chip = await chipText();
ok(chip === 'waiting on me', 'and the ball is back with me', String(chip));

// ── 4 · the counters read both directions ─────────────────────────────────
const prog = await page.evaluate(() => document.getElementById('progressTxt').innerText);
ok(/waiting on me/i.test(prog), 'the progress line says how many are mine to answer', prog);

// ── 5 · the filter finds them ─────────────────────────────────────────────
await page.evaluate(() => document.querySelector('[data-mine="onme"]').click());
await page.waitForTimeout(300);
const shown = await page.evaluate(() =>
  [...document.querySelectorAll('.item')].filter(r => !r.hidden).map(r => r.dataset.key));
ok(shown.length === 1 && shown[0] === 'earned-build-contacts-0',
   '"Waiting on me" shows exactly the ones I owe', shown.join(','));
await page.evaluate(() => document.querySelector('[data-mine="onme"]').click());
await page.waitForTimeout(200);

// ── 6 · a third turn still appends ────────────────────────────────────────
await page.evaluate((s) => document.querySelector(`${s} .notebtn`).click(), rowSel);
await page.waitForTimeout(200);
await page.evaluate((s) => document.querySelector(`${s} .noteWrap textarea`).focus(), rowSel);
await page.keyboard.type('and a third');
await page.evaluate((s) => document.querySelector(`${s} [data-act="save"]`).click(), rowSel);
await page.waitForTimeout(500);
m = await msgs();
ok(m.length === 4, 'a thread keeps going as long as it needs to', `got ${m.length}`);

// ── 7 · marking done does not eat the conversation ────────────────────────
await page.evaluate((s) => document.querySelector(`${s} .mark[data-mark="done"]`).click(), rowSel);
await page.waitForTimeout(500);
m = await msgs();
ok(m.length === 4, 'resolving it keeps the thread', `got ${m.length}`);
const last = (await page.evaluate(() => window.__writes)).slice(-1)[0];
ok(last?.obj?.state === 'done' && last?.obj?.thread?.length === 4,
   'and the write carries both the state and the thread',
   JSON.stringify({ state: last?.obj?.state, n: last?.obj?.thread?.length }));
ok(await page.evaluate((s) => {
  const el = document.querySelector(`${s} .waiting`);
  return !el || el.hidden;
}, rowSel), 'a resolved item stops asking anyone for anything');

ok(errors.length === 0, 'no page errors', errors.join(' | '));
await page.screenshot({ path: '/tmp/claude-0/-home-user-claude/678f754e-8874-5413-b278-fc834fcb4dab/scratchpad/thread.png', fullPage: false });
await browser.close();
srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
