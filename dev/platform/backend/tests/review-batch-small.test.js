// The small fixes off the 31 October review, held in place.
//
// Each of these is a one-line decision that is easy to undo by accident while
// working on the screen around it, and several were asked for twice.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FE = path.join(__dirname, '..', '..', 'frontend');
const read = (p) => fs.readFileSync(path.join(FE, p), 'utf8');
let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

// ── Settings: accordions off, one box per connection ─────────────────────────

const settings = read('src/pages/SettingsPage.jsx');

ok('no accordion on the keys screens', () => {
  assert.ok(!/accordion-trigger/.test(settings), 'the category header is a heading, not a toggle');
  assert.ok(!/openCategories/.test(settings), 'and there is no open/closed state left to restore');
  assert.ok(!/toggleCategory/.test(settings));
  assert.ok(!/\{open \? '▾' : '▸'\}/.test(settings), 'no arrow, because nothing collapses');
});

ok('each connection sits in its own box, and the category does not', () => {
  const block = settings.slice(settings.indexOf('const groupsInCat ='), settings.indexOf("cat.title === 'Outreach'"));
  assert.ok(/<div key=\{group\.title\} className="card">/.test(block), 'one card per connection');
  assert.ok(!/<Card key=\{cat\.title\}>/.test(block), 'and no card around the whole category');
  // A category card plus a group box plus a tinted field is the four levels
  // of chrome this replaced.
  assert.ok(!/borderTop: 'var\(--border-w\) solid var\(--card-border\)' \}\}>\n/.test(block));
});

// ── Earned → Find: the button says what the click does ───────────────────────

const pr = read('src/pages/ClientPRPage.jsx');

ok('Find says it adds to the database AND the client', () => {
  const find = pr.slice(pr.indexOf('const renderFind ='), pr.indexOf('const renderContacts ='));
  assert.ok(/Add to DB \+ client/.test(find), 'the row button');
  assert.ok(/Add all \{suggestions\.length\} to DB \+ client/.test(find), 'the bulk button');
  assert.ok(/Add selected to DB \+ client/.test(find));
  // Which is true: approving writes outreach_contacts and
  // outreach_contact_clients. Checked against the route, so the label cannot
  // outlive the behaviour.
  const route = fs.readFileSync(path.join(__dirname, '..', 'src/routes/pr.js'), 'utf8');
  const approve = route.slice(route.indexOf("journalist-suggestions/:suggestionId/approve"), route.indexOf('// Dismiss one suggestion'));
  assert.ok(/INSERT INTO outreach_contacts/.test(approve), 'it does write to the shared database');
  assert.ok(/INSERT INTO outreach_contact_clients/.test(approve), 'and attach to the client');
});

// ── Paid → Draft: the modal is 80% of the viewport ───────────────────────────

const concept = read('src/components/paid/ConceptEditModal.jsx');
const css = read('src/index.css');

ok('the Draft modal is 80% wide, with or without the chat', () => {
  assert.ok(/className="modal modal-80"/.test(concept));
  assert.ok(!/showChat \? ' modal-wide'/.test(concept),
    'it was 560px, and 1120px only once the chat opened');
  assert.ok(/\.modal-80 \{ width: 80vw; max-width: 80vw; \}/.test(css),
    'a percentage, so it uses the screen the operator actually has');
});

// ── Biz dev → Leads: archive, and a delete that asks for the name ────────────

const leads = read('src/pages/LeadsPage.jsx');
const confirmUi = read('src/components/ui/DangerConfirm.jsx');

ok('archived leads are out of the pipeline, but reachable', () => {
  assert.ok(/showArchived \|\| l\.status !== 'archived'/.test(leads));
  assert.ok(/Show archived \(\{archivedCount\}\)/.test(leads), 'with the count, so it is not a hidden pile');
});

ok('archive is a status change, so it is reversible', () => {
  assert.ok(/status: archived \? 'archived' : 'new'/.test(leads));
  assert.ok(/\{l\.status === 'archived' \? 'Restore' : 'Archive'\}/.test(leads));
});

ok('the row buttons do not open the row', () => {
  // The <tr> navigates on click, so archiving would open the lead it just
  // archived.
  assert.ok(/onClick=\{e => e\.stopPropagation\(\)\}/.test(leads));
});

ok('deleting a lead asks for its name, not for "1"', () => {
  assert.ok(/phrase=\{label\(pendingDelete\)\}/.test(leads),
    '"1" is not a confirmation anybody has to read');
  assert.ok(/const expected = phrase != null \? String\(phrase\) : String\(count\)/.test(confirmUi));
  assert.ok(/Archive instead/.test(leads), 'and points at the reversible option');
  assert.ok(/call notes/.test(leads), 'and says what goes with it');
});

console.log(`review-small    ✓ ${passed} assertions passed`);
