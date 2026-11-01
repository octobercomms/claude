// The browser harness has to wrap the page in the same providers the app does.
//
// On 1 November I added PromptProvider to App.jsx and not to
// tests/browser/entry.jsx. The harness mounts ClientDesignPage standalone, so
// usePrompt threw at render and the browser suite went red on a PR whose lint,
// units and build were all clean.
//
// The suite caught it, which is the system working. What it caught was me
// skipping that suite before pushing, and the shape of the mistake repeats
// every time App.jsx grows a provider: the harness is a second, hand-kept copy
// of the app's provider stack, and nothing made the two agree.
//
// This is that something.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FE = path.join(__dirname, '..', '..', 'frontend');
const app = fs.readFileSync(path.join(FE, 'src', 'App.jsx'), 'utf8');
const entry = fs.readFileSync(path.join(FE, 'tests', 'browser', 'entry.jsx'), 'utf8');
let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

// Every <XProvider> App.jsx opens above the router. These are what a page
// rendered inside the app can rely on being there.
function providersIn(src, upTo) {
  const head = upTo == null ? src : src.slice(0, src.indexOf(upTo));
  return [...new Set((head.match(/<(\w+Provider)>/g) || []).map(t => t.slice(1, -1)))];
}

ok('App.jsx still puts its providers above the router', () => {
  const above = providersIn(app, '<BrowserRouter>');
  assert.ok(above.length >= 3, `found them (${above.join(', ')})`);
  assert.ok(above.includes('AuthProvider'), 'auth');
  assert.ok(above.includes('ToastProvider'), 'toasts');
});

ok('and the harness has every one of them', () => {
  const need = providersIn(app, '<BrowserRouter>');
  const has = providersIn(entry);
  const missing = need.filter(p => !has.includes(p));
  assert.deepStrictEqual(missing, [],
    `tests/browser/entry.jsx is missing ${missing.join(', ')} — the page will throw at render `
    + 'and the browser suite will go red on a change that lint and the build both passed');
});

ok('each one is imported where it comes from', () => {
  const bad = providersIn(entry).filter(p => !new RegExp(`import \\{ ${p} \\} from`).test(entry));
  assert.deepStrictEqual(bad, [], `used without importing: ${bad.join(', ')}`);
});

ok('the harness still mounts the real page, not a stub of it', () => {
  // The whole value of this suite is that nothing is faked but the network.
  // A harness that mounts a simplified copy proves nothing about the app.
  assert.ok(/from '\.\.\/\.\.\/src\/pages\/ClientDesignPage'/.test(entry), 'the real page');
  assert.ok(/import '\.\.\/\.\.\/src\/index\.css'/.test(entry), 'and the real stylesheet (a side-effect import, not a from)');
});

ok('and the smoke run drives the rename through the page, not a browser dialog', () => {
  // window.prompt is gone, so page.once('dialog', …) would wait for something
  // that never arrives — and worse, leave the replacement modal open across
  // every check after it.
  // Comments stripped first: the note explaining why this went away mentions
  // the very call it is checking for. Same trap as the prompt guard.
  const smoke = fs.readFileSync(path.join(FE, 'tests', 'browser', 'smoke.mjs'), 'utf8')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(!/page\.once\('dialog'/.test(smoke), 'no native-dialog interception left');
  // Anchored on the call, not the string. A disabled check still leaves its
  // own description in the file, which the first version of this happily
  // accepted.
  assert.ok(/\bcheck\(['"]cancelling a rename sends nothing/.test(smoke),
    'and cancel is covered by a live check, which is the case window.prompt made invisible');
});

console.log(`${passed} guards`);
console.log('---');
console.log('THE HARNESS MATCHES THE APP');
