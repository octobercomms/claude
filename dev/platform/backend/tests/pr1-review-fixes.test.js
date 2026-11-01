// PR 1 of the review plan: four small fixes, each one agreed with Daniel on
// 1 November after the 110-item audit was cleared to 14.
//
// These are source guards. They are the cheap half: the real verification for
// all four is dev/platform/drives/drive-pr1.mjs, which loads the built app and
// checks where things sit and whether they are disabled, because every one of
// these items is a placement or a visible state and none of it shows in a diff.
//
// That matters here more than usual. Two of these four were marked Delivered
// once already and reopened, both for the same reason: I verified the thing I
// added and never checked the thing it was meant to replace.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FE = path.join(__dirname, '..', '..', 'frontend');
const read = (p) => fs.readFileSync(path.join(FE, p), 'utf8');
let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

const reel = read('src/components/ExampleReel.jsx');
const makeAReel = read('src/pages/MakeAReel.jsx');
const videoTab = read('src/pages/ClientVideoTab.jsx');
const editPage = read('src/pages/ClientEditPage.jsx');
const cro = read('src/components/ClarityCroPanel.jsx');
// Comments stripped for the "is it gone" checks. Three guards today have
// failed on their own explanatory comment quoting the string they ban; the
// code is what ships, the prose about it is not.
const stripComments = (src) => src
  .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const croCode = stripComments(cro);
const reelCode = stripComments(reel);
const videoTabCode = stripComments(videoTab);

// ── 1. The six-styles control ────────────────────────────────────────────
ok('it sits after the upload, not before it', () => {
  const up = makeAReel.indexOf("Upload a clip");
  const ex = makeAReel.indexOf('<ExampleReel />');
  assert.ok(up > -1 && ex > -1, 'both are on the page');
  assert.ok(ex > up, 'the example comes after the upload in the source order');
});

ok('and it is a disabled control with a reason, not replaced by prose', () => {
  // Replacing the button with a paragraph hides the feature from anyone who
  // has not seen it work, which is the Library-tools fault in another place.
  assert.ok(/state === 'none'/.test(reel), 'the empty case is still handled');
  const none = reel.slice(reel.indexOf("if (state === 'none')"), reel.indexOf("if (state === 'none')") + 900);
  assert.ok(/<button[\s\S]*?disabled/.test(none), 'the empty case renders a disabled button');
  assert.ok(/Add a clip first/.test(none), 'and says what unlocks it');
});

ok('a failed status check does not make it vanish', () => {
  // It used to `return null` on error, so the whole feature disappeared with
  // no trace whenever the status endpoint failed.
  assert.ok(!/if \(state === 'loading' \|\| state === 'error'\) return null;/.test(reelCode),
    'error no longer shares the render-nothing path with loading');
  const err = reel.slice(reel.indexOf("if (state === 'error')"), reel.indexOf("if (state === 'error')") + 700);
  assert.ok(/<button[\s\S]*?disabled/.test(err), 'the error case still renders the control');
  assert.ok(/Could not check for worked examples/.test(err), 'and says what happened');
});

// ── 2. The Library tools ─────────────────────────────────────────────────
ok('Tighten and B-roll are off the Library screen', () => {
  assert.ok(!/TightenEdit/.test(videoTabCode), 'no TightenEdit');
  assert.ok(!/BrollPlan/.test(videoTabCode), 'no BrollPlan');
  assert.ok(!/pick another/.test(videoTabCode), 'nor the clip selector that only fed them');
  assert.ok(!/take the pauses and the fillers out/.test(videoTabCode), 'nor the line explaining them');
});

ok('and the state they needed went with them', () => {
  // Dead state reads as live state to whoever edits this next.
  for (const dead of ['const [picked,', 'const [words,', 'const [made,', 'refreshKey=']) {
    assert.ok(!videoTab.includes(dead), `${dead} is gone`);
  }
});

ok('each of the two tools now resolves to exactly one place', () => {
  // This is the assertion that would have caught the item in October: the
  // tools were added to the Video flow and left on Library as well.
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (/\.jsx$/.test(e.name) ? [p] : []);
  });
  for (const comp of ['TightenEdit', 'BrollPlan']) {
    const mounts = walk(path.join(FE, 'src'))
      .filter(f => !f.endsWith(`${comp}.jsx`))
      .filter(f => new RegExp(`<${comp}[\\s/>]`).test(fs.readFileSync(f, 'utf8')));
    assert.strictEqual(mounts.length, 1,
      `${comp} is mounted in exactly one place (${mounts.map(m => path.basename(m)).join(', ') || 'nowhere'})`);
  }
});

// ── 3. Video and Edit name their jobs ────────────────────────────────────
ok('each page says what it is for and points at the other', () => {
  assert.ok(/Give it your clips and it assembles a reel/.test(makeAReel), 'Video says its job');
  assert.ok(/use Edit/.test(makeAReel), 'and names Edit');
  assert.ok(/Cut a video yourself on a timeline/.test(editPage), 'Edit says its job');
  assert.ok(/use Video/.test(editPage), 'and names Video');
});

// ── 4. Funnel health across sites ────────────────────────────────────────
ok('the All-sites card is no longer a count', () => {
  assert.ok(!/`Across \$\{reports\.length\} site/.test(croCode), 'the placeholder string is gone');
  assert.ok(/<CrossSiteRead findings=\{viewFindings\} \/>/.test(croCode), 'a derived read takes its place');
});

ok('the read is derived, not fetched or generated', () => {
  // The point of choosing this over a Claude call: it costs nothing on a
  // screen that gets opened constantly.
  const fn = cro.slice(cro.indexOf('function CrossSiteRead'), cro.indexOf('function Overview'));
  assert.ok(!/api\.(get|post)/.test(fn), 'no request');
  assert.ok(/WEIGHT\[f\.priority\]/.test(fn), 'severity is weighted, so most-trivia does not win');
  assert.ok(/needs it most/.test(fn), 'it names the worst site');
  assert.ok(/sites have something critical/.test(fn), 'and how many carry a critical');
});

ok('Overview can render a node as well as a string', () => {
  // Passing a block into a <p> would nest divs inside a paragraph.
  assert.ok(/typeof summary === 'string' \|\| summary == null/.test(cro),
    'a string still renders as a paragraph, a node renders as itself');
});

console.log(`${passed} guards`);
console.log('---');
console.log('PR 1 HOLDS');
