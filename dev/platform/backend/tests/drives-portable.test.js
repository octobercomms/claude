// The browser drives have to run somewhere other than the container that
// wrote them.
//
// Eighteen drives, roughly 200 assertions, caught three bugs on 1 November
// that the diff looked clean for. They lived in a session scratchpad, which
// is deleted when the container goes, and so did every earlier session's. The
// CI guards survived; the drives did not, so each new agent either rewrote
// them or skipped the step that caught the most.
//
// They are in the repo now, which only helps if they still start. Two things
// stopped them: an absolute `/home/user/claude/...` path to the built app,
// and `import pw from '/opt/node-tools/node_modules/playwright/index.js'`,
// which is a path inside one particular container. Either one is a
// module-not-found on any other machine, and a verification step that fails
// to start looks exactly like one that passed.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'drives');
let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

const files = fs.readdirSync(DIR);
const drives = files.filter(f => f.endsWith('.mjs') && f !== 'pw.mjs');

ok('the drives and the stub are both here', () => {
  assert.ok(drives.length >= 20, `the drives are committed (${drives.length})`);
  assert.ok(files.includes('stub-server.js'), 'and the fixture server they run against');
  assert.ok(files.includes('pw.mjs'), 'and the resolver that finds Playwright');
});

ok('nothing points at one particular container', () => {
  const bad = [];
  for (const f of files) {
    if (!/\.(mjs|js)$/.test(f)) continue;
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/\/home\/user\//.test(line)) bad.push(`${f}:${i + 1} (home path)`);
      // pw.mjs is allowed to name the container's path, because its whole job
      // is to try that first and fall back when it is not there.
      if (f !== 'pw.mjs' && /\/opt\/(node-tools|pw-browsers)/.test(line)) bad.push(`${f}:${i + 1} (container path)`);
    });
  }
  assert.deepStrictEqual(bad, [], `absolute container paths: ${bad.join(', ')}`);
});

ok('every drive gets Playwright through the resolver', () => {
  const bad = drives.filter(f => {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    return /import pw from/.test(src) && !/import pw from '\.\/pw\.mjs'/.test(src);
  });
  assert.deepStrictEqual(bad, [], `not using the resolver: ${bad.join(', ')}`);
});

ok('the resolver tries more than one place and says so when it fails', () => {
  const src = fs.readFileSync(path.join(DIR, 'pw.mjs'), 'utf8');
  assert.ok(/'\/opt\/node-tools\/node_modules\/playwright\/index\.js'/.test(src), 'the container first');
  assert.ok(/'playwright'/.test(src), 'then an ordinary install');
  assert.ok(/No Playwright found/.test(src), 'and a failure names what it tried');
  // Setting an executablePath that does not exist fails louder than letting
  // Playwright pick, so it is only set when the file is actually there.
  assert.ok(/existsSync\(BUNDLED\)/.test(src), 'the bundled Chromium is checked before it is used');
});

ok('the stub resolves its own paths', () => {
  const src = fs.readFileSync(path.join(DIR, 'stub-server.js'), 'utf8');
  assert.ok(/const DIST = path\.join\(__dirname, '\.\.', 'frontend', 'dist'\)/.test(src),
    'the built app is found relative to the stub');
  assert.ok(/require\(path\.join\(__dirname, '\.\.', 'backend'/.test(src),
    'and so is the real resolver it imports');
  assert.ok(/stub on 4599/.test(src), 'it still says where it is listening');
});

ok('and they are written down', () => {
  const doc = path.join(__dirname, '..', '..', '..', '..', 'docs', 'omi', 'browser-drives.md');
  assert.ok(fs.existsSync(doc), 'docs/omi/browser-drives.md exists');
  const md = fs.readFileSync(doc, 'utf8');
  assert.ok(/npx vite build/.test(md), 'it says to build first — a drive against a stale dist proves nothing');
  assert.ok(/uppercase/.test(md), 'and carries the uppercase trap that has caught three drives');
});

console.log(`${passed} guards`);
console.log('---');
console.log('THE DRIVES SURVIVE THE CONTAINER');
