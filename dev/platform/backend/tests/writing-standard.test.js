// The writing standard belongs to the screen, not to one release.
//
// "its currently under the release title, but I think it should live up by
// the Share button in the top right." The button sat inside
// PressReleaseEditor, under the h1 of the record being edited, which made a
// rule about how every release is written look like a property of that one
// release — and hid it entirely from the releases list, where someone about
// to write the next one is standing.
//
// It is now in the page header beside Share, on the Releases screen, whether
// or not a record is open. The drawer moved out into its own component so
// the trigger and the content can live in different places without one of
// them becoming a copy.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FE = path.join(__dirname, '..', '..', 'frontend');
const read = (p) => fs.readFileSync(path.join(FE, p), 'utf8');
let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

const editor = read('src/components/PressReleaseEditor.jsx');
const page = read('src/pages/ClientPRPage.jsx');
const drawer = read('src/components/WritingStandardDrawer.jsx');

ok('the editor no longer opens it', () => {
  assert.ok(!/The writing standard/.test(editor), 'no trigger left under the release title');
  assert.ok(!/standardOpen/.test(editor), 'and no state for one');
  assert.ok(!/<SideDrawer/.test(editor), 'the drawer went with it');
  assert.ok(!/from '\.\/ui\/SideDrawer'/.test(editor), 'and so did the import, or lint fails on the next change');
});

ok('the page header holds the trigger, beside Share', () => {
  const start = page.indexOf('tabActions={(');
  assert.ok(start > -1, 'the page passes tabActions');
  const block = page.slice(start, page.indexOf(')}', page.indexOf('Share\n', start)) + 2);
  // The prose comment above the buttons also says "The writing standard",
  // so anchor on the handler, which only the button has.
  assert.ok(/setStandardOpen\(true\)/.test(block), 'the trigger is in the header actions');
  assert.ok(/>\s*The writing standard\s*</.test(block), 'and it is labelled');
  assert.ok(block.indexOf('setStandardOpen(true)') < block.indexOf('setShareOpen(true)'),
    'standard first, Share last: Share is the one that leaves the building');
});

ok('and only on the Releases screen', () => {
  // Earned has eight screens. A standard about press releases on the
  // coverage log is a button that does nothing for the thing in front of
  // you.
  const start = page.indexOf('tabActions={(');
  const block = page.slice(start, page.indexOf(')}', page.indexOf('Share\n', start)) + 2);
  const at = block.indexOf('setStandardOpen(true)');
  const gate = block.lastIndexOf("tab === 'press'", at);
  assert.ok(gate > -1 && gate < at, "the trigger sits inside a tab === 'press' gate");
});

ok('the drawer is mounted by the page', () => {
  assert.ok(/import WritingStandardDrawer from '\.\.\/components\/WritingStandardDrawer'/.test(page), 'imported');
  assert.ok(/<WritingStandardDrawer open=\{standardOpen\} onClose=\{\(\) => setStandardOpen\(false\)\} \/>/.test(page), 'and rendered with the page state');
});

ok('and it still says everything it said', () => {
  // The move must not quietly lose the content. These are the four sections
  // and the PDF that made the drawer worth opening.
  for (const s of ['The rule', 'Who does what', 'The six moves a release makes', 'Writing it']) {
    assert.ok(drawer.includes(s), `${s} survived the move`);
  }
  assert.ok(/\/api\/pr\/editorial-standard\.pdf/.test(drawer), 'the full standard is still a download');
  const rows = (drawer.match(/^\s+\['[^']+', '[^']*', '[^']*'\],$/gm) || []).length;
  assert.strictEqual(rows, 8, `all eight who-does-what rows are there (${rows})`);
  assert.ok(/does not write/.test(drawer), 'including the one the whole standard exists for');
});

ok('it takes open and onClose, and nothing else it cannot see', () => {
  // The drawer no longer sits inside the editor, so it has no release to
  // read from. A prop referring to one would be undefined at runtime and
  // silent on screen.
  const sig = drawer.match(/export default function WritingStandardDrawer\(\{([^}]*)\}\)/);
  assert.ok(sig, 'it has a props signature');
  const props = sig[1].split(',').map(s => s.trim()).filter(Boolean);
  assert.deepStrictEqual(props, ['open', 'onClose'], `only open and onClose (${props.join(', ')})`);
  assert.ok(!/\bpr\./.test(drawer), 'and nothing in it reads the release');
});

console.log(`${passed} guards`);
console.log('---');
console.log('THE STANDARD IS IN THE HEADER');
