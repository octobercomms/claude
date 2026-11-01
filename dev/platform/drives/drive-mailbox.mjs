// A mailbox OMI reads can be opened without a password.
//
// press@ failed on 25 October with AUTHENTICATIONFAILED and could not be fixed
// by typing a new app password, because Google no longer issues one for that
// account. This drive checks the screen, not the diff: the three states a
// mailbox can be in, the button each one needs, and that nothing on the panel
// tells an operator to go and get an app password.
import pw from './pw.mjs';
const { chromium } = pw;
const B = 'http://127.0.0.1:4599';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto(`${B}/settings/outreach`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const panel = () => page.evaluate(() => document.querySelector('.app-main').innerText);

let text = await panel();
ok(/Mailboxes OMI reads/.test(text), 'the panel renders');

// The three mailboxes, each showing how it authenticates.
ok(/press@/.test(text) && /hello@/.test(text) && /studio@/.test(text), 'all three mailboxes are listed');
ok(/Google sign-in\b/.test(text), 'a connected Google mailbox says so');
ok(/Google sign-in needed/.test(text), 'and one without a grant says what is missing');

// The copy. This is the line that sent Daniel to a Google screen that no
// longer offers an app password, so it is the line that had to change.
ok(/no longer issues app passwords/i.test(text), 'the panel says app passwords are gone');
ok(/25 October/.test(text), 'and names when press@ stopped being read');
ok(!/Gmail needs an app password/i.test(text), 'and no longer tells you to go and get one');

// The buttons, per state.
const buttons = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.app-main div')]
    .filter(d => /^(press@|hello@|studio@)/.test((d.innerText || '').trim()) && d.querySelector('button'));
  const out = {};
  for (const name of ['press@', 'hello@', 'studio@']) {
    // The innermost div that still holds the row's buttons.
    const row = rows.filter(d => (d.innerText || '').trim().startsWith(name))
      .sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!row) continue;
    out[name] = [...row.querySelectorAll('button')].map(b => ({
      text: b.innerText.trim(),
      primary: b.className.includes('btn-primary'),
    }));
  }
  return out;
});

const has = (box, label) => (buttons[box] || []).some(b => b.text === label);
ok(has('hello@', 'Sign in with Google'), 'a mailbox with no grant offers Google sign-in');
ok((buttons['hello@'] || []).find(b => b.text === 'Sign in with Google')?.primary,
   'and it is the primary action on that row, because nothing else will fix it');
ok(has('press@', 'Reconnect Google'), 'a connected mailbox offers to reconnect');
ok(has('press@', 'Use a password'), 'and to go back to a password');
ok(!has('hello@', 'Use a password'), 'which is not offered where there is no grant to drop');
ok(has('studio@', 'Sign in with Google'), 'an app-password mailbox can be moved over');
ok(!has('studio@', 'Use a password'), 'and is not offered the switch it is already on');
ok(has('press@', 'Test') && has('press@', 'Remove'), 'Test and Remove survive on every row');

// The lapsed grant reaches the screen rather than a log.
ok(/no grant stored/.test(text), 'a mailbox with no grant shows the poll error it produced');
ok(/Connect it in Settings/.test(text), 'with what to do about it');


// Password inputs inside the add form only: the Settings page is full of API
// key fields that are also type=password, and counting those made the first
// version of this assertion read 8 when the answer was 0.
const addFormPasswords = () => page.evaluate(() => {
  const radio = document.querySelector('.app-main input[type="radio"]');
  if (!radio) return -1;
  let n = radio;
  while (n && !n.querySelector('input[placeholder="press@octobercomms.com"]')) n = n.parentElement;
  return n ? n.querySelectorAll('input[type="password"]').length : -1;
});

// The add form: the choice, and no password field on the Google side.
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.app-main button')].find(x => x.innerText.trim() === 'Add a mailbox');
  b.click();
});
await page.waitForTimeout(400);
let form = await panel();
ok(/Sign in with Google/.test(form) && /App password/.test(form), 'the add form offers both kinds');
let fields = await addFormPasswords();
ok(fields === 0, 'Google sign-in is the default, so no password is asked for', `password inputs: ${fields}`);
ok(/then sign in from the row above/i.test(form), 'and it says why adding comes first');

// Choosing the app password brings the field back.
await page.evaluate(() => {
  const radios = [...document.querySelectorAll('.app-main input[type="radio"]')];
  radios[1].click();
});
await page.waitForTimeout(300);
fields = await addFormPasswords();
ok(fields === 1, 'picking App password brings the field back', `password inputs: ${fields}`);
form = await panel();
ok(/Test connection/.test(form), 'and Test connection, which only a password can answer before saving');

await page.evaluate(() => {
  const radios = [...document.querySelectorAll('.app-main input[type="radio"]')];
  radios[0].click();
});
await page.waitForTimeout(300);
form = await panel();
ok(!/Test connection/.test(form), 'and Test connection goes again on the Google side');

ok(errors.length === 0, 'no page errors', errors.join(' | '));
await page.screenshot({ path: '/tmp/claude-0/-home-user-claude/678f754e-8874-5413-b278-fc834fcb4dab/scratchpad/mailbox.png', fullPage: false });
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
