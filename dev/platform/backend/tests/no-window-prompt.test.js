// Nothing in OMI calls window.prompt() any more.
//
// I removed one prompt() from the Journalists delete and wrote the reason in
// the commit message: in some embedded views prompt() shows nothing and
// returns null, so the code after it never runs and the button reads as
// broken. Having made that argument I left thirteen others in place, which is
// the worst of both — the reasoning on record and the behaviour still live.
//
// What those thirteen did when prompt() was inert:
//
//   "Name this campaign"          no campaign, no message
//   "Rename this tag everywhere"  no rename, no message
//   "Send a test to which email"  no test sent, no message
//   "Dismiss reason (optional)"   `?? ''` turned Cancel into Dismiss anyway
//   two clipboard fallbacks       the link you were copying simply vanished
//
// They all go through PromptProvider now: a modal, a promise, null on cancel.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'frontend', 'src');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (/\.(jsx|js)$/.test(e.name) ? [p] : []);
  });
}
const files = walk(SRC);
let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

ok('no file calls window.prompt or a bare prompt()', () => {
  const hits = [];
  for (const f of files) {
    if (f.endsWith('PromptContext.jsx')) continue;   // the replacement's own file
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      // Strip comments AND string literals before looking. A field label
      // reading "Task prompt (what should the AM do?)" is not a call, and the
      // first version of this guard failed on exactly that.
      const code = line
        .replace(/\/\/.*$/, '')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/`(?:[^`\\]|\\.)*`/g, '``');
      if (/\bwindow\.prompt\(/.test(code) || /(^|[^.\w])prompt\(/.test(code)) {
        // usePrompt / PromptProvider / systemPrompt are not it.
        if (/usePrompt|PromptProvider|systemPrompt|promptText/.test(code)) return;
        hits.push(`${path.relative(SRC, f)}:${i + 1}`);
      }
    });
  }
  assert.deepStrictEqual(hits, [], `window.prompt is back: ${hits.join(', ')}`);
});

ok('cancel resolves null, which is the contract the call sites rely on', () => {
  const ctx = fs.readFileSync(path.join(SRC, 'context', 'PromptContext.jsx'), 'utf8');
  assert.ok(/const close = \(\) => settle\(null\);/.test(ctx), 'closing resolves null');
  assert.ok(/if \(r\) r\(v\);/.test(ctx), 'and the promise is always settled');
  // A prompt that never settles hangs the caller for ever, which is a worse
  // silent failure than the one being fixed.
  assert.ok(/resolver\.current = null;/.test(ctx), 'the resolver is cleared so it settles once');
});

ok('the provider is mounted above the router', () => {
  const app = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8');
  assert.ok(/<PromptProvider>/.test(app), 'mounted');
  assert.ok(app.indexOf('<PromptProvider>') < app.indexOf('<BrowserRouter>'),
    'above the router, so every screen can ask');
  assert.ok(app.indexOf('<ToastProvider>') < app.indexOf('<PromptProvider>'),
    'and inside ToastProvider, so a cancel can still toast');
});

ok('a cancelled dismiss no longer dismisses', () => {
  // `prompt(...) ?? ''` meant Escape produced an empty reason and the dismiss
  // went through: a cancel that does the thing.
  const sel = fs.readFileSync(path.join(SRC, 'components', 'SelectiveOutreachPanel.jsx'), 'utf8');
  // Not a blanket ban on `?? ''` — the file has a legitimate one for edit
  // values. The bug was coalescing the ANSWER, which turned a cancel into an
  // empty reason and let the dismiss through.
  assert.ok(!/ask\([^)]*\)[\s\S]{0,120}\?\? ''/.test(sel), 'the answer is not coalesced');
  assert.ok(/if \(reason === null\) return;/.test(sel), 'and cancel returns before the request');
});

ok('every call site awaits the answer', () => {
  // ask() returns a promise. A call site that forgets `await` gets a Promise
  // object where it expected a string, and every truthiness test on it
  // passes — so the campaign gets created with a Promise for a name.
  //
  // Checking the enclosing function turned out to be guesswork (the first
  // version flagged this file's own doc comment). The reliable rule is
  // simpler: every call is written `await ask({`, so any `ask({` without it
  // on the same line is the bug.
  const bad = [];
  for (const f of files) {
    if (f.endsWith('PromptContext.jsx')) continue;   // defines it, never calls it
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (!/(^|[^.\w])ask\(\{/.test(line)) return;
      if (/await ask\(\{/.test(line)) return;
      bad.push(`${path.relative(SRC, f)}:${i + 1}`);
    });
  }
  assert.deepStrictEqual(bad, [], `ask() called without await: ${bad.join(', ')}`);
});

ok('and every file that calls it has the hook', () => {
  const bad = [];
  for (const f of files) {
    if (f.endsWith('PromptContext.jsx')) continue;
    const src = fs.readFileSync(f, 'utf8');
    if (!/await ask\(\{/.test(src)) continue;
    if (!/const ask = usePrompt\(\);/.test(src)) bad.push(path.relative(SRC, f));
    if (!/import \{ usePrompt \}/.test(src)) bad.push(path.relative(SRC, f) + ' (import)');
  }
  assert.deepStrictEqual(bad, [], `calls ask() without usePrompt: ${bad.join(', ')}`);
});

ok('the clipboard fallbacks show the value instead of losing it', () => {
  const sp = fs.readFileSync(path.join(SRC, 'pages', 'SettingsPage.jsx'), 'utf8');
  assert.ok(/setCopyNote\(`Copy failed/.test(sp), 'a refused clipboard write says so');
  assert.ok(/\{copyNote\}<\/div>/.test(sp), 'and the note is actually rendered — set-but-never-shown is the same bug');
  const pr = fs.readFileSync(path.join(SRC, 'pages', 'ClientPRPage.jsx'), 'utf8');
  assert.ok(/await ask\(\{ title: 'Client coverage report'/.test(pr), 'the coverage link is shown, not dropped');
});

console.log(`${passed} guards`);
console.log('---');
console.log('NO SILENT PROMPTS');
