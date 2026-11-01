// The media-desk assistant is a panel, not a row.
//
// "maybe we could move the assistant into there also?" — into the kebab
// drawer. It went into a panel instead, on the client analyst's precedent:
// it is a chat that proposes changes to the records, so a destination you
// navigate to means leaving the list you want it to act on, and a drawer
// loses the URL as well.
//
// The behaviour is driven in dev/platform/drives/drive-assistant.mjs, which
// is where the real verification lives — whether the page behind stays
// visible and scrolls, and whether the dismissing click also presses what is
// under it, are things no source check can see. This file holds the
// decisions a later edit could undo quietly.
//
//   node tests/assistant-panel.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FE = path.join(__dirname, '..', '..', 'frontend');
const read = (p) => fs.readFileSync(path.join(FE, p), 'utf8');
const stripComments = (src) => src
  .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const sections = stripComments(read('src/nav/sections.js'));
const layout = stripComments(read('src/components/Layout.jsx'));
const panel = read('src/components/database/DatabaseAssistantPanel.jsx');
// Absence checks read the stripped copy, presence checks the raw one. This
// file's own comments say "no backdrop element" and name the bubble phase it
// does not use, so an absence check against the raw text matches the
// explanation rather than the code.
const panelCode = stripComments(panel);
const assistant = read('src/components/database/MediaAssistant.jsx');
const settings = stripComments(read('src/pages/SettingsPage.jsx'));

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

ok('it is not a row, and not left behind in SettingsPage', () => {
  const db = sections.slice(sections.indexOf('  database: {'), sections.indexOf('  bizdev: {'));
  assert.ok(!/tab: 'assistant'/.test(db), 'the Assistant row is gone from the Database panel');
  assert.ok(!/MediaAssistant/.test(settings), 'and SettingsPage neither renders nor defines it');
  assert.ok(!/\{ k: 'assistant' \}/.test(settings), 'nor keeps its key');
  // Its own file now, so the panel can mount it outside the page.
  assert.ok(/export default function MediaAssistant/.test(assistant), 'it is its own component');
  assert.ok(/\/pr\/assistant\/message/.test(assistant) && /\/pr\/assistant\/apply/.test(assistant),
    'and it still carries the whole flow, not just the chat');
});

ok('the bubble is on Database and nowhere else', () => {
  assert.ok(/const onDatabase = currentSection\?\.key === 'database';/.test(layout),
    'the section is read once, from the value Layout already computes');
  assert.ok(/\{onDatabase && !readOnly && \(\s*<DatabaseAssistantPanel/.test(layout),
    'the panel is mounted only on Database, and not for a client login');
  const bar = layout.slice(layout.indexOf('className="client-topbar"'));
  assert.ok(/onDatabase && !readOnly/.test(bar.slice(0, 600)), 'and so is the bubble');
  assert.ok(/aria-label="Media-desk assistant"/.test(layout), 'the bubble names itself');
});

ok('one glyph for both chat panels', () => {
  const topbar = read('src/components/ClientTopBar.jsx');
  assert.ok(/export function ChatIcon/.test(topbar), 'ChatIcon is exported');
  assert.ok(/import ClientTopBar, \{ ChatIcon \}/.test(layout),
    'and Layout uses that one rather than drawing a second speech bubble');
});

ok('it is a panel, which means no backdrop and no scroll lock', () => {
  // Both are the difference between this and a modal, and both are easy to
  // add back by reflex. The page behind is the thing you are asking about.
  assert.ok(!/scrim|backdrop/i.test(panelCode), 'no backdrop element');
  assert.ok(!/overflow\s*[:=]\s*['"]hidden/.test(panelCode), 'and nothing locks the page scroll');
  assert.ok(/className=\{`analyst-panel\$\{open \? ' open' : ''\}`\}/.test(panel),
    'it reuses the chat-panel chrome rather than growing a second one');
});

ok('the dismiss listener keeps the shape that makes it work', () => {
  // Mutation-tested in the drive: moving this to the bubble phase turns it
  // red, because the dismissing click then also presses what is under it.
  assert.ok(/document\.addEventListener\('click', onClick, true\)/.test(panel),
    'the click listener is in the capture phase');
  assert.ok(/e\.key === 'Escape'/.test(panel), 'Escape closes it');
  assert.ok(/aria-label="Close assistant"/.test(panel), 'and there is a close button');
});

ok('it has a deep link, and leaving Database closes it', () => {
  assert.ok(/get\('assistant'\) === '1'/.test(layout), '?assistant=1 opens it');
  // The ref guard: an effect runs on mount as well as on change, so without
  // it the mount pass closes the panel the deep link just opened. That exact
  // bug cost the analyst a session.
  assert.ok(/wasOnDatabase\.current === onDatabase/.test(layout),
    'and the close-on-leave effect does not fire on mount');
});

console.log(`${passed} guards`);
console.log('---');
console.log('THE ASSISTANT IS A PANEL');
