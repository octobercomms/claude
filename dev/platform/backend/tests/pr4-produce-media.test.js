// PR 4 of the review plan: footage in, finished designs findable.
//
// Two items, one theme. The asset library is the only thing in OMI that can
// answer "what have we made for this client", and it had a hole at each end:
// nothing could be put into it by hand, and the design studio never told it
// anything. Both routes are exercised for real in tests/library-upload.test.js
// and tests/design-render-filed.test.js; this guards the wiring at the edges,
// which is where a later edit would quietly undo it.
//
// The placement and the visible states are driven in
// dev/platform/drives/drive-pr4.mjs.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FE = path.join(__dirname, '..', '..', 'frontend');
const read = (p) => fs.readFileSync(path.join(FE, p), 'utf8');
const stripComments = (src) => src
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const reel = stripComments(read('src/pages/MakeAReel.jsx'));
// ClipDrop is read raw, not stripped. accept="video/*,image/*,audio/*"
// contains `/*`, which stripComments takes for the start of a block comment
// and eats the rest of the file up to the next `*/`. Stripping is only needed
// for "is this gone" checks, and every check against this file is "is this
// here", so there is nothing to strip for.
const drop = read('src/components/ClipDrop.jsx');
// Raw, for the same reason as ClipDrop: this file holds two `/*` sequences
// inside string literals, and stripComments would eat from the first of them
// to the next real `*/`. Every check against it is "is this here".
const designPage = read('src/pages/ClientDesignPage.jsx');
const library = read('src/components/AssetLibrary.jsx');

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

// ── 1. One target, not two ───────────────────────────────────────────────
ok('the Footage step has one way in, and it takes several files', () => {
  // Not /<ClipDrop/: that also matches <ClipDropX, so a rename would slip
  // past it. The mutation run showed exactly that on PR 1's copy of this.
  assert.ok(/<ClipDrop clientId=\{clientId\}/.test(reel), 'the drop target is on the step');
  assert.ok(/multiple accept="video\/\*,image\/\*,audio\/\*"/.test(drop),
    'and the picker behind it takes more than one file');
  // Two upload affordances side by side is the two-doors shape this whole
  // review keeps finding. The old single-file button and its ref are gone.
  assert.ok(!/Upload a clip/.test(reel), 'the single-file button is gone');
  assert.ok(!/fileRef/.test(reel), 'and its ref with it');
  assert.ok(!/useRef/.test(reel), 'and the import it was the only user of');
});

ok('one file still goes straight to the editor', () => {
  // The fast path is the point. Filing one clip in the library and making the
  // operator pick it back out would be a step added to the common case.
  assert.ok(/if \(good\.length === 1\) \{ onOne\(good\[0\]\); return; \}/.test(drop),
    'a single file is handed to onOne');
  assert.ok(/onOne=\{startFromUpload\}/.test(reel), 'which is the draft-edit-job path');
});

ok('several files are filed and the grid below is told', () => {
  assert.ok(/api\.postForm\(`\/clients\/\$\{clientId\}\/assets\/upload`/.test(drop),
    'they post to the upload route');
  assert.ok(/onFiled\(\)/.test(drop), 'and the caller is told');
  assert.ok(/onFiled=\{\(\) => setLibKey\(\(k\) => k \+ 1\)\}/.test(reel), 'which bumps the key');
  // Without this the grid never reloads and the five clips just uploaded are
  // missing from the list of what exists.
  assert.ok(/refreshKey=\{libKey\}/.test(reel), 'and the grid reads it');
});

ok('a rejected file is named, not counted', () => {
  assert.ok(/SVG belongs in the brand kit/.test(drop), 'SVG is refused here too');
  assert.ok(/over 500MB/.test(drop), 'and so is anything oversized');
  // "3 files were rejected" leaves you to work out which three, and the
  // answer is usually one wrong drag.
  assert.ok(/\$\{r\.f\.name\} — \$\{r\.why\}/.test(drop), 'each rejection names its file and why');
  assert.ok(/good\.length/.test(drop) && /if \(!good\.length\) return;/.test(drop),
    'and the good ones still go');
});

// ── 2. A finished design reaches the library ─────────────────────────────
ok('both export paths file what they rendered', () => {
  assert.ok(/async function fileRender\(pageId, dataUrl/.test(designPage), 'there is one helper');
  assert.ok(/api\.post\(`\/design\/pages\/\$\{pageId\}\/render`/.test(designPage),
    'which posts to the render route');
  // One page and a whole set are two separate export functions, and a change
  // that only wired up one of them would leave half the designs invisible.
  const single = designPage.slice(designPage.indexOf('async function exportPage'),
    designPage.indexOf('async function readPsds'));
  assert.ok(/await fileRender\(pageId, url/.test(single), 'the single-page export files');
  const set = designPage.slice(designPage.indexOf('async function exportSets'),
    designPage.indexOf('async function renameProject'));
  assert.ok(/await fileRender\(pages\[i\]\.id, url/.test(set), 'and the whole-set export files');
  assert.ok(/filed \+=/.test(set) && /filed \$\{filed\} in the library/.test(set),
    'and says how many it filed');
});

ok('filing never breaks an export', () => {
  // The operator has the file from the download either way. An export that
  // failed because the library was briefly unreachable would be a far worse
  // bug than a missing row.
  const helper = designPage.slice(designPage.indexOf('async function fileRender'),
    designPage.indexOf('async function exportPage'));
  assert.ok(/catch \{\s*return null;\s*\}/.test(helper), 'it swallows its own failure');
  assert.ok(/if \(!pageId \|\| !dataUrl\) return null;/.test(helper), 'and refuses to try without both');
});

ok('a PSD is not filed', () => {
  // A PSD is a working file for a designer, not the image that goes out, and
  // the library indexes what was made.
  const single = designPage.slice(designPage.indexOf('async function exportPage'),
    designPage.indexOf('async function readPsds'));
  const psdBranch = single.slice(single.indexOf("if (format === 'psd')"), single.indexOf('} else {'));
  assert.ok(!/fileRender/.test(psdBranch), 'the psd branch files nothing');
});

// ── 3. The link back to the set ──────────────────────────────────────────
ok('a design asset links back to the set that made it', () => {
  // This is the half that would rot unnoticed: a rendered page with no way
  // back is a picture you can see but cannot edit.
  assert.ok(/function setLink\(asset\)/.test(library), 'the library builds the link');
  assert.ok(/asset\?\.metadata\?\.design_project_id/.test(library), 'from the set id on the asset');
  assert.ok(/SECTIONS\.produce\.base\(asset\.client_id\)/.test(library)
    && /slugForTab\(SECTIONS\.produce, 'design'\)/.test(library),
    'built from sections.js, not typed — a typed path rots the next time the slug moves');
  assert.ok(/\?design=\$\{encodeURIComponent\(pid\)\}/.test(library), 'and opens that set');
  assert.ok(/design_project_name/.test(library), 'naming the set where it can');
});

ok('opening the set does not also pick the asset', () => {
  // The card is itself a picker in half the places the library renders, so a
  // link inside one has to stop the click.
  assert.ok(/onClick=\{\(e\) => e\.stopPropagation\(\)\}/.test(library),
    'the link stops propagation');
});

console.log(`${passed} guards`);
console.log('---');
console.log('FOOTAGE IN, FINISHED DESIGNS FINDABLE');
